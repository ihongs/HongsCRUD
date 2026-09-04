// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

// 文档：docs/plan-crud-search.md
// 构造与客户端见 2 节，
// mapping 推导见 1.1 - 1.3，
// find 到 DSL 的翻译见 2.1（nested 归组见 1.3），
// search / statis 检索见 3 / 4 节（文档结构与回表见 2.2），
// 同步见 5 节。

import type { Schema, Model } from 'mongoose';
import type { Client } from '@elastic/elasticsearch';
import type { SyncOpts, SyncFindOpts, SyncCullOpts, SyncStat, EsOpts, EsLeaf, EsCond } from './types';
import type { FindSpec, SortSpec, ColsSpec, SearchParams, SearchResult, StatisParams, StatisResult, Context } from '../types';
import { Cradle, CrudError, CrudErrno, fillSearchRefs, fillStatisRefs } from '../index';

export * from './types';

/* ---------- 全局 ES 客户端 ---------- */

const ES_CLIENT: { es?: Client } = {};

/** 注册全局默认 ES 客户端，构造 Chaser 时可不传 es */
export function setEsClient(client: Client): void {
  ES_CLIENT.es = client;
}

/** 读取全局默认 ES 客户端 */
export function getEsClient(): Client | undefined {
  return ES_CLIENT.es;
}

/* ---------- Chaser ---------- */

/** terms 聚合 size 上限约定值（ES search.max_buckets 默认），tops 为 0（不限）时取它，见 4 节 */
const TERMS_MAX = 65536;

export class Chaser extends Cradle {
  private readonly _es?    : Client;
  private readonly _esOpts : EsOpts;
  private readonly _mapping   : Record<string, any>;
  private readonly _syncable  : Set<string>;
  private readonly _textable  : Set<string>;
  private readonly _countable : Set<string>;
  private readonly _leaves    : Map<string, EsLeaf>;   // 叶子字段 -> 推导结果，查询翻译按 kind 取字段名
  private readonly _nestedPaths: Set<string>;   // nested: true  的字段路径集合，用于查询归组与聚合包裹
  private readonly _selectFalse: Set<string>;   // select: false 且可同步的字段，普通查询默认是拿不到的，见 5.1 / 5.2
  private _indexReady = false;   // 索引存在性 memo：确认存在后免查，dropIndex 置回

  /**
   * 构造期只做 Schema 推导与配置校验，不触达 ES
   * es 未传时 getClient() 取全局注册的默认客户端
   */
  constructor(schema: Schema, model?: Model<any>, es?: Client) {
    super(schema, model);   // 未传 model 时在此编译，softDelete 等插件注入随后完成
    this._es = es;

    const sopts = (schema as any).options || {};
    this._esOpts = {
      esIndex    : sopts.esIndex || schema.options.collection,
      esFullText : sopts.esFullText  || 'fullText',
      esSyncTime : sopts.esSyncTime  || 'syncTime',
      esAnalyzer : sopts.esAnalyzer,
      esAutoSync : sopts.esAutoSync !== undefined ? sopts.esAutoSync : true,
      esSyncError: sopts.esSyncError || console.error,
    };

    // 软删除标记不入索引（视同 syncable: false，见 1.1）
    const skipRoot = new Set<string>();
    const sd = this.getSoftDelete();
    if (sd) {
      skipRoot.add(sd.isDeleted || 'isDeleted');
      skipRoot.add(sd.deletedAt || 'deletedAt');
    }

    // 推导 mapping 与字段清单（叶子含子文档点号路径，容器按声明取 nested / object）
    const leaves: EsLeaf[] = [];
    const nestes = new Map<string, boolean>();
    walkSchema(schema, '', true, { skipRoot, esAnalyzer: this._esOpts.esAnalyzer }, { leaves, nestes });

    this._mapping    = makeMapping(leaves, nestes, this._esOpts);
    this._syncable   = new Set(leaves.map(l => l.name));
    this._textable   = new Set(leaves.filter(l => l.textable ).map(l => l.name));
    this._countable  = new Set(leaves.filter(l => l.countable).map(l => l.name));
    this._leaves     = new Map(leaves.map(l => [l.name, l] as [string, EsLeaf]));
    
    this._nestedPaths = new Set<string>();
    for (const [ck, isNest] of nestes) {
      if (isNest && leaves.some(l => l.name.startsWith(ck + '.'))) {
        this._nestedPaths.add(ck);
      }
    }

    // select: false 且可同步的字段：findById / find 默认投影排除它们，查询同步须补 +field，见 5.1
    this._selectFalse = new Set([...this._syncable].filter(
      f => (schema.path(f) as any)?.options?.select === false,
    ));
  }

  /* ---------- ES 基础 ---------- */

  /** ES 客户端：构造注入优先，未注入则取全局注册，缺失抛 INTERNEL_ERROR */
  getClient(): Client {
    if (this._es) return this._es;
    const es = getEsClient();
    if (!es) {
      throw new CrudError(
        'ES client not set. Pass it to new Chaser(schema, model, es) or call setEsClient().',
        CrudErrno.INTERNEL_ERROR,
      );
    }
    return es;
  }

  /** ES 索引名：esIndex || collection */
  getIndex(): string {
    return this._esOpts.esIndex;
  }

  /* ---------- mapping 与字段清单 ---------- */

  /** 入索引字段 -> ES mapping，含合并字段与同步戳，根级 dynamic: 'strict' */
  getMapping(): Record<string, any> {
    return this._mapping;
  }

  /** 入索引字段名集合（含子文档点号路径），即排除 syncable: false 后的可映射字段 */
  getSyncable(): Set<string> {
    return this._syncable;
  }

  /** 参与全文的文本字段名集合，即标了 textable: true 的 String（默认不并入，见 1.1） */
  getTextable(): Set<string> {
    return this._textable;
  }

  /** 入索引 + countable 字段名集合 */
  getCountable(): Set<string> {
    return this._countable;
  }

  /** nested: true  的字段路径集合，用于查询归组与聚合包裹 */
  getNestedPaths(): Set<string> {
    return this._nestedPaths;
  }

  /** select: false 且可同步的字段，普通查询默认是拿不到的 */
  getSelectFalse(): Set<string> {
    return this._selectFalse;
  }

  /**
   * 获取字段叶子节点
   * 用于查询条件翻译
   */
  protected getLeaf(name: string): EsLeaf | undefined {
    return this._leaves.get(name);
  }

