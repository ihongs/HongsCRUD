// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

import mongoose, { Schema, Model } from 'mongoose';
import type {
  Func,
  Crud,
  Context,
  SoftDel,
  RefItem,
  RefPath,
  RefsSpec,
  ColsSpec,
  SearchParams,
  SearchResult,
  CreateParams,
  CreateResult,
  UpdateParams,
  UpdateResult,
  DeleteParams,
  DeleteResult,
  StatisParams,
  StatisResult,
  UpsertParams,
  UpsertResult,
  UpsertError,
  SchemaParams,
  SchemaResult,
  SchemaNode,
} from './types';

export * from './types';

/* ---------- Cruds ---------- */

const CRUDS: Record<string, Crud> = {};

export function regCrud(name: string, crud: Crud): void {
  CRUDS[name] = crud;
}

export function hasCrud(name: string): boolean {
  return name in CRUDS;
}

export function getCrud(name: string): Crud {
  if (!CRUDS[name]) {
    throw new CrudError(`Crud "${name}" is not registered. Call regCrud() first.`, CrudErrno.METHOD_MISSING);
  }
  return CRUDS[name];
}

export function getCrudNames(): string[] {
  return Object.keys(CRUDS);
}

/* ---------- Funcs ---------- */

const FUNCS: Record<string, Func> = {};

export function regFunc(name: string, func: Func): void {
  FUNCS[name] = func;
}

export function hasFunc(name: string): boolean {
  return name in FUNCS;
}

export function getFunc(name: string): Func {
  if (!FUNCS[name]) {
    throw new CrudError(`Func "${name}" is not registered. Call regFunc() first.`, CrudErrno.METHOD_MISSING);
  }
  return FUNCS[name];
}

export function getFuncNames(): string[] {
  return Object.keys(FUNCS);
}

/* ---------- Roles ---------- */

const ROLES: Record<string, Set<string>> = {};

export function regRole(role: string, acts: string[] | Set<string>): void {
  ROLES[role] = acts instanceof Set ? acts : new Set(acts);
}

export function hasRole(role: string): boolean {
  return role in ROLES;
}

export function getRole(role: string): Set<string> {
  if (!ROLES[role]) {
    throw new CrudError(`Role "${role}" is not registered. Call regRole() first.`, CrudErrno.RIGHT_DEPRIVED);
  }
  return ROLES[role];
}

export function getRoleNames(): string[] {
  return Object.keys(ROLES);
}

/* ---------- Error ---------- */

export class CrudError extends Error {
  constructor(
    message: string,
    public readonly code?: number, // JSON-RPC error code, -32001 无权限, -32601 找不到接口方法, -32602 找不到目标数据(不存在或不可操作)
    public readonly data?: Record<string, any>
  ) {
    super(message);
  }
}

export enum CrudErrno {
  METHOD_MISSING = -32601,
  PARAMS_INVALID = -32602,
  INTERNEL_ERROR = -32603,
  LOGIN_REQUIRED = -32001,
  RIGHT_DEPRIVED = -32003,
  ALTER_REJECTED = -32009,
}

/* ---------- Cradle ---------- */

export class Cradle implements Crud {
  private readonly _schema: Schema;
  private readonly _model: Model<any>;
  private _refPaths?: RefPath[];

  callable = ['create', 'update', 'delete', 'search', 'statis', 'upsert', 'schema'];

  constructor(
    schema: Schema,
    model?: Model<any>,
  ) {
    if (! schema.options.collection) {
      throw new Error(`Schema 'schema.options.collection' required.`);
    }
    this._schema = schema;
    this._model = model || mongoose.model(schema.options.collection || '', schema);
  }

  getSchema(): Schema {
    return this._schema;
  }

  getModel(): Model<any> {
    return this._model;
  }

  /**
   * refs 字段路径（缓存）
   * 首次调用遍历 schema 收集，之后复用，避免每次 search / statis 重复遍历
   */
  protected getRefPaths(): RefPath[] {
    if (! this._refPaths) this._refPaths = getRefPaths(this.getSchema());
    return this._refPaths;
  }

  /**
   * 伪删除配置
   * true 规范化为 { isDeleted: 'isDeleted' }
   */
  getSoftDelete(): SoftDel | undefined {
    const sd = (this.getSchema() as any).get('softDelete') as SoftDel | boolean | undefined;
    if (sd === true) {
      return { isDeleted: 'isDeleted', deleted: true };
    }
    if (sd) {
      return sd as SoftDel;
    }
  }

  /**
   * 排除伪删除数据的条件
   */
  getSoftDeleteCond(): Record<string, any> | undefined {
    const sd = this.getSoftDelete();
    if (!sd) return undefined;
    const de = sd.deleted !== undefined ? sd.deleted : true;
    return { [sd.isDeleted || 'isDeleted']: { '$ne': de } };
  }

