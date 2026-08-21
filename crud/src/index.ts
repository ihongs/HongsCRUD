// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

import mongoose, { Schema, Model } from 'mongoose';
import type {
  Func,
  Crud,
  Context,
  SoftDel,
  SearchParams,
  SearchResult,
  CreateParams,
  CreateResult,
  UpdateParams,
  UpdateResult,
  DeleteParams,
  DeleteResult,
  CountsParams,
  CountsResult,
  UpsertParams,
  UpsertResult,
  UpsertError,
  SchemaParams,
  SchemaResult,
  SchemaNode,
  ColsSpec,
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

  callable = ['create', 'update', 'delete', 'search', 'counts', 'upsert', 'schema'];

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

  /* ---------- core methods ---------- */

  /**
   * 添加一个文档
   * 触发完整 validator
   * 返回 [ doc, id ]，doc 供 Chaser 等子类直接同步，免得再查一次
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
   * 不触发自定义 validator
   */
  setAll(ids: string[], data : Record<string, any>): number {
    const Model = this.getModel();
    const cond = findMerge(ids, undefined);
    return Model.updateMany(cond, { $set: data }, { runValidators: true }).exec()
      .then(res => Number(res.modifiedCount ?? 0)) as unknown as number;
  }

  /**
   * 删除多个文档
   * 不触发任何的 validator
   */
  delAll(ids: string[], data?: Record<string, any>): number {
    const Model = this.getModel();
    const cond = findMerge(ids, undefined);
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
    const cond = findMerge(ids, undefined, find);
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
        if (!operable.length) return { affected: 0 };

        /**
         * 逐个调用 set，触发完整 validator
         * updateMany() 即便 runValidators 为 true，也不会触发自定义 validator
         */
        return (async (): Promise<UpdateResult> => {
          let count = 0;
          for (const id of operable) {
            const [ , n ] = await (this.set(id, data) as unknown as Promise<[ any, number ]>);
            count += n;
          }
          return { affected: count };
        })() as unknown as UpdateResult;
      }) as unknown as UpdateResult;
  }

  delete(params: DeleteParams, _ctx: Context): DeleteResult {
    const { id, data, find, force } = params;
    const ids = Array.isArray(id) ? id : [id];

    // 一次性查出所有 id + find 条件下存在的 _id，避免 N 次查询
    return this.chkIds(ids, find, force, 'delete').then(operable => {
        if (!operable.length) return { affected: 0 };

        return (this.delAll(operable, data) as unknown as Promise<number>)
          .then(count => ({ affected: count }));
      }) as unknown as DeleteResult;
  }

  search(params: SearchParams, _ctx: Context): SearchResult {
    const { id, wd, mode, find = {}, cols, sort, start = 0 } = params;
    const Model = this.getModel();
    const sdel  = this.getSoftDeleteCond();
    const cond  = findMerge(id, wd, find, sdel);

    // limit：优先用调用方传的，没传则取 schema limitDef（默认 1）
    // limitMax（默认 1000）为上限：超过或调用方传 0（不限）时截断为 limitMax
    // limitDef = 0 表示不限；limitMax = 0 表示不限
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

    if (mode === 'only-total') {
      return Model.countDocuments(cond).then(total => ({ total })) as unknown as SearchResult;
    }

    if (mode === 'only-items') {
      return buildQuery().exec().then(items => ({ items })) as unknown as SearchResult;
    }

    if (mode === 'has-more') {
      return Promise.all([
        buildQuery().exec(),
        Model.findOne(cond).skip(start + limit).select('_id').lean().exec(),
      ]).then(([items, more]) => ({ items, more })) as unknown as SearchResult;
    }

    return Promise.all([
      buildQuery().exec(),
      Model.countDocuments(cond),
    ]).then(([items, total]) => ({ items, total })) as unknown as SearchResult;
  }

  counts(params: CountsParams, _ctx: Context): CountsResult {
    const { find = {}, cols, sels, top = 10 } = params;
    const sdel  = this.getSoftDeleteCond();
    const Model = this.getModel();

    // 基础条件：find + 软删除
    const baseCond: Record<string, any> = { ...find };
    if (sdel) Object.assign(baseCond, sdel);

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

    // 取出所有 countable: true 的字段
    const countableFields: string[] = [];
    for (const [key, path] of Object.entries(this.getSchema().paths)) {
      if (key.startsWith('__')) continue;
      const opts = (path as any).options || {};
      if (opts.countable) countableFields.push(key);
    }

    // 若传了 cols，按白/黑名单过滤；否则统计全部 countable
    let targets = countableFields;
    if (cols) {
      const mode = Object.values(cols).every(v => v === 1) ? 1 : 0;
      targets = countableFields.filter(f =>
        mode === 1 ? cols[f] === 1 : cols[f] !== 0
      );
    }

    if (!targets.length) {
      return totalPromise.then(total => ({ counts: {}, count: total })) as unknown as CountsResult;
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

    // 读取 top 工具函数
    const topFor = (f: string): number => {
      if (typeof top === 'number') return top;
      if (top && typeof top === 'object' && top[f] !== undefined) return top[f];
      return 0;
    };

    // 生成单个字段的 group/sort/limit stages（不含 $match）
    const buildGroupStages = (f: string): any[] => {
      const stages: any[] = [
        { $group  : { _id: '$' + f, count: { $sum: 1 } } },
        { $sort   : { count: -1 } },
      ];
      const topN = topFor(f);
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

    // 等所有结果，按 targets 顺序组装 counts
    const allNames = Object.keys(resultsByName);
    const allProms = allNames.map(n => resultsByName[n]);
    return Promise.all([totalPromise, Promise.all(allProms)]).then(([total, allLists]) => {
      const listMap: Record<string, any[]> = {};
      for (let i = 0; i < allNames.length; i++) listMap[allNames[i]] = allLists[i];

      const counts: Record<string, Record<string, number>> = {};
      for (const f of targets) {
        const list = listMap[f] || [];
        const map : Record<string, number> = {};
        for (const g of list) {
          // value 作 key，统一 String() 化（ObjectId / Date / null 都能作 key）
          const k = g._id === null || g._id === undefined ? '' : String(g._id);
          map[k] = g.count;
        }
        counts[f] = map;
      }
      return { counts, count: total };
    }) as unknown as CountsResult;
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
    const schema = this.getSchema();
    const opts   = (schema as any).options || {};
    const refs   = new Set<string>();
    const node   = buildObjectNode(schema, params.cols, refs);

    const result: SchemaResult = {
      $schema   : 'https://json-schema.org/draft/2020-12/schema',
      type      : 'object',
      properties: node.properties || {},
    };
    if (opts.title      ) result.title       = opts.title;
    if (opts.description) result.description = opts.description;
    if (node.required   ) result.required    = node.required;

    // x-datalist：仅输出被 refData 引用到的列表
    const dataList = (schema as any).get('dataList') || {};
    const datalist: Record<string, Record<string, any>[]> = {};
    for (const name of refs) {
      if (dataList[name]) datalist[name] = dataList[name];
    }
    if (Object.keys(datalist).length) result['x-datalist'] = datalist;

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

/**
 * 取数据列表中的取值集合
 * 便于给 mongoose 的 enum 赋值
 */
export function getValues(items: Record<string, any>[], valueField: string = 'value'): string[] {
  return items.map(item => String(item[valueField]));
}

export function findConds(
  ...conds: (Record<string, any> | undefined | null)[]
): Record<string, any> {
  const conditions: Record<string, any>[] = [];
  for (const c of conds) {
    if (c && Object.keys(c).length) conditions.push(c);
  }
  if (conditions.length === 0)
    return {};
  if (conditions.length === 1)
    return conditions[0];
  return { $and : conditions };
}

export function findMerge(
  id: string | string[] | undefined,
  wd: string | undefined,
  ...conds: (Record<string, any> | undefined | null)[]
): Record<string, any> {
  const conditions: Record<string, any>[] = [];
  if (id !== undefined) {
    const ids = !Array.isArray(id) ? [id] : id;
    conditions.push(ids.length === 1
      ? { _id: new mongoose.Types.ObjectId(ids[0]) }
      : { _id: { $in: ids.map(i => new mongoose.Types.ObjectId(i)) } });
  }
  if (wd) {
    const ws = wd.trim();
  if (ws) {
    conditions.push({ $text: { $search: ws } });
  }}
  for (const c of conds) {
    if (c && Object.keys(c).length) conditions.push(c);
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
 * refs 收集用到的 dataList 键
 */
export function buildObjectNode(schema: Schema, cols?: ColsSpec, refs?: Set<string>): SchemaNode {
  const node: SchemaNode = { type: 'object', properties: {} };
  const mode = cols && Object.values(cols).every(v => v === 1) ? 1 : 0;

  for (const [name, path] of Object.entries(schema.paths)) {
    if (name.startsWith('__')) continue;
    if (name.includes  ('$*')) continue; // Map 的值类型走 additionalProperties

    const opts = (path as any).options || {};

    // 既不可读又不可写的，无需透出
    if (opts.select === false && opts.assign === false) continue;

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
    (host.properties = host.properties || {})[last] = buildItemNode(path, refs);
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
function buildItemNode(path: any, refs?: Set<string>): SchemaNode {
  const opts = path.options || {};
  const node = buildTypeNode(path, refs);

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
    if      (node.type === 'array' ) node.minItems      = v;
    else if (node.type === 'object') node.minProperties = v;
    else                             node.minLength     = v;
  }
  if (opts.maxlength !== undefined) {
    const v = firstOf(opts.maxlength);
    if      (node.type === 'array' ) node.maxItems      = v;
    else if (node.type === 'object') node.maxProperties = v;
    else                             node.maxLength     = v;
  }

  if (opts.match) {
    const m = firstOf(opts.match);
    node.pattern = m instanceof RegExp ? m.source : String(m);
  }

  if (opts.select    === false) node.writeOnly        = true;
  if (opts.assign    === false) node.readOnly         = true;
  if (opts.immutable === true ) node['x-immutable'  ] = true;
  if (opts.countable === true ) node['x-countable'  ] = true;

  if (opts.refData) {
    node['x-ref'] = opts.refData;
    // 无 method 即取自 dataList，记下以便按需输出
    if (refs && ! opts.refData.method && opts.refData.list) {
      refs.add(opts.refData.list);
    }
  }

  // 公开选项，键加 x- 前缀
  if (opts.options) {
    for (const [key, val] of Object.entries(opts.options)) {
      node['x-' + key] = val;
    }
  }

  return node;
}

/**
 * 构建字段的类型部分
 */
function buildTypeNode(path: any, refs?: Set<string>): SchemaNode {
  switch (path.instance) {
    case 'Embedded':
      return buildObjectNode(path.schema, undefined, refs);

    case 'Array': {
      const node: SchemaNode = { type: 'array' };
      const cast = path.caster || path.$embeddedSchemaType;
      if (cast) {
        node.items = cast.schema
          ? buildObjectNode(cast.schema, undefined, refs)
          : buildItemNode(cast, refs);
      }
      return node;
    }

    case 'Map': {
      const node: SchemaNode = { type: 'object' };
      const of = path.$__schemaType;
      if (of) {
        node.additionalProperties = of.schema
          ? buildObjectNode(of.schema, undefined, refs)
          : buildItemNode(of, refs);
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
    schema.add({ [sdObj.isDeleted || 'isDeleted']: { type: Boolean, assign: false, select: false, default: sdObj.default !== undefined ? sdObj.default : false, index: true } });
    schema.add({ [sdObj.deletedAt || 'deletedAt']: { type: Date   , assign: false, select: false, default: null } });
  }
});