  /**
   * 拼装全文内容，写入 esFullText 字段
   * 默认按 getTextable() 逐字段取值，扁平化数组、去空、去重后 join(' ')
   * 子类可覆盖以追加码值标签、关联名称等派生文本
   */
  protected getFullText(doc: any): string {
    const vals: string[] = [];
    const push = (v: any): void => {
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) { v.forEach(push); return; }
      vals.push(String(v));
    };
    for (const name of this._textable) {
      push(getDocPath(doc, name));
    }
    return [...new Set(vals)].join(' ');
  }

  /* ---------- 索引管理 ---------- */

  /** 确认索引：不存在则按 getMapping() 创建，已存在则不动（幂等）；memo 命中后直接放行 */
  async makeIndex(): Promise<void> {
    if (this._indexReady) return;
    const es    = this.getClient();
    const index = this.getIndex();
    if (!await es.indices.exists({ index })) {
      await es.indices.create({ index, mappings: this.getMapping() });
    }
    this._indexReady = true;
  }

  /** 重建索引：先删后建（改字段类型 / 分词器后用，有空窗），映射以 getMapping() 为准 */
  async initIndex(): Promise<void> {
    const es    = this.getClient();
    const index = this.getIndex();
    await this.dropIndex();
    await es.indices.create({ index, mappings: this.getMapping() });
    this._indexReady = true;
  }

  /** 删除索引；索引不存在视同成功（幂等），其余失败原样抛出 */
  async dropIndex(): Promise<void> {
    const es    = this.getClient();
    const index = this.getIndex();
    try {
      await es.indices.delete({ index });
    } catch (err) {
      if ((err as any)?.statusCode !== 404) throw err;   // 404 视同已删
    }
    this._indexReady = false;
  }

  /**
   * 与索引现有 mapping 做 diff，只 putMapping 新增字段（已有字段一律不传，不改既有定义），返回新增字段名数组
   * 索引不存在时先按需建立，此时无 diff 返回 []；推完还须 syncFind() 回填旧文档，见 1.4
   */
  async pushMapping(): Promise<string[]> {
    await this.makeIndex();
    const es    = this.getClient();
    const index = this.getIndex();

    const have = (await es.indices.getMapping({ index }))?.[index]?.mappings?.properties ?? {};
    const body: Record<string, any> = {};
    const added: string[] = [];
    diffMapping(this.getMapping().properties, have, body, '', added);

    if (Object.keys(body).length) {
      await es.indices.putMapping({ index, properties: body });
    }
    return added;
  }

  /* ---------- find -> DSL 翻译（见 2.1） ---------- */

  /**
   * 把 find / id / wd 翻译为 ES query DSL（对照表见 2.1），供 search / statis 共用
   * find 全部进 filter 上下文不计分；wd 非空时追加 match 到 must 参与打分，空则整个查询都在 filter 上下文
   */
  getQuery(find?: FindSpec, id?: string | string[], wd?: string): Record<string, any> {
    const conds: EsCond[] = [];
    if (find) this.collectAnd([find], conds);
    if (id !== undefined) {
      // ES 文档 _id 即 mongo _id 的字符串形式，见 2.2
      const ids = (!Array.isArray(id) ? [id] : id).map(String);
      conds.push({ clause: { ids: { values: ids } } });
    }

    const bool  : Record<string, any> = {};
    const filter = emitAnd(conds);
    if (filter.length) bool.filter = filter;
    const ws = wd?.trim();
    if (ws) bool.must = [{ match: { [this._esOpts.esFullText]: ws } }];
    return Object.keys(bool).length ? { bool } : { match_all: {} };
  }

  /**
   * 收集 and 语境的条件：对象多键为隐式 and，$and 各元素并入同一语境（同 nested path 才可归组，见 1.3）
   * $or / $not 的产物为完整子句，各分支独立包裹、不跨分支归组
   */
  protected collectAnd(specs: Record<string, any>[], out: EsCond[]): void {
    for (const spec of specs) {
      for (const [key, val] of Object.entries(spec)) {
        if (key === '$and' || key === '$or') {
          if (!Array.isArray(val) || !val.every(isPlainObj)) {
            throw new CrudError(
              `"${key}" expects an array of condition objects.`,
              CrudErrno.PARAMS_INVALID,
              { operator: key },
            );
          }
          if (key === '$and') {
            this.collectAnd(val, out);
            continue;
          }
          out.push({ clause: {
            bool: {
              should: val.map(b => ({ bool: { filter: emitAnd(this.collectOne(b)) } })),
              minimum_should_match: 1,
            },
          } });
          continue;
        }
        if (key === '$not') {
          if (!isPlainObj(val)) {
            throw new CrudError(
              '"$not" expects a condition object.',
              CrudErrno.PARAMS_INVALID,
              { operator: '$not' },
            );
          }
          const clauses = emitAnd(this.collectOne(val));
          // 多子句须先合成整体再取非：NOT(A AND B) 不等于 NOT A AND NOT B
          out.push({ clause: clauses.length === 1
            ? { bool: { must_not: [clauses[0]] } }
            : { bool: { must_not: [{ bool: { filter: clauses } }] } } });
          continue;
        }
        this.fieldConds(key, val, out);
      }
    }
  }

  /** 翻译单个 find 对象（自身为独立 and 语境）的条件，返回带 nested 链的中间态 */
  protected collectOne(spec: Record<string, any>): EsCond[] {
    const conds: EsCond[] = [];
    this.collectAnd([spec], conds);
    return conds;
  }

  /**
   * 翻译单个字段条件，转为 ES 子句
   * 自定义的字段条件可覆盖重写此方法
   * 未入索引的字段与不支持的操作符抛 PARAMS_INVALID
   */
  protected fieldConds(field: string, value: any, out: EsCond[]): void {
    const leaf = this._leaves.get(field);
    if (! leaf) {
      throw new CrudError(
        `Field "${field}" is not in the ES index (syncable: false or unmappable type).`,
        CrudErrno.PARAMS_INVALID,
        { field },
      );
    }

    if (Array.isArray(value)) {
      throw new CrudError(
        `Array value on "${field}" is not supported, please use "$in" instead.`,
        CrudErrno.PARAMS_INVALID,
        { field },
      );
    }

    if (isEmptyObj(value)) {
      throw new CrudError(
        `Condition of "${field}" is empty.`,
        CrudErrno.PARAMS_INVALID,
        { field, operator: '' },
      );
    }

    const chain = this.nestedChain(field);
    const push  = (clause: Record<string, any>): void => { out.push({ clause, chain }); };

    // null 与缺失在 ES 里同义（exists 均为假），must_not + exists
    if (value === null || value === undefined) {
      push({ bool: { must_not: [{ exists: { field } }] } });
      return;
    }

    if (value instanceof Date || typeof value !== 'object') {
      push({ term: { [termName(leaf)]: value } });
      return;
    }

    for (const [op, ov] of Object.entries(value)) {
      switch (op) {
        case '$gt': case '$gte': case '$lt': case '$lte':
          push({ range: { [termName(leaf)]: { [op.slice(1)]: ov } } });
          break;
        case '$exists':
          push(ov === false
            ? { bool: { must_not: [{ exists: { field } }] } }
            : { exists: { field } });
          break;
        case '$eq':
          // mongo 语义：$eq null 即「字段无值」
          push(ov === null || ov === undefined
            ? { bool: { must_not: [{ exists: { field } }] } }
            : { term: { [termName(leaf)]: ov } });
          break;
        case '$ne':
          // mongo 语义：$ne null 即「字段有值」
          push(ov === null || ov === undefined
            ? { exists: { field } }
            : { bool: { must_not: [{ term: { [termName(leaf)]: ov } }] } });
          break;
        case '$in': {
          if (!Array.isArray(ov)) {
            throw new CrudError(
              `"${op}" expects an array on "${field}".`,
              CrudErrno.PARAMS_INVALID,
              { field, operator: op },
            );
          }
          push({ terms: { [termName(leaf)]: ov } });
          break;
        }
        case '$nin': {
          if (!Array.isArray(ov)) {
            throw new CrudError(
              `"${op}" expects an array on "${field}".`,
              CrudErrno.PARAMS_INVALID,
              { field, operator: op },
            );
          }
          push({ bool: { must_not: [{ terms: { [termName(leaf)]: ov } }] } });
          break;
        }
        case '$regex': {
          const re = ov instanceof RegExp ? ov.source : ov;
          if ((leaf.kind !== 'text' && leaf.kind !== 'keyword') || typeof re !== 'string') {
            throw new CrudError(
              `"$regex" on "${field}" expects a pattern on text / keyword fields.`,
              CrudErrno.PARAMS_INVALID,
              { field, operator: op },
            );
          }
          push({ regexp: { [termName(leaf)]: re } });
          break;
        }
        case '$search': {
          // 对齐 mongo 的 $text.$search：字段级分词匹配（mongo 社区版无此能力，Chaser 独有）；
          // match 打 .text 子字段（termsize: 0 时主字段即 text），operator: and 须全部分词命中
          if (!leaf.textable || typeof ov !== 'string' || !ov.trim()) {
            throw new CrudError(
              `"$search" on "${field}" expects a non-empty string on textable fields.`,
              CrudErrno.PARAMS_INVALID,
              { field, operator: op },
            );
          }
          push({ match: { [textName(leaf)]: { query: ov, operator: 'and' } } });
          break;
        }
        default:
          throw new CrudError(
            `Operator "${op}" on "${field}" is not supported in ES translation.`,
            CrudErrno.PARAMS_INVALID,
            { field, operator: op },
          );
      }
    }
  }

  /** 字段所属的 nested path 链（由外到内，内层为全路径），不在 nested 下为空数组 */
  private nestedChain(fn: string): string[] {
    const segs  = fn.split('.');
    const chain: string[] = [];
    for (let i = 1; i < segs.length; i ++) {
      const p = segs.slice(0, i).join('.');
      if (this._nestedPaths.has(p)) chain.push(p);
    }
    return chain;
  }

  /** 直查 mongo：透传 Cradle.search 原实现，绕过 ES，供兜底或与索引比对用 */
  rawSearch(params: SearchParams, ctx: Context): SearchResult {
    return super.search(params, ctx);
  }

  /** 直查 mongo：透传 Cradle.statis 原实现，绕过 ES，供兜底或与索引比对用 */
  rawStatis(params: StatisParams, ctx: Context): StatisResult {
    return super.statis(params, ctx);
  }

  /* ---------- 覆盖：读走 ES（见 3 / 4 节） ---------- */

  /**
   * 检索入口：条件 / 排序 / 分页 / 计数一概由 ES 完成，_source: false 只取 _id 与 _score，
   * 命中 id 一律回 mongo 取完整文档并按 ES 顺序重排（见 2.2），cols 交 mongo 投影；
   * 不传 sort 且有 wd 时按 _score 降序，即 ES 默认行为，无需显式处理；
   * 只有 id 没有 wd / find 时是纯取详情，无过滤无打分，分流 rawSearch 直查 mongo
   */
  async search(params: SearchParams, ctx: Context): Promise<SearchResult> {
    const { id, wd, mode, find, sort, cols, refs, start = 0 } = params;

    // 只有 id 且无 wd / find：ES 帮不上忙还多一趟回表，直查 mongo
    if (id && !wd && (!find || !Object.keys(find).length)) {
      return this.rawSearch(params, ctx) as unknown as Promise<SearchResult>;
    }

    await this.makeIndex();

    const query = this.getQuery(find, id, wd);

    // 0 不限（limitMax = 0 时），默认 limitDef，受 limitMax 约束：语义与报错沿用 Cradle.search
    const opts  = (this.getSchema() as any).options || {};
    const limitDef = opts.limitDef !== undefined ? opts.limitDef : 1;
    const limitMax = opts.limitMax !== undefined ? opts.limitMax : 1000;
    const limit = params.limit !== undefined ? params.limit : limitDef;
    if (limitMax > 0 && (limit === 0 || limit > limitMax)) {
      throw new CrudError(
        `Limit ${limit} exceeds max ${limitMax}`,
        CrudErrno.PARAMS_INVALID,
        { limit, limitMax },
      );
    }

    // from + size 不得超过 max_result_window（默认 10000），深翻页留待 search_after，见 3 节
    const window = 10000;
    const size   = limit || window - start;   // limit 为 0 表示不限：取到窗口末尾
    if (start + size > window) {
      throw new CrudError(
        `start + limit ${start + size} exceeds max_result_window ${window}`,
        CrudErrno.PARAMS_INVALID,
        { start, limit, window },
      );
    }

    const body: Record<string, any> = {
      query,
      from : start,
      size : mode === 'list-more' ? size + 1 : size,   // 多取一条判断 more
      _source: false,
    };
    if (sort) body.sort = this.getSort(sort);
    // list-more 无需总数；totalHits 未传时走 ES 默认估算，true / 数字原样透传（见 3 节表格）
    if (mode === 'list-more') {
      body.track_total_hits = false;
    } else if (params.totalHits !== undefined) {
      body.track_total_hits = params.totalHits;
    }

    const res  = (await this.getClient().search({ index: this.getIndex(), ...body } as any)) as any;
    const hits = res.hits?.hits ?? [];
    const tot  = res.hits?.total;   // { value, relation }

    // 回表只影响文档内容，only-total 无 list 不回表，见 3 节
    if (mode === 'only-total') {
      return { total: tot?.value ?? 0, totalRel: tot?.relation };
    }
    if (mode === 'only-list') {
      const list = await this.getDocs(hits, cols, !!wd?.trim());
      const result: any = { list };
      // 先正常 search，最后调函数补充 refs
      const refsData = await fillSearchRefs(this.getRefPaths(), list, refs, ctx);
      if (refsData) result.refs = refsData;
      return result;
    }
    if (mode === 'list-more') {
      const list = await this.getDocs(hits.slice(0, size), cols, !!wd?.trim());
      const result: any = { list, more: hits.length > size };
      // 先正常 search，最后调函数补充 refs
      const refsData = await fillSearchRefs(this.getRefPaths(), list, refs, ctx);
      if (refsData) result.refs = refsData;
      return result;
    }
    const list = await this.getDocs(hits, cols, !!wd?.trim());
    const result: any = {
      list,
      total : tot?.value ?? 0,
      totalRel: tot?.relation,
    };
    // 先正常 search，最后调函数补充 refs
    const refsData = await fillSearchRefs(this.getRefPaths(), list, refs, ctx);
    if (refsData) result.refs = refsData;
    return result;
  }

  /**
   * 按命中顺序回 mongo 取文档（见 2.2）：$in 查回（带软删条件）后按 ES 顺序重排，
   * 已不在 mongo 的 id（索引滞后 / 已硬删）直接跳过不补位
   */
  protected async getDocs(hits: any[], cols?: ColsSpec, withScore?: boolean): Promise<any[]> {
    if (!hits.length) return [];

    // 字符串 _id 靠 mongoose 查询自动 cast（search 入口运行时不引 mongoose，见 2 节）
    const cond: Record<string, any> = {
      _id: { $in: hits.map(h => h._id) },
      ...this.getSoftDeleteCond(),
    };
    const find = this.getModel().find(cond);
    if  ( cols ) find.select( cols as any );

    const docs = await find.exec();
    const byId = new Map(docs.map(d => [String(d._id), d] as [string, any]));
    const out : any[] = [];
    for (const h of hits) {
      const doc = byId.get(String(h._id));
      if (! doc) continue;
      // wd 非空时把 _score 并入结果：strict 下 Document 普通属性赋值不进 toJSON，须写内部存储
      if (withScore && h._score !== undefined) (doc as any)._doc._score = h._score;
      out.push(doc);
    }
    return out;
  }

  /** sort -> ES sort 数组：打 keyword 主视角（即本名，见 termName），nested 字段补 nested 与 mode（升 min / 降 max），见 1.3；protected 供子类接入脚本排序（见 README 4.4） */
  protected getSort(sort: SortSpec): Record<string, any>[] {
    const out: Record<string, any>[] = [];
    for (const [field, dir] of Object.entries(sort)) {
      const leaf = this._leaves.get(field);
      if (!leaf) {
        throw new CrudError(
          `Sort field "${field}" is not in the ES index (syncable: false or unmappable type).`,
          CrudErrno.PARAMS_INVALID,
          { field },
        );
      }
      const chain = this.nestedChain(field);
      out.push({ [termName(leaf)]: {
        order: dir === -1 ? 'desc' : 'asc',
        // nested 数组元素各自有值，聚合后参与排序：升序取最小、降序取最大；path 用最内层
        ...(chain.length ? {
          mode  : dir === -1 ? 'max' : 'min',
          nested: { path: chain[chain.length - 1] },
        } : {}),
      } });
    }
    return out;
  }

  /**
   * 分面统计（见 4 节）：一次请求完成全部字段统计--query 只含 find + id + wd（不含 sels），
   * 每个统计字段一个 filter 聚合（条件为除自身外的 sels）内嵌 terms 子聚合，nested 字段再套
   * nested + reverse_nested（同 path 的 sels 下移到 nested 内部，见 1.3）取父文档数，
   * total 用应用全部 sels 的额外 filter 聚合的 doc_count（精确值，与 hits 无关）
   */
  statis(params: StatisParams, ctx: Context): StatisResult {
    return (async (): Promise<StatisResult> => {
      await this.makeIndex();

      const { id, wd, find, sels, cols, refs, tops = 10 } = params;
      const query = this.getQuery(find, id, wd);   // 不含 sels，各聚合自行叠加，见 4 节

      // sels -> 条件（空数组视为没选，不生成条件），联动语义与 Cradle.statis 一致
      const selConds: Record<string, EsCond[]> = {};
      if (sels) {
        for (const [field, values] of Object.entries(sels)) {
          if (!Array.isArray(values) || !values.length) continue;
          const conds: EsCond[] = [];
          this.fieldConds(field, { $in: values }, conds);
          selConds[field] = conds;
        }
      }

      // 统计目标 = 入索引 + countable 字段，再经 cols 白/黑名单过滤（判定方式与 Cradle.statis 相同）
      const countable = [...this._countable];
      let   targets   = countable;
      if (cols) {
        const mode = Object.values(cols).every(v => v === 1) ? 1 : 0;
        targets = countable.filter(f => (mode === 1 ? cols[f] === 1 : cols[f] !== 0));
      }

      const topsFor = (f: string): number => {
        if (typeof tops === 'number') return tops;
        if (tops && typeof tops === 'object' && (tops as any)[f] !== undefined) return (tops as any)[f];
        return 0;
      };

      // 总数：应用 find + id + wd + 全部 sels；无 sels 时 match_all 即 query 命中数
      const totalConds  = Object.values(selConds).flat();
      const totalFilter = totalConds.length ? { bool: { filter: emitAnd(totalConds) } } : { match_all: {} };
      const aggs: Record<string, any> = { __total: { filter: totalFilter } };

      // 每个字段 terms 桶的导航名（响应里子聚合是父聚合的直接属性）与计数取法
      const specs: Record<string, { nav: string[]; revNested: boolean }> = {};
      for (const f of targets) {
        const leaf  = this._leaves.get(f) as EsLeaf;
        const chain = this.nestedChain(f);
        const topN  = topsFor(f);
        const size  = topN > 0 ? topN : TERMS_MAX;   // 0 = 不限，取 ES 桶上限约定值

        // 除自身外的 sels：与被统计字段同 nested path（chain 为其前缀）的条件下移到 nested
        // 内部过滤（元素级联动，见 1.3），其余留在外层 filter（父文档上下文）
        const outer : EsCond[] = [];
        const levels: EsCond[][] = chain.map(() => []);
        for (const [sf, cs] of Object.entries(selConds)) {
          if (sf === f) continue;   // 已选字段统计自身时不套自己的 sels，见 4 节
          for (const c of cs) {
            const s = c.chain ?? [];
            if (s.length && s.length <= chain.length && s.every((p, i) => p === chain[i])) {
              levels[s.length - 1].push(c);
            } else {
              outer.push(c);
            }
          }
        }

        // terms 桶：打 keyword 主视角（即本名）；nested 字段经 reverse_nested 回根上下文，取 p.doc_count
        const nav: string[] = ['t'];
        let inner: Record<string, any> = {
          t: {
            terms: { field: termName(leaf), size },
            ...(chain.length ? { aggs: { p: { reverse_nested: {} } } } : {}),
          },
        };
        // 由内向外逐层包裹：先套该层同 path 条件的 filter，再套 nested（多级 nested 逐层进入）
        for (let i = chain.length - 1; i >= 0; i --) {
          if (levels[i].length) {
            inner = { f: { filter: { bool: { filter: levels[i].map(c => c.clause) } }, aggs: inner } };
            nav.unshift('f');
          }
          inner = { n: { nested: { path: chain[i] }, aggs: inner } };
          nav.unshift('n');
        }

        // missing：非嵌套直接 missing 聚合；嵌套字段的值在子文档上、父文档 doc_values 恒缺，
        // 改记「有值」数（filter + nested + exists），缺失 = 上下文总数 - 有值数
        const fieldAggs: Record<string, any> = chain.length
          ? { ...inner, m: { filter: { nested: { path: chain[chain.length - 1], query: { exists: { field: termName(leaf) } } } } } }
          : { ...inner, m: { missing: { field: termName(leaf) } } };
        const outerClauses = emitAnd(outer);
        aggs[f] = {
          filter: outerClauses.length ? { bool: { filter: outerClauses } } : { match_all: {} },
          aggs: fieldAggs,
        };
        specs[f] = { nav, revNested: !!chain.length };
      }

      const res = (await this.getClient().search({
        index : this.getIndex(),
        query,
        size  : 0,
        track_total_hits: false,   // total 由 __total 聚合给出，hits 总数省下不数
        aggs,
      } as any)) as any;

      // 逐字段取桶：值统一 String() 化；nested 取 reverse_nested 的 doc_count（父文档数）
      const aggsRes = res.aggregations ?? {};
      const hits   : Record<string, any[]> = {};
      for (const f of targets) {
        const { nav, revNested } = specs[f];
        let node = aggsRes[f];
        for (const k of nav) node = node?.[k];
        const list: any[] = [];
        for (const b of node?.buckets ?? []) {
          list.push({
            value: b.key === null || b.key === undefined ? '' : String(b.key),
            count: revNested ? b.p?.doc_count ?? 0 : b.doc_count,
          });
        }
        const miss = revNested   // nested：缺失 = filter 上下文总数 - 有值数
          ? Math.max(0, (aggsRes[f]?.doc_count ?? 0) - (aggsRes[f]?.m?.doc_count ?? 0))
          : aggsRes[f]?.m?.doc_count ?? 0;
        if (miss) list.push({ value: '', count: miss });
        hits[f] = list;
      }
      const result: StatisResult = { hits, total: aggsRes.__total?.doc_count ?? 0 };
      // 先正常 statis，最后调函数补充 refs
      const refsData = await fillStatisRefs(this.getRefPaths(), hits, refs, ctx);
      if (refsData) result.refs = refsData;
      return result;
    })() as unknown as StatisResult;
  }

  /* ---------- 文档同步：唯一 ES 写入出口，不查 mongo（见 5.1 - 5.3） ---------- */

  /** 写入后是否自动同步 ES（Schema 选项 esAutoSync，默认 true），false 则完全交给定时 syncFind */
  getAutoSync(): boolean {
    return this._esOpts.esAutoSync;
  }

  /** 按 id 从 ES bulk delete，无视 softDelete（ES 侧一律物理删除，只留有效文档），见 5.1 */
  async syncDels(ids: string[], opts?: SyncOpts): Promise<SyncStat> {
    if (!ids.length) {
      return { total: 0, indexed: 0, deleted: 0, failed: 0, errors: [] };
    }
    const index = this.getIndex();
    const operations = ids.map(id => ({ delete: { _index: index, _id: String(id) } }));
    return this.runBulk(operations, ids.map(String), opts);
  }

  /**
   * 文档 -> ES bulk（见 5.2）：逐个按 mapping 取入索引字段、拼装合并字段（getFullText）、
   * 同步戳置为当前时间；删除标记为真的转为 delete 动作，与 index 拼进同一个 bulk
   */
  async syncDocs(docs: any[], opts?: SyncOpts): Promise<SyncStat> {
    if (!docs.length) {
      return { total: 0, indexed: 0, deleted: 0, failed: 0, errors: [] };
    }

    const sd    = this.getSoftDelete();
    const df    = sd !== undefined ? (sd.isDeleted || 'isDeleted') : '-';
    const de    = sd !== undefined ? (sd.deleted !== undefined ? sd.deleted : true) : undefined;
    const index = this.getIndex();

    const operations: Record<string, any>[] = [];
    const ids   : string[] = [];
    for (const doc of docs) {
      const id = String(doc._id);
      ids.push(id);
      // 删除标记为真的转为 delete 动作（标记字段本身不入索引，只在此分流），见 5.1
      if (sd && getDocPath(doc, df) === de) {
        operations.push({ delete: { _index: index, _id: id } });
        continue;
      }
      operations.push({ index: { _index: index, _id: id } });
      operations.push(this.esDoc(doc));
    }
    return this.runBulk(operations, ids, opts);
  }

  /** 提交 bulk 并逐项结算 SyncStat：失败的计入 errors（截断前 20 条）并按 esSyncError 告警 */
  private async runBulk(operations: Record<string, any>[], ids: string[], opts?: SyncOpts): Promise<SyncStat> {
    const stat: SyncStat = { total: ids.length, indexed: 0, deleted: 0, failed: 0, errors: [] };
    await this.makeIndex();
    const res = (await this.getClient().bulk({
      refresh: opts?.refresh ?? false,
      operations,
    } as any)) as any;

    // items 与 action 一一对应（每个 doc / id 恰一个 action），delete 的 not_found 视同达成
    (res.items ?? []).forEach((it: any, i: number) => {
      const op = it.index ?? it.delete ?? {};
      if (op.error) {
        stat.failed ++;
        if (stat.errors.length < 20) stat.errors.push({ id: ids[i], ...op.error });
        this._esOpts.esSyncError(op.error, { index: this.getIndex(), id: ids[i] });
        return;
      }
      if (it.delete) stat.deleted ++; else stat.indexed ++;
    });
    return stat;
  }

  /** doc -> ES 文档：按 mapping 树裁剪入索引字段，拼装合并字段，同步戳置为当前时间，见 2.2 */
  private esDoc(doc: any): Record<string, any> {
    const src = pickByMapping(this._mapping, doc,
      new Set([this._esOpts.esFullText, this._esOpts.esSyncTime])) ?? {};
    src[this._esOpts.esFullText] = this.getFullText(doc);
    src[this._esOpts.esSyncTime] = new Date();
    return src;
  }

  /* ---------- 查询同步：查 mongo 后转文档同步（见 5.2） ---------- */

  /**
   * 按条件游标遍历 mongo（不排除伪删除，+isDeleted 取回标记），攒批交给 syncDocs；
   * 全量同步（不传或空 find）结束后无失败则补一次 syncCull({ since })，一趟完成补齐与清理且无空窗
   */
  async syncFind(find?: Record<string, any>, opts?: SyncFindOpts): Promise<SyncStat> {
    const d = this.getSoftDelete();
    const q = this.getModel().find(find ?? {});
    if (d) q.select('+' + (d.isDeleted || 'isDeleted')); // 伪删标记通常 select: false
    for(const f of this._selectFalse) q.select('+' + f); // 可同步字段须取全，见 5.2

    const stat: SyncStat = { total: 0, indexed: 0, deleted: 0, failed: 0, errors: [] };
    const buf : any[] = [];
    const flush = async (): Promise<void> => {
      if (!buf.length) return;
      const s = await this.syncDocs(buf, opts);
      stat.indexed += s.indexed;
      stat.deleted += s.deleted;
      stat.failed  += s.failed;
      stat.errors   = stat.errors.concat(s.errors).slice(0, 20);
      buf.length = 0;
    };

    // 游标逐个取、攒批提交 bulk（默认 1000）：内存平稳，且不似 skip 分页会漏记录，见 5.2
    const since = new Date();
    const batch = opts?.batch && opts.batch > 0 ? opts.batch : 1000;
    for await (const doc of q.cursor()) {
      stat.total ++;
      buf.push(doc);
      if (buf.length >= batch) await flush();
    }
    await flush();

    // 全量更新无失败
    if (!stat.failed && (!find || isEmptyObj(find))) {
      const p = await this.syncCull({ since, refresh: opts?.refresh });
      stat.deleted += p.deleted;
    }

    return stat;
  }

  /**
   * 删除同步戳早于水位的孤立记录（mongo 已不存在的），一条 delete_by_query 完成，
   * 含同步戳不存在的文档；since 必传，不给默认值以免误用，见 5.2
   */
  async syncCull(opts: SyncCullOpts): Promise<SyncStat> {
    if (!opts?.since) {
      throw new CrudError(
        '"since" is required for syncCull.',
        CrudErrno.PARAMS_INVALID,
        { },
      );
    }
    await this.makeIndex();
    const res = (await this.getClient().deleteByQuery({
      index  : this.getIndex(),
      // delete_by_query 的 refresh 只收 boolean（bulk 才有 'wait_for'），一律归一化
      refresh: !!opts.refresh,
      query  : { bool: { should: [
        { range: { [this._esOpts.esSyncTime]: { lt: opts.since } } },
        { bool: { must_not: [{ exists: { field: this._esOpts.esSyncTime } }] } },
      ], minimum_should_match: 1 } },
    } as any)) as any;

    const deleted = Number(res?.deleted ?? 0);
    const failures = res?.failures ?? [];
    return {
      total  : deleted,
      indexed: 0,
      deleted,
      failed : failures.length,
      errors : failures.slice(0, 20),
    };
  }

  /* ---------- 覆盖：写入后同步（见 5.1） ---------- */

  /** add：super 后同步 doc 进 ES；create 内部只调 add，自动获得同步能力 */
  add(data: Record<string, any>): [ any, string ] {
    return (async (): Promise<[ any, string ]> => {
      const [ doc, id ] = await super.add(data);
      await this.autoSync(() => this.syncDocs([ doc ]));
      return [ doc, id ];
    })() as unknown as [ any, string ];
  }

  /**
   * set：super 后同步查出的 doc；update / upsert / setAll 内部只调 set，自动获得同步能力。
   * Schema 有 select: false 的可同步字段时 findById 拿不到该字段（doc 不完整），
   * 降级 syncFind 回查（回查时对这些字段补 +field），见 5.1
   */
  set(id: string, data: Record<string, any>): [ any, number ] {
    return (async (): Promise<[ any, number ]> => {
      const [ doc, count ] = await super.set(id, data);
      if (count && doc) {
        await this.autoSync(() => this._selectFalse.size
          ? this.syncFind({ _id: id })
          : this.syncDocs([ doc ]));
      }
      return [ doc, count ];
    })() as unknown as [ any, number ];
  }

  /** putAll：updateMany 拿不到文档，super 后按 id 走查询同步 */
  putAll(ids: string[], data: Record<string, any>): number {
    return (async (): Promise<number> => {
      const count = await super.putAll(ids, data);
      if (count) await this.autoSync(() => this.syncFind({ _id: { $in: ids } }));
      return count;
    })() as unknown as number;
  }

  /** delAll：无论软删硬删，ES 侧结果都是「没有这条」，super 后直接按 id 物理删除 */
  delAll(ids: string[], data?: Record<string, any>): number {
    return (async (): Promise<number> => {
      const count = await super.delAll(ids, data);
      if (count) await this.autoSync(() => this.syncDels(ids));
      return count;
    })() as unknown as number;
  }

  /**
   * 自动同步的统一出口：esAutoSync 为 false 直接跳过（显式调 sync* 不受影响）；
   * 失败不回滚、不影响写入方法的返回值（mongo 是权威数据源），仅按 esSyncError 告警，见 5.3
   */
  private async autoSync(fn: () => Promise<SyncStat>): Promise<void> {
    if (!this._esOpts.esAutoSync) return;
    try {
      await fn();
    } catch (err) {
      this._esOpts.esSyncError(err, { index: this.getIndex() });
    }
  }
}