  /**
   * 伪删除时要写入的数据
   * 未指定 deletedAt: false 则同时写入删除时间
   */
  getSoftDeleteData(): Record<string, any> | undefined {
    const sd = this.getSoftDelete();
    if (!sd) return undefined;
    const de = sd.deleted !== undefined ? sd.deleted : true;
    const data: Record<string, any> = {
      [sd.isDeleted || 'isDeleted']: de,
      [sd.deletedAt || 'deletedAt']: new Date(),
    };
    return data;
  }

  getCountCols(): string[] {
    const cts: string[] = [];
    for (const [key, path] of Object.entries(this.getSchema().paths)) {
      if (key.startsWith('__')) continue;
      const ops = (path as any).options || {};
      if (ops.countable) cts.push( key );
    }
    return cts;
  }

  /* ---------- core methods ---------- */

  /**
   * 添加一个文档
   * 触发完整 validator
   * 返回 [ doc, id ]
   */
  add(data: Record<string, any>): [ any, string ] {
    const Model = this.getModel();
    return Model.create(data)
      .then((doc: any) => [ doc, String(doc._id) ]) as unknown as [ any, string ];
  }

  /**
   * 更新一个文档
   * 触发完整 validator
   * 返回 [ doc, count ]，未命中时 doc 为 null
   */
  set(id: string, data: Record<string, any>): [ any, number ] {
    const Model = this.getModel();
    return Model.findById(id).exec()
      .then((doc: any) => {
        if (!doc) return [ null, 0 ];

        // 局部更新
        for (const key of Object.keys(data)) {
          doc.set(key, data[key]);
        }

        // mongoose 自动深度比较，值未变的不算 modified
        const changed = doc.modifiedPaths().length > 0;
        if (! changed) return [ doc, 0 ];

        return doc.save().then(() => [ doc, 1 ]);
      }) as unknown as [ any, number ];
  }

  /**
   * 更新多个文档
   * 触发完整 validator
   * 逐个调用 set(id, data)
   */
  setAll(ids: string[], data : Record<string, any>): number {
    return (async (): Promise<number> => {
      let count = 0;
      for (const id of ids) {
        const [ , n ] = await (this.set(id, data) as unknown as Promise<[ any, number ]>);
        count += n;
      }
      return count;
    })() as unknown as number;
  }

  /**
   * 更新多个文档
   * 不触发任何的 validator
   */
  putAll(ids: string[], data : Record<string, any>): number {
    const Model = this.getModel();
    const cond = mixFinds(ids, undefined);
    return Model.updateMany(cond, { $set: data }).exec()
      .then(res => Number(res.modifiedCount ?? 0)) as unknown as number;
  }

  /**
   * 删除多个文档
   * 不触发任何的 validator
   */
  delAll(ids: string[], data?: Record<string, any>): number {
    const Model = this.getModel();
    const cond = mixFinds(ids, undefined);
    const sdel = this.getSoftDeleteData();
    if (sdel) {
      // 排除已伪删除的, 免得重复标记刷新删除时间
      const scnd = this.getSoftDeleteCond();
      return Model.updateMany({ ...cond, ...scnd }, { $set: sdel }).exec()
        .then(res => Number(res.modifiedCount ?? 0)) as unknown as number;
    } else {
      return Model.deleteMany(cond).exec()
        .then(res => Number(res. deletedCount ?? 0)) as unknown as number;
    }
  }

  /**
   * 检查可操作的文档
   * action 可选 update,delete
   */
  chkIds(ids: string[], find?: Record<string, any>, force?: boolean, action: string = 'update'): Promise<string[]> {
    const Model = this.getModel();
    const cond = mixFinds(ids, undefined, find);
    return Model.find(cond).select('_id').lean().exec()
      .then(docs => {
        const   existIds = new Set(docs.map(doc => String((doc as any)._id)));
        const   operable: string[] = [];
        const unoperable: string[] = [];
        for (const id of ids) {
          const key = String(id);
          if (existIds.has (key)) {
              operable.push(key);
          } else {
            unoperable.push(key);
          }
        }

        if (unoperable.length && !force) {
          throw new CrudError(
            `Cannot ${action}, ids not found or not permitted: ${unoperable.join(', ')}`,
            CrudErrno.ALTER_REJECTED,
            { ids: unoperable },
          );
        }

        return operable;
      });
  }

  /* ---------- Crud interface ---------- */

  create(params: CreateParams, _ctx: Context): CreateResult {
    return (this.add(params.data) as unknown as Promise<[ any, string ]>)
      .then(([ , id ]) => ({ id })) as unknown as CreateResult;
  }

