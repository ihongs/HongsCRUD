// 文档：轻量全文检索组件（MongoDB text 索引 + 分词字段）
// 不依赖外部搜索引擎，把分词结果落到集合内的 fullText 字段，查询时用相同分词器处理 wd 参数。

import type { Schema, Model } from 'mongoose';
import type { Segmenter, SearchConf, SearchOpts, JiebaOpts } from './types';
import type { SearchParams, SearchResult, StatisParams, StatisResult, Context } from '../types';
import { Cradle, CrudError, CrudErrno } from '../index';

export * from './types';

export class Chaser extends Cradle {
  private readonly _opts: SearchConf;
  private readonly _textable: Set<string>;
  private readonly _textableUnselected: Set<string>;

  /**
   * 构造期只做 Schema 推导与配置校验，不触达数据库。
   * - 自动补 fullText 字段（不存在时），其 text 索引由全局 mongoose 插件按 searchOpts 建立
   * - 自动补打分字段（不存在时）
   * - 收集 textable: true 的 String 字段
   */
  constructor(schema: Schema, model?: Model<any>) {
    const sopts = (((schema as any).options || {}).searchOpts || {}) as SearchOpts;
    const fullText = sopts.fullText || 'fullText';
    const scoreKey = sopts.scoreKey || '_score';

    const field = schema.path(fullText) as any;
    if (field && field.instance !== 'String') {
      throw new CrudError(
        `Search field "${fullText}" must be a String.`,
        CrudErrno.INTERNEL_ERROR,
        { field: fullText },
      );
    }
    if (!field) {
      schema.add({ [fullText]: { type: String, select: false } } as any);
    }

    // 打分字段须在 schema 中声明，否则 $meta 投影会被 mongoose 水合时丢弃
    const score = schema.path(scoreKey) as any;
    if (score && score.instance !== 'Number') {
      throw new CrudError(
        `Score field "${scoreKey}" must be a Number.`,
        CrudErrno.INTERNEL_ERROR,
        { field: scoreKey },
      );
    }
    if (!score) {
      schema.add({ [scoreKey]: { type: Number, select: false } } as any);
    }

    super(schema, model);

    this._opts = {
      fullText,
      scoreKey,
      segmenter: sopts.segmenter || defaultSegmenter,
    };
    this._textable = collectTextable(schema, '', new Set<string>(), fullText);
    this._textableUnselected = new Set(
      [...this._textable].filter(f => ((schema.path(f) as any)?.options || {}).select === false),
    );
  }

  /** 参与全文的字段集合（textable: true 的 String） */
  getTextable(): Set<string> {
    return this._textable;
  }

  /* ---------- 分词 ---------- */

  /**
   * 拼装全文并分词：默认读取所有 textable: true 字段，扁平化数组、去空后分词。
   * 子类可覆盖以补充码值标签、关联名称等派生文本。
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
    return this.getFindText(vals.join(' '));
  }

  /** 查询关键词分词，结果以空格拼接后交给 $text */
  protected getFindText(text: string): string {
    if (!text) return '';
    return this._opts.segmenter(text)
      .map(t => String(t ?? '').trim())
      .filter(Boolean)
      .join(' ');
  }

  /* ---------- 写入：维护全文 ---------- */

  /** add：先按入参生成 fullText，再交给 Cradle 落库（create / upsert 新增均走这里） */
  add(data: Record<string, any>): [ any, string ] {
    const payload = { ...(data || {}), [this._opts.fullText]: this.getFullText(data) };
    return super.add(payload);
  }

  /** set：落库后按合并结果重算 fullText（update / setAll / upsert 更新均走这里） */
  set(id: string, data: Record<string, any>): [ any, number ] {
    return (async (): Promise<[ any, number ]> => {
      const [ doc, count ] = await (super.set(id, data) as unknown as Promise<[ any, number ]>);
      if (! doc || ! count) return [ doc, count ];

      const src = this._textableUnselected.size ? await this.loadTextDoc(id) : doc;
      await this.getModel().collection.updateOne(
        { _id: doc._id },
        { $set: { [this._opts.fullText]: this.getFullText(src) } },
      );
      return [ doc, count ];
    })() as unknown as [ any, number ];
  }

  /** select: false 的 textable 字段默认查不出来，按 id 补 +field 回查 */
  private async loadTextDoc(id: string): Promise<any> {
    const fields = [...this._textable];
    if (!fields.length) return null;
    return this.getModel()
      .findById(id)
      .select(fields.map(f => '+' + f).join(' '))
      .lean()
      .exec();
  }

  /* ---------- 查询：分词 + 打分 ---------- */