/* ---------- Helpers：mapping 推导 ---------- */

/**
 * 递归收集叶子字段与容器声明
 * prefix 为所属点号前缀；isRoot 时按 skipRoot 排除软删除标记
 * 内联子对象以点号路径直接出现在 paths，容器（Embedded / 数组子文档）经 path.schema 递归
 */
function walkSchema(
  schema    : Schema,
  prefix    : string,
  isRoot    : boolean,
  wo        : { skipRoot: Set<string>; esAnalyzer?: string },
  out       : { leaves: EsLeaf[]; nestes: Map<string, boolean> },
): void {
  for (const [name, path] of Object.entries(schema.paths)) {
    if (name.startsWith('__')) continue;                 // 系统内部
    if (name.includes ('$*')) continue;                  // Map 的值类型路径
    if (name === '_id' || name.endsWith('._id')) continue; // 元数据：根级作 ES _id，子级不入索引
    if (isRoot && wo.skipRoot.has(name)) continue;       // 软删除标记不入索引

    const opts = (path as any).options || {};

    // 配置矛盾：countable 却 syncable: false
    if (opts.countable && opts.syncable === false) {
      throw new CrudError(
        `Field "${name}" is countable but syncable: false, remove one of them.`,
        CrudErrno.INTERNEL_ERROR,
        { field: name },
      );
    }
    if (opts.syncable === false) continue;                // 叶子或整棵子树不进索引

    const full = prefix + name;
    const inst = (path as any).instance;

    if (inst === 'Embedded') {
      // 单个子文档：object，递归
      walkSchema((path as any).schema, full + '.', false, wo, out);
      out.nestes.set(full, false);
      continue;
    }

    if (inst === 'Array') {
      const sub = (path as any).schema;
      if (sub) {
        // 数组子文档：默认扁平 object，标 nested: true 才保留元素关联，见 1.3
        walkSchema(sub, full + '.', false, wo, out);
        out.nestes.set(full, opts.nested === true);
        continue;
      }
      // 标量数组：按元素类型推导（ES 数组与标量同 mapping）
      const cast = (path as any).caster || (path as any).$embeddedSchemaType;
      const leaf = cast ? getLeaf(full, opts, cast.instance, wo.esAnalyzer) : undefined;
      if (leaf) out.leaves.push(leaf);
      continue;
    }

    const leaf = getLeaf(full, opts, inst, wo.esAnalyzer);
    if (leaf) out.leaves.push(leaf);
  }
}