  update(params: UpdateParams, _ctx: Context): UpdateResult {
    const { id, find, data, force } = params;
    const ids = Array.isArray(id) ? id : [id];

    // 一次性查出所有 id + find 条件下存在的 _id，避免 N 次查询
    return this.chkIds(ids, find, force, 'update').then(operable => {
        if (!operable.length) return { affected: 0, validIds: [] };

        return (this.setAll(operable, data) as unknown as Promise<number>)
          .then(count => ({ affected: count, validIds: operable }));
      }) as unknown as UpdateResult;
  }

  delete(params: DeleteParams, _ctx: Context): DeleteResult {
    const { id, data, find, force } = params;
    const ids = Array.isArray(id) ? id : [id];

    // 一次性查出所有 id + find 条件下存在的 _id，避免 N 次查询
    return this.chkIds(ids, find, force, 'delete').then(operable => {
        if (!operable.length) return { affected: 0, validIds: [] };

        return (this.delAll(operable, data) as unknown as Promise<number>)
          .then(count => ({ affected: count, validIds: operable }));
      }) as unknown as DeleteResult;
  }

  search(params: SearchParams, ctx: Context): SearchResult {
    const { id, wd, mode, find = {}, sort, cols, refs, start = 0 } = params;
    const Model = this.getModel();
    const sdel  = this.getSoftDeleteCond();
    const cond  = mixFinds(id, wd, find, sdel);

    // 0 不限，默认 limitDef，受 limitMax 约束
    const opts  = (this.getSchema() as any).options || {};
    const limitDef = opts.limitDef !== undefined ? opts.limitDef : 1;
    const limitMax = opts.limitMax !== undefined ? opts.limitMax : 1000;
    let   limit = params.limit !== undefined ? params.limit : limitDef ;
    if (limitMax > 0 && (limit === 0 || limit > limitMax)) {
      throw new CrudError(
        `Limit ${limit} exceeds max ${limitMax}`,
        CrudErrno.PARAMS_INVALID,
        { limit, limitMax },
      );
    }

    const buildQuery = () => {
      const q = Model.find(cond);
      if (cols ) q.select(cols as any);
      if (sort ) q.sort  (sort as any);
      if (start) q.skip  (start);
      if (limit) q.limit (limit);
      return q;
    };

    // 先正常 search，最后调函数补充 refs（only-total 无 list 不需要）
    const withRefs = (promise: Promise<any>): Promise<any> =>
      promise.then(async result => {
        const refsData = await fillSearchRefs(this.getRefPaths(), result.list || [], refs, ctx);
        if (refsData) result.refs = refsData;
        return result;
      });

    if (mode === 'only-total') {
      return Model.countDocuments(cond).then(total => ({ total })) as unknown as SearchResult;
    }

    if (mode === 'only-list') {
      return withRefs(buildQuery().exec().then(list => ({ list }))) as unknown as SearchResult;
    }

    if (mode === 'list-more') {
      return withRefs(Promise.all([
        buildQuery().exec(),
        Model.findOne(cond).skip(start + limit).select('_id').lean().exec(),
      ]).then(([list, more]) => ({ list, more: !!more }))) as unknown as SearchResult;
    }

    return withRefs(Promise.all([
      buildQuery().exec(),
      Model.countDocuments(cond),
    ]).then(([list, total]) => ({ list, total }))) as unknown as SearchResult;
  }