  /**
   * wd 先经 getFindText 分词，再走 $text.$search
   * 自动把评分加入投影和排序
   */
  search(params: SearchParams, ctx: Context): SearchResult {
    const wd = typeof params.wd === 'string' ? params.wd.trim() : '';
    if (! wd) return super.search(params, ctx);

    const text = this.getFindText(wd);
    if (! text) {
      const { wd: _omit, ...rest } = params;
      return super.search(rest as SearchParams, ctx);
    }

    const score = this._opts.scoreKey;

    const next: SearchParams = { ...params, wd: text };
    if (! params.sort) next.sort = { [score]: { $meta: 'textScore' } } as any;
    if (! params.cols) next.cols = { [score]: { $meta: 'textScore' } } as any;
    else next.cols = { ...next.cols, [score]: { $meta: 'textScore' } } as any;

    return super.search(next, ctx);
  }

  /**
   * wd 同样先经 getFindText 分词，其余沿用 Cradle.statis
   */
  statis(params: StatisParams, ctx: Context): StatisResult {
    const wd = typeof params.wd === 'string' ? params.wd.trim() : '';
    if (! wd) return super.statis(params, ctx);

    const text = this.getFindText(wd);
    if (! text) {
      const { wd: _omit, ...rest } = params;
      return super.statis(rest as StatisParams, ctx);
    }

    return super.statis({ ...params, wd: text }, ctx);
  }
}

/* ---------- 内部工具 ---------- */

/** 递归收集 textable: true 的 String 叶子字段（含子文档点号路径） */
function collectTextable(
  schema: Schema,
  prefix: string,
  out: Set<string>,
  fullText: string,
): Set<string> {
  for (const [name, path] of Object.entries(schema.paths)) {
    if (name.startsWith('__')) continue;
    if (name.includes('$*')) continue;
    if (name === '_id' || name.endsWith('._id')) continue;

    const full = prefix + name;
    if (full === fullText) continue;

    const opts = ((path as any).options || {}) as Record<string, any>;
    const inst = (path as any).instance;

    if (inst === 'Embedded') {
      collectTextable((path as any).schema, full + '.', out, fullText);
      continue;
    }

    if (inst === 'Array') {
      const sub = (path as any).schema;
      if (sub) {
        collectTextable(sub, full + '.', out, fullText);
        continue;
      }
      const cast = (path as any).caster || (path as any).$embeddedSchemaType;
      if (cast?.instance === 'String' && opts.textable === true) out.add(full);
      continue;
    }

    if (inst === 'String' && opts.textable === true) out.add(full);
  }
  return out;
}

/** 取点号路径值；数组逐元素展开 */
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

/** 取单段字段：mongoose 文档走 get，普通对象下标取值 */
function getDocVal(val: any, name: string): any {
  if (val === undefined || val === null) return val;
  if (typeof val.get === 'function') return val.get(name);
  return val[name];
}

/** 默认分词器：Intl.Segmenter（word 粒度，过滤非词项并小写） */
export const defaultSegmenter: Segmenter = (() => {
  const seg = new (Intl as any).Segmenter(undefined, { granularity: 'word' });
  return (text: string) => [...seg.segment(text)]
    .filter((s: any) => s.isWordLike)
    .map((s: any) => String(s.segment).toLowerCase());
})();

/**
 * 构造 jieba 分词器：需自行安装 @node-rs/jieba（可选 peer 依赖），首次调用时惰性加载，
 * 未安装则抛 INTERNEL_ERROR；分词结果统一小写。
 * mode 缺省为 cut（精确分词），传 'search' 走 cutForSearch（含子词，召回更高，文本也更长）。
 */
export function buildJiebaSegmenter(opts: JiebaOpts = {}): Segmenter {
  const { mode = 'cut', hmm } = opts;
  return (text: string) => {
    const jieba = loadJieba();
    const words = mode === 'search' ? jieba.cutForSearch(text, hmm) : jieba.cut(text, hmm);
    return words.map((w: string) => String(w).toLowerCase());
  };
}

/** 惰性加载 jieba 实例（词典只加载一次） */
let JIEBA: any;
function loadJieba(): any {
  if (! JIEBA) {
    try {
      const { Jieba } = require('@node-rs/jieba');
      const { dict }  = require('@node-rs/jieba/dict');
      JIEBA = Jieba.withDict(dict);
    } catch (err) {
      throw new CrudError(
        'buildJiebaSegmenter() requires "@node-rs/jieba". Install it or pass your own segmenter.',
        CrudErrno.INTERNEL_ERROR,
      );
    }
  }
  return JIEBA;
}