/**
 * 单个叶子字段的 ES 类型推导
 * opts 为字段定义项（数组取数组定义项），instance 为本体 / 数组元素的 mongoose 类型名
 * 不可映射的类型（Map / Mixed / Buffer 等）返回 undefined
 */
function getLeaf(
  name    : string,
  opts    : Record<string, any>,
  instance: string,
  esAnalyzer?: string,
): EsLeaf | undefined {
  let kind: EsLeaf['kind'];
  switch (instance) {
    case 'String'    : kind = 'keyword'; break;   // String 主类型 keyword，textable 附 .text 子字段，见 leafMapping
    case 'ObjectId'  :
    case 'ObjectID'  : kind = 'keyword'; break;
    case 'Number'    :
    case 'Decimal128': kind = 'double' ; break;
    case 'Boolean'   : kind = 'boolean'; break;
    case 'Date'      : kind = 'date'   ; break;
    default          : return undefined;
  }
  // textable 仅对 String 有效，其余类型标了视为未标（与旧 canText 的静默语义一致）
  const textable = instance === 'String' && opts.textable === true;
  const termsize = textable ? opts.termsize : undefined;   // 仅 textable 生效
  if (opts.analyzer && !textable) {
    throw new CrudError(
      `Field "${name}" is not textable in ES, analyzer is for textable String only.`,
      CrudErrno.INTERNEL_ERROR,
      { field: name },
    );
  }
  return {
    name,
    kind     : textable && termsize === 0 ? 'text' : kind,   // termsize: 0 时无 keyword 视角，主字段纯 text
    analyzer : textable ? (opts.analyzer || esAnalyzer) : undefined,
    termsize,
    textable,
    countable: opts.countable === true,
  };
}