  statis(params: StatisParams, ctx: Context): StatisResult {
    const { id, wd, find = {}, sels, cols, refs, tops = 10 } = params;
    const Model = this.getModel();
    const sdel  = this.getSoftDeleteCond();

    const baseCond: Record<string, any> = mixFinds(id, wd, find, sdel);

    // sels 转 $in 查询（空数组视为没值，不生成任何条件）
    const selConds: Record<string, any> = {};
    if (sels) {
      for (const [field, values] of Object.entries(sels)) {
        if (!Array.isArray(values) || !values.length) continue;
        selConds[field] = { $in: values };
      }
    }

    // 应用全部条件（find + sdel + sels 中所有非空）
    const totalCond    = { ...baseCond, ...selConds };
    const totalPromise = Model.countDocuments(totalCond).exec();

    // 若传了 cols，按白/黑名单过滤；否则统计全部 countable
    let targets: string[] = this.getCountCols();
    if (cols) {
      const mode = Object.values(cols).every(v => v === 1) ? 1 : 0;
      targets = targets.filter(f => mode === 1 ? cols[f] === 1 : cols[f] !== 0);
    }
    if (! targets.length) {
      return totalPromise.then(total => ({ hits: {}, total })) as unknown as StatisResult;
    }

    // 分两组：
    // A. unselTargets  —— sels 中没选：共享扫描
    // B.   selTargets  —— sels 中有选：单独统计
    const unselTargets: string[] = [];
    const   selTargets: string[] = [];
    for (const f of targets) {
      if (selConds[f]) selTargets.push(f); // 已选有值 → B 组
      else           unselTargets.push(f); // 未选没值 → A 组
    }

    // 读取 tops 工具函数
    const topsFor = (f: string): number => {
      if (typeof tops === 'number') return tops;
      if (tops && typeof tops === 'object' && tops[f] !== undefined) return tops[f];
      return 0;
    };

    // 生成单个字段的 group/sort/limit stages（不含 $match）
    const buildGroupStages = (f: string): any[] => {
      const stages: any[] = [
        { $group  : { _id: '$' + f, count: { $sum: 1 } } },
        { $sort   : { count: -1 } },
      ];
      const topN = topsFor(f);
      if (topN > 0) stages.push({ $limit: topN });
      return stages;
    };

    // 结果合并 + 格式化 Map（共享 Promise list 与单独 Promise list 合并输出）
    const resultsByName: Record<string, Promise<any[]>> = {};

    // ---- A 组：共享一次 $match（find + sdel + 所有 sels 条件），单 $facet 搞定 ----
    if (unselTargets.length) {
      const sharedFacet: Record<string, any[]> = {};
      for (const f of unselTargets) {
        sharedFacet[f] = buildGroupStages(f);
      }
      const sharedMatch = { ...baseCond, ...selConds };
      const sharedPromise = Model.aggregate<{ [k: string]: any[] }>([
        { $match: sharedMatch },
        { $facet: sharedFacet },
      ]).exec().then(r => (r && r[0]) || {});
      for (const f of unselTargets) {
        resultsByName[f] = sharedPromise.then(o => o[f] || []);
      }
    }

    // ---- B 组：每个 selTarget 单独一次 aggregate，前置条件排除自身 ----
    for (const f of selTargets) {
      const fieldCond: Record<string, any> = { ...baseCond };
      for (const [selField, selIn] of Object.entries(selConds)) {
        if (selField === f) continue; // 排除自身
        fieldCond[selField] = selIn;
      }
      const stages: any[] = [
        { $match: fieldCond },
        ...buildGroupStages(f),
      ];
      resultsByName[f] = Model.aggregate<any>(stages).exec();
    }

    // 等所有结果，按 targets 顺序组装 hits
    const allNames = Object.keys(resultsByName);
    const allProms = allNames.map(n => resultsByName[n]);
    return Promise.all([totalPromise, Promise.all(allProms)]).then(async ([total, allLists]) => {
      const listMap: Record<string, any[]> = {};
      for (let i = 0; i < allNames.length; i++) listMap[allNames[i]] = allLists[i];

      const hits: Record<string, any[]> = {};
      for (const f of targets) {
        const list = listMap[f] || [];
        hits[f] = list.map(g => ({
          // value 作键，统一 String() 化（ObjectId / Date / null 都能作值）
          value: g._id === null || g._id === undefined ? '' : String(g._id),
          count: g.count,
        }));
      }
      const result: StatisResult = { hits, total };
      // 先正常 statis，最后调函数补充 refs
      const refsData = await fillStatisRefs(this.getRefPaths(), hits, refs, ctx);
      if (refsData) result.refs = refsData;
      return result;
    }) as unknown as StatisResult;
  }

  upsert(params: UpsertParams, _ctx: Context): UpsertResult {
    const { uks = ['_id'], items } = params;
    const  sdel = this.getSoftDeleteCond();
    const Model = this.getModel();

    return (async (): Promise<UpsertResult> => {
      let   created = 0;
      let   updated = 0;
      const errors  : UpsertError[] = [];

      const isIdUks = uks.length === 1 && uks[0] === '_id';

      for (let i = 0; i < items.length; i ++) {
        const data = items[i];
        try {
          // uks 为 ['_id'] 且数据没有 _id：直接添加
          if (isIdUks && (data._id === undefined || data._id === null || data._id === '')) {
            await (this.add(data) as unknown as Promise<[ any, string ]>);
            created ++;
            continue;
          }

          // 构建唯一键查询条件
          const cond: Record<string, any> = {};
          if (isIdUks) {
            cond._id = data._id;
          } else {
            for (const uk of uks) cond[uk] = data[uk];
          }
          const fullCond = sdel ? { ...cond, ...sdel } : cond;

          const exist: any = await Model.findOne(fullCond).select('_id').lean().exec();

          if (exist) {
            // 存在则更新：去掉 _id 避免修改不可变字段
            const setData = { ...data };
            delete setData._id;
            await (this.set(String(exist._id), setData) as unknown as Promise<[ any, number ]>);
            updated ++;
          } else if (isIdUks) {
            // 有 _id 但找不到：报错
            errors.push({ index: i, message: `Item with _id(${data._id}) not found` });
          } else {
            // 按 uks 但找不到：添加
            await (this.add(data) as unknown as Promise<[ any, string ]>);
            created ++;
          }
        } catch (e: any) {
          // ValidationError 记录 message + errors；其他只记 message
          const message = e?.message ?? String(e);
          if (e?.name === 'ValidationError' && e.errors) {
            const fieldErrors: Record<string, any> = {};
            for (const [field, info] of Object.entries<any>(e.errors)) {
              fieldErrors[field] = info.message;
            }
            errors.push({ index: i, message, errors: fieldErrors });
          } else {
            errors.push({ index: i, message });
          }
        }
      }

      return { created, updated, errors };
    })() as unknown as UpsertResult;
  }

  /**
   * 转译为标准 JSON Schema（draft 2020-12）
   * cols 仅过滤顶层字段
   */
  schema(params: SchemaParams, _ctx: Context): SchemaResult {
    const { cols } = params;
    const schema = this.getSchema();
    const opts   = (schema as any).options || {};
    const node   = buildObjectNode(schema, cols);

    const result: SchemaResult = {
      $schema   : 'https://json-schema.org/draft/2020-12/schema',
      type      : 'object',
      properties: node.properties || {},
    };
    if (opts.title      ) result.title       = opts.title;
    if (opts.description) result.description = opts.description;
    if (node.required   ) result.required    = node.required;

    return result;
  }

}

/* ---------- Helpers ---------- */

export function callFunc(name: string, params: Record<string, any>, ctx: Context): any {
  // 1. 从 FUNCS 中查找并执行，可覆盖 model.method
  if (hasFunc(name)) {
    // 检查是否许可调用
    if (! isPermitted(name, ctx.roles || [])) {
      throw new CrudError(`Current user not permitted to call "${name}"`, CrudErrno.RIGHT_DEPRIVED);
    }

    return getFunc(name)(params, ctx);
  }

  // 2. 从 CRUDS 中查找并执行，仅放行 callable 的方法
  X: {
    const p = name.lastIndexOf ('.');
    if (p <= 0) break X;

    const crudName = name.slice(0,p);
    const funcName = name.slice(1+p);
    if (! hasCrud(crudName)) break X;

    const crud = getCrud( crudName );
    if (! crud.callable?.includes(funcName)) break X;

    // 检查是否许可调用
    if (! isPermitted(name, ctx.roles || [])) {
      throw new CrudError(`Current user not permitted to call "${name}"`, CrudErrno.RIGHT_DEPRIVED);
    }

    return (crud as any)[funcName].call(crud, params, ctx);
  }

  throw new CrudError(`Method "${name}" is not registered.`, CrudErrno.METHOD_MISSING);
}

export function isPermitted(auth: string, roles: string[] | Set<string>): boolean {
  for (const role of roles) {
    const auths: Set<string> = ROLES[role];
    if (auths && auths.has(auth)) return true;
  }
  return false;
}

/* ---------- Refs ---------- */

/**
 * 收集 schema 内声明 reference 的字段路径（RefPath 定义见 types.ts）
 * 普通字段取 path.options，数组字段另查元素级 caster.options；
 * 子文档 / 子文档数组递归下钻，prefix 为嵌套时的路径前缀（数组，取值无需再拆点号）
 */
export function getRefPaths(schema: Schema, prefix?: string[], seen?: Set<Schema>): RefPath[] {
  const refPaths: RefPath[] = [];
  if (! seen) seen = new Set();
  if (seen.has(schema)) return refPaths;
  seen.add(schema);

  for (const name in schema.paths) {
    if (name.startsWith('__') || name.includes('$*')) continue;
    const stype = (schema.paths as any)[name];
    if (! stype) continue;

    const path = prefix ? [...prefix, name] : [name];
    const opts = stype.options || {};
    // 数组元素级选项在 caster.options，优先取更精确的元素级声明
    const copts = stype.caster ? (stype.caster.options || {}) : {};
    const ref: RefItem | undefined = copts.reference || opts.reference;
    if (ref) {
      const name = path.join('.');
      const key  = ref.refName || name;
      refPaths.push({ path, name, key, ref });
    }
    if (stype.schema) {
      refPaths.push(...getRefPaths(stype.schema, path, seen));
    }
  }
  return refPaths;
}

/**
 * refs 命中判定（类似 cols 白/黑名单）
 * undefined / null 等同 false 不取，boolean 直接采用，对象按 key（聚集名）或 name（点号全路径）命中
 */