/**
 * 由叶子清单装配 mapping
 * 未被任何叶子引用的容器不出现（其子树必已全部排除）；
 * 合并字段与同步戳为组件内部字段，随 mapping 显式定义，见 1.2
 */
function makeMapping(
  leaves: EsLeaf[],
  nestes: Map<string, boolean>,
  esOpts: EsOpts,
): Record<string, any> {
  const properties: Record<string, any> = {};

  for (const leaf of leaves) {
    const keys = leaf.name.split('.');
    // 逐层找到（或建出）所属容器：声明的 nested 取 nested，其余一律 object
    let host = properties;
    for (let i = 0; i < keys.length - 1; i ++) {
      const ck = keys.slice(0, i + 1).join('.');
      if (!host[keys[i]]) {
        host[keys[i]] = {
          type    : nestes.get(ck) === true ? 'nested' : 'object',
          dynamic : 'strict',
          properties: {},
        };
      }
      host = host[keys[i]].properties;
    }
    host[keys[keys.length - 1]] = leafMapping(leaf);
  }

  // 合并字段：不用 copy_to，内容一律由 getFullText() 自行拼装后随文档写入
  properties[esOpts.esFullText] = {
    type: 'text',
    ...(esOpts.esAnalyzer ? { analyzer: esOpts.esAnalyzer } : {}),
  };
  // 同步戳：syncDocs 每次写入时置为当前时间，不开放给 find / sort / statis 引用
  properties[esOpts.esSyncTime] = { type: 'date' };

  return {
    dynamic   : 'strict',
    _source   : { excludes: [esOpts.esFullText] },   // 倒排照建，不占 _source 空间
    properties,
  };
}