function refHit(refs: RefsSpec | null | undefined, rp: RefPath): boolean {
  if (refs == null) return false;
  if (typeof refs === 'boolean') return refs;
  const mode = Object.values(refs).every(v => v === 1) ? 1 : 0;
  if (mode === 1) return refs[rp.key] === 1 || refs[rp.name] === 1;
  return refs[rp.key] !== 0 && refs[rp.name] !== 0;
}

/**
 * 从统计结果收集 refs 需要的外键值映射 {key: [外键值]}
 * refs 假值（undefined / null 等）等同 false，不收集
 * hits 的键为点号全路径（name），值为 [{value, count}] 数组，value 空串为缺失标记
 * 同聚集名（key）的多字段合并收集在一起
 */
export function getHitIds(
  refPaths: RefPath[],
  hits    : Record<string, any[]>,
  refs   ?: RefsSpec,
): Record<string, any[]> {
  const refIds: Record<string, any[]> = {};
  if (refPaths.length === 0 || ! hits) return refIds;

  for (const rp of refPaths) {
    if (! refHit(refs, rp)) continue;
    const list = hits[rp.name];
    if (! list) continue;
    const vals = list.map(h => h.value).filter(v => v !== '');
    if (vals.length) refIds[rp.key] = [...new Set([...(refIds[rp.key] || []), ...vals])];
  }
  return refIds;
}

/**
 * 从文档列表收集 refs 需要的外键值映射 {key: [外键值]}
 * refs 假值（undefined / null 等）等同 false，不收集
 * 同聚集名（key）的多字段合并收集在一起
 */
export function getRefIds(
  refPaths: RefPath[],
  list    : any[],
  refs   ?: RefsSpec,
): Record<string, any[]> {
  const refIds: Record<string, any[]> = {};
  if (refPaths.length === 0 || ! list || list.length === 0) return refIds;

  for (const rp of refPaths) {
    if (! refHit(refs, rp)) continue;
    const vals = new Set(refIds[rp.key] || []);
    for (const item of list) {
      padRefVal(vals, getDocVal(item, rp.path));
    }
    if (vals.size) refIds[rp.key] = [...vals];
  }
  return refIds;
}

/** 递归展开取值并 String() 化，跳过空值，Set 去重 */
function padRefVal(vals: Set<string>, val: any): void {
  if (val === undefined || val === null || val === '') return;
  if (Array.isArray(val)) {
    for (const v of val ) {
      padRefVal(vals, v );
    }
  } else {
    vals.add(String(val));
  }
}

/**
 * 按路径数组取值，数组感知（跨数组子文档取叶子时逐元素下钻，得扁平数组）
 * mongoose 文档 / 子文档走 get，普通对象下标取值
 */
function getDocVal(doc: any, path: string[]): any {
  let cur = doc;
  for (const k of path) {
    if (cur === undefined || cur === null) return cur;
    if (Array.isArray(cur)) {
      cur = cur.map(el => getDepVal(el, k));
    } else {
      cur = getDepVal(cur, k);
    }
  }
  return cur;
}

/** 取单段字段：mongoose 文档 / 子文档走 get，普通对象下标取值 */
function getDepVal(val: any, name: string): any {
  if (val === undefined || val === null) return val;
  if (typeof val.get === 'function') {
    return val.get(name);
  } else {
    return val[name];
  }
}

/**
 * 按 {key: [外键值]} 映射补充关联数据
 * 调 reference 的 method 附带 params {[idParam]: 外键值} 获取，
 * 返回 {key: [关联数据]}（按外键查到的行数组，原样给出不去重）
 */
export async function fillRefs(
  refPaths: RefPath[],
  refIds  : Record<string, any[]>,
  ctx    ?: Context,
): Promise<Record<string, any[]>> {
  // 同聚集名（key）的多字段共享首个 ref 配置（method/params 等）
  const keyMap: Record<string, RefPath> = {};
  for (const rp of refPaths) if (! keyMap[rp.key]) keyMap[rp.key] = rp;

  // 挑选出需要关联的
  const keys = Object.keys(refIds).filter(k => {
    const rp = keyMap[k];
    return !! (rp && rp.ref.method && refIds[k].length);
  });

  // 增加请求来源标识
  const ctxs = {...(ctx || {}), src: 'ref'};

  const refs : Record <string, any[]> = { };

  await Promise.all(keys.map(async k => {
    const rp = keyMap[k];
    const vals = refIds[k];
    const res = await callFunc(rp.ref.method as string, {
      limit: vals.length, // 注入取数条数防默认截断，可被 params 覆盖
      ...(rp.ref.params || {}),
      [rp.ref.idParam || 'id']: vals,
    }, ctxs);
    refs[k] = Array.isArray(res) ? res : (res && res[rp.ref.listKey || 'list']) || [];
  }));

  return refs;
}

/**
 * search 结果补充 refs（脱离 Cradle 的便捷函数，Chaser 可复用）
 * refs 假值或无可取外键时返回 undefined
 */