/** 叶子字段的 ES mapping（对照表见 1.2） */
function leafMapping(leaf: EsLeaf): Record<string, any> {
  switch (leaf.kind) {
    case 'text':
      // textable 且 termsize: 0：无 keyword 视角，主字段直接 text（只搜不精确匹配，等值 / 排序 / 聚合不可用）
      return { type: 'text', ...(leaf.analyzer ? { analyzer: leaf.analyzer } : {}) };
    case 'keyword': {
      // String / ObjectId 主类型 keyword（term 视角：等值 / 排序 / 聚合）；textable 附 .text 子字段（分词
      // 视角：wd / $search）；termsize 控制 ignore_above（见 1.1）：默认 256（超过的长串不进 keyword，
      // 等值匹配本就不可靠），-1 不限，仅 textable 生效
      const size = leaf.termsize ?? 256;
      return {
        type: 'keyword',
        ...(size >= 0 ? { ignore_above: size } : {}),
        ...(leaf.textable ? { fields: { text: { type: 'text', ...(leaf.analyzer ? { analyzer: leaf.analyzer } : {}) } } } : {}),
      };
    }
    case 'double' : return { type: 'double' };
    case 'boolean': return { type: 'boolean' };
    case 'date'   : return { type: 'date' };
  }
}

/**
 * 按点号路径取值，数组感知（跨数组子文档取叶子时逐元素下钻，得扁平数组）
 * mongoose 文档 / 子文档走 get，普通对象下标取值
 */