export async function fillSearchRefs(
  refPaths: RefPath[],
  list    : any[],
  refs   ?: RefsSpec,
  ctx    ?: Context,
): Promise<Record<string, any[]> | undefined> {
  if (! refs) return undefined;
  const refIds = getRefIds(refPaths, list || [], refs);
  if (Object.keys(refIds).length === 0) return undefined;
  return fillRefs(refPaths, refIds, ctx);
}

/**
 * statis 结果补充 refs（脱离 Cradle 的便捷函数，Chaser 可复用）
 * refs 假值或无可取外键时返回 undefined
 */
export async function fillStatisRefs(
  refPaths: RefPath[],
  hits    : Record<string, any[]>,
  refs   ?: RefsSpec,
  ctx    ?: Context,
): Promise<Record<string, any[]> | undefined> {
  if (! refs) return undefined;
  const refIds = getHitIds(refPaths, hits || {}, refs);
  if (Object.keys(refIds).length === 0) return undefined;
  return fillRefs(refPaths, refIds, ctx);
}

export function mixConds(
  ...conds: (Record<string, any> | undefined | null)[]
): Record<string, any> {
  const conditions: Record<string, any>[] = [];
  for (const c of conds) {
    if (c && Object.keys(c).length)
      conditions.push(c);
  }
  if (conditions.length === 0)
    return {};
  if (conditions.length === 1)
    return conditions[0];
  return { $and : conditions };
}

export function mixFinds(
  id: undefined | string | string[],
  wd: undefined | string ,
  ...conds: (Record<string, any> | undefined | null)[]
): Record<string, any> {
  const conditions: Record<string, any>[] = [];
  if (id) {
    const ids = !Array.isArray(id) ? [id] : id;
    if (ids.length > 1) {
      conditions.push({ _id: { $in: ids.map(i => new mongoose.Types.ObjectId(i)) } });
    } else
    if (ids.length > 0) {
      conditions.push({ _id: new mongoose.Types.ObjectId(ids[0]) });
    }
  }
  if (wd) {
    const ts = wd.trim( );
    if (ts) {
      conditions.push({ $text: { $search: ts } });
    }
  }
  for (const c of conds) {
    if (c && Object.keys(c).length) {
      conditions.push(c);
    }
  }
  if (conditions.length === 0)
    return {};
  if (conditions.length === 1)
    return conditions[0];
  return { $and : conditions };
}

/**
 * 构建 object 节点
 * cols 仅过滤顶层字段
 */
export function buildObjectNode(schema: Schema, cols?: ColsSpec): SchemaNode {
  const node: SchemaNode = { type: 'object', properties: {} };
  const mode = cols && Object.values(cols).every(v => v === 1) ? 1 : 0;

  for (const [name, path] of Object.entries(schema.paths)) {
    if (name.startsWith('__')) continue;
    if (name.includes  ('$*')) continue; // Map 的值类型走 additionalProperties

    const opts = (path as any).options || {};

    // 既不可读又不可写的，无需透出
    if ((opts.select === false || opts.readable === false) && opts.writable === false) continue;

    // cols 仅过滤顶层字段
    const top  = name.split('.')[0];
    if (cols && (mode === 1 ? cols[top] !== 1 : cols[top] === 0)) continue;

    // 逐层找到（或建出）所属的 object 节点
    const keys = name.split('.');
    let   host = node;
    for (let i = 0; i < keys.length - 1; i ++) {
      const props = host.properties = host.properties || {};
      let   sub   = props[keys[i]];
      if (! sub) {
        sub = props[keys[i]] = { type: 'object', properties: {} };
      }
      host = sub;
    }

    const last = keys[keys.length - 1];
    (host.properties = host.properties || {})[last] = buildItemNode(path);
    if ((path as any).isRequired) {
      (host.required = host.required || []).push(last);
    }
  }

  // timestamps 由系统维护，仅可读
  const ts = ((schema as any).options || {}).timestamps;
  if (ts) {
    const createdAt = typeof ts === 'object' && typeof ts.createdAt === 'string' ? ts.createdAt : 'createdAt';
    const updatedAt = typeof ts === 'object' && typeof ts.updatedAt === 'string' ? ts.updatedAt : 'updatedAt';
    for (const key of [createdAt, updatedAt]) {
      if (node.properties![key]) node.properties![key].readOnly = true;
    }
  }

  return node;
}

/**
 * 构建字段节点
 * 数组、子文档、Map 均递归展开
 */