function getDocPath(doc: any, name: string): any {
  let cur = doc;
  for (const k of name.split('.')) {
    if (cur === undefined || cur === null) return cur;
    if (Array.isArray(cur)) {
      cur = cur.map(el => getDocVal(el, k));
      continue;
    }
    cur = getDocVal(cur, k);
  }
  return cur;
}

/** 取单段字段：mongoose 文档 / 子文档走 get，普通对象下标取值 */
function getDocVal(val: any, name: string): any {
  if (val === undefined || val === null) return val;
  if (typeof val.get === 'function') return val.get(name);
  return val[name];
}

/**
 * 按 mapping 树从 doc 裁剪出 ES _source（syncDocs 用，见 5.2）：保证写入字段与 mapping
 * 声明一致（dynamic: 'strict' 下漏推即写入失败）；容器递归（数组逐元素裁剪、丢空元素），
 * 叶子取值后原样保留；skip 的根级内部字段（合并字段 / 同步戳）由调用方另行赋值
 */
function pickByMapping(
  node : Record<string, any>,
  val  : any,
  skip?: Set<string>,
): Record<string, any> | undefined {
  if (val === undefined || val === null) return undefined;
  const out: Record<string, any> = {};
  for (const [name, sub] of Object.entries(node.properties as Record<string, any>)) {
    if (skip?.has(name)) continue;
    const v = getDocVal(val, name);
    if (v === undefined) continue;
    if (sub.properties) {
      const picked = Array.isArray(v)
        ? v.map(el => pickByMapping(sub, el)).filter(p => p !== undefined)
        : pickByMapping(sub, v);
      if (picked !== undefined && (!Array.isArray(picked) || picked.length)) out[name] = picked;
      continue;
    }
    out[name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * mapping 递归 diff（供 pushMapping，见 1.4）
 * want 有而 have 无的字段整棵原样进 body；已有叶子一律不传；
 * 两侧同为容器时下钻（重述 type 以进入子层，dynamic 不重发，既有定义不动），
 * added 收集新增叶子字段的点号路径
 */
function diffMapping(
  want  : Record<string, any>,
  have  : Record<string, any>,
  body  : Record<string, any>,
  prefix: string,
  added : string[],
): void {
  for (const [name, wm] of Object.entries(want)) {
    const hm = have?.[name];
    if (!hm) {
      // 整棵新子树：原样推（含 dynamic: 'strict' 与全部子字段）
      body[name] = wm;
      deepMapping(wm, prefix + name, added);
    } else if (wm.properties && hm.properties) {
      // 两侧同为容器：下钻，只带走新增子字段
      const sub: Record<string, any> = { type: wm.type, properties: {} };
      diffMapping(wm.properties, hm.properties, sub.properties, prefix + name + '.', added);
      if (Object.keys(sub.properties).length) body[name] = sub;
    }
    // 已存在的叶子（含两侧结构不一致的）一律不传，避免触发类型冲突报错
  }
}

/** 收集整棵子树内的叶子字段名（点号路径），即 pushMapping 的返回内容 */
function deepMapping(
  node  : Record<string, any>,
  prefix: string,
  added : string[]
): void {
  if (node.properties) {
    for (const [name, sub] of Object.entries(node.properties as Record<string, any>)) {
      deepMapping(sub, prefix + '.' + name, added);
    }
  } else {
    added.push(prefix);
  }
}

/* ---------- Helpers：find -> DSL 翻译 ---------- */

/**
 * 精确匹配类子句（term / terms / regexp / range）与排序 / 聚合用的字段名：
 * String / ObjectId 主类型即 keyword 本名；termsize: 0 的纯 text 主字段打本名（分词语义，整串不精确），见 2.1
 */
function termName(leaf: EsLeaf): string {
  return leaf.name;
}

/**
 * 分词匹配（match）用的字段名：textable 取 .text 子字段，termsize: 0 时主字段即 text
 */
function textName(leaf: EsLeaf): string {
  return leaf.kind === 'text' ? leaf.name : leaf.name + '.text';
}

/**
 * and 语境发射：叶子条件按 nested path 链归组、由内向外逐层包裹为一个 nested 子句（同一 path
 * 的多个条件须合并且于同一元素满足，见 1.3），其余子句（ids / $or / $not 等）原样并列
 */
function emitAnd(conds: EsCond[]): Record<string, any>[] {
  const out    : Record<string, any>[] = [];
  const groups = new Map<string, { chain: string[]; clauses: Record<string, any>[]; at: number }>();

  for (const { clause, chain } of conds) {
    if (!chain || !chain.length) { out.push(clause); continue; }
    const key = chain.join('\u0000');
    let g = groups.get(key);
    if (!g) {
      g = { chain, clauses: [], at: out.length };
      groups.set(key, g);
      out.push(undefined as any);   // 占位：该组首个条件的位置，稍后回填合并后的 nested 子句
    }
    g.clauses.push(clause);
  }

  for (const { chain, clauses, at } of groups.values()) {
    // 最内层收纳该 path 的全部条件，外层逐个嵌套包裹，内层 path 用全路径（a.b），见 1.3
    let wrapped: Record<string, any> = { bool: { filter: clauses } };
    for (let i = chain.length - 1; i >= 0; i --) {
      wrapped = { nested: { path: chain[i], query: wrapped } };
    }
    out[at] = wrapped;
  }
  return out;
}

/** 是否普通对象（排除 null / Date / 数组） */
function isPlainObj(v: any): boolean {
  return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/** 是否空的对象（排除 null / Date / 数组）（即无键值对） */
function isEmptyObj(v: any): boolean {
  return isPlainObj(v) && Object.keys(v).length === 0;
}