function buildItemNode(path: any): SchemaNode {
  const opts = path.options || {};
  const node = buildTypeNode(path);

  if (opts.title      ) node.title       = opts.title;
  if (opts.description) node.description = opts.description;

  // 函数型默认值（如 Date.now）不透出
  if (opts.default !== undefined && typeof opts.default !== 'function') {
    node.default = opts.default;
  }

  if (opts.min !== undefined) node.minimum = firstOf(opts.min);
  if (opts.max !== undefined) node.maximum = firstOf(opts.max);

  // minlength/maxlength 按节点类型分派
  if (opts.minlength !== undefined) {
    const v = firstOf(opts.minlength);
    if      (node.type === 'object') node.minProperties = v;
    else if (node.type === 'array' ) node.minItems      = v;
    else                             node.minLength     = v;
  }
  if (opts.maxlength !== undefined) {
    const v = firstOf(opts.maxlength);
    if      (node.type === 'object') node.maxProperties = v;
    else if (node.type === 'array' ) node.maxItems      = v;
    else                             node.maxLength     = v;
  }

  if (opts.match) {
    const m = firstOf(opts.match);
    node.pattern = m instanceof RegExp ? m.source : String(m);
  }

  // select / readable / writable 为程序层面的读写预留符号：select 走 mongoose 投影，readable / writable 仅透出 JSON Schema 声明
  if (opts.select    === false) node.writeOnly      = true;
  if (opts.readable  === false) node.writeOnly      = true;
  if (opts.writable  === false) node.readOnly       = true;
  if (opts.immutable === true ) node['x-immutable'] = true;
  if (opts.countable === true ) node['x-countable'] = true;

  // 关联来源，声明取数方法及组装规则
  if (opts.reference) {
    node['x-reference'] = opts.reference;
  }

  // 枚举标签
  if (opts.enumTags) {
    node['x-enum-tags'] = opts.enumTags;
  }

  return node;
}

/**
 * 构建字段的类型部分
 */
function buildTypeNode(path: any): SchemaNode {
  switch (path.instance) {
    case 'Embedded':
      return buildObjectNode(path.schema);

    case 'Array': {
      const node: SchemaNode = { type: 'array' };
      const cast = path.caster || path.$embeddedSchemaType;
      if (cast) {
        node.items = cast.schema
          ? buildObjectNode(cast.schema)
          : buildItemNode(cast);
      }
      return node;
    }

    case 'Map': {
      const node: SchemaNode = { type: 'object' };
      const of = path.$__schemaType;
      if (of) {
        node.additionalProperties = of.schema
          ? buildObjectNode(of.schema)
          : buildItemNode(of);
      } else {
        node.additionalProperties = true;
      }
      return node;
    }

    case 'String'    : return { type: 'string' };
    case 'Number'    : return { type: 'number' };
    case 'Decimal128': return { type: 'number' };
    case 'Boolean'   : return { type: 'boolean' };
    case 'Date'      : return { type: 'string', format: 'date-time' };
    case 'ObjectId'  : return { type: 'string', format: 'object-id' };
    case 'ObjectID'  : return { type: 'string', format: 'object-id' };
    default          : return { type: 'object' };
  }
}

/**
 * mongoose 校验项可写作 [值, 提示]
 */
function firstOf(v: any): any {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 微调 Schema:
 * 1. softDelete: true 简写规范化为 { isDeleted: 'isDeleted', deletedAt: 'deletedAt', deleted: true, default: false }。
 * 2. 补充伪删除标记、伪删除时间字段（已自定义则跳过）。
 */
mongoose.plugin(function(schema: Schema): void {
  /*
  // 原来想给 invisble: true 对应 select: false，不需要了
  const add = schema.add.bind(schema) as typeof schema.add;
  const fix = (schema: Schema): void => {
    schema.eachPath((_name: string, type: SchemaType) => {
      const opts = (type as any).options as Record<string, any> | undefined;
      if (opts && opts.invisible === true && opts.select === undefined) {
        type.select(false);
      }
    });
  };
  // 任何之后 schema.add(defs, prefix) 的追加路径再处理
  schema.add = function (this: Schema, ...args: any[]): Schema {
    const rs = add(...(args as [any, any?]));
    fix(this);
    return rs;
  };
  fix(schema);
  */

  // softDelete: true 简写规范化
  let sd = (schema as any).get('softDelete') as SoftDel | boolean | undefined;
  if (sd === true) {
    sd = { isDeleted: 'isDeleted', deletedAt: 'deletedAt', deleted: true, default: false };
    (schema as any).set('softDelete', sd);
  }
  if (sd) {
    const sdObj = sd as SoftDel;
    schema.add({ [sdObj.isDeleted || 'isDeleted']: { type: Boolean, writable: false, select: false, default: sdObj.default !== undefined ? sdObj.default : false, index: true } });
    schema.add({ [sdObj.deletedAt || 'deletedAt']: { type: Date   , writable: false, select: false, default: null } });
  }
});
