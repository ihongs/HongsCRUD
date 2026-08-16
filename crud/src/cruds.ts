// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

import mongoose, { Schema, Model } from 'mongoose';
import type { SchemaType } from 'mongoose';
import type {
  Func,
  Crud,
  Context,
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
  SchemaParams,
  SchemaResult,
  SchemaField,
  EnumItem,
  SoftDel,
} from './types';

export * from './types';

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
  OWNER_MISMATCH = -32009,
}

/* ---------- Cradle ---------- */

export class Cradle implements Crud {
  private readonly _schema: Schema;
  private readonly _model: Model<any>;

  callable = ['create', 'update', 'delete', 'search', 'counts', 'schema'];

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

  getSoftDelete(): SoftDel | undefined {
    return (this.getSchema() as any).get('softDelete') as SoftDel | undefined;
  }

  getSoftDeleteData(): Record<string, any> | undefined {
    const sd = this.getSoftDelete();
    if (!sd) return undefined;
    if (sd.value !== undefined) {
      const v = typeof sd.value === 'function' ? sd.value() : sd.value;
      return { [sd.field]: v };
    }
    return { [sd.field]: true };
  }

  getSoftDeleteCond(): Record<string, any> | undefined {
    const sd = this.getSoftDelete();
    if (!sd) return undefined;
    if (sd.query !== undefined) {
      const q = typeof sd.query === 'function' ? sd.query() : sd.query;
      return { [sd.field]: q };
    }
    if (sd.value !== undefined) {
      const v = typeof sd.value === 'function' ? sd.value() : sd.value;
      return { [sd.field]: { '$ne': v } };
    }
    return { [sd.field]: { '$ne': true } };
  }

  /* ---------- core methods ---------- */

  /**
   * 添加一个文档
   * 触发完整 validator
   */
  add(data: Record<string, any>): string {
    const Model = this.getModel();
    return Model.create(data).then((doc: any) => String(doc._id)) as unknown as string;
  }

  /**
   * 更新一个文档
   * 触发完整 validator
   */
  set(id: string, data: Record<string, any>): number {
    const Model = this.getModel();
    return Model.findById(id).exec()
      .then((doc: any) => {
        if (!doc) return 0;

        // 局部更新
        for (const key of Object.keys(data)) {
          doc.set(key, data[key]);
        }

        // mongoose 自动深度比较，值未变的不算 modified
        const changed = doc.modifiedPaths().length > 0;
        if (! changed) return 0 as const;

        return doc.save().then(() => 1 as const);
      }) as unknown as number;
  }

  /**
   * 更新多个文档
   * 不触发自定义 validator
   */
  setAll(ids: string[], data : Record<string, any>): number {
    const Model = this.getModel();
    const cond = idAndFind(ids);
    return Model.updateMany(cond, { $set: data }, { runValidators: true }).exec()
      .then(res => Number(res.modifiedCount ?? 0)) as unknown as number;
  }

  /**
   * 删除多个文档
   * 不触发任何的 validator
   */
  delAll(ids: string[], data?: Record<string, any>): number {
    const Model = this.getModel();
    const cond = idAndFind(ids);
    const sdel = this.getSoftDeleteData();
    if (sdel) {
      return Model.updateMany(cond , { $set: sdel }).exec()
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
    const cond = idAndFind(ids, find);
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
            CrudErrno.OWNER_MISMATCH,
            { ids: unoperable },
          );
        }

        return operable;
      });
  }

  /* ---------- Crud interface ---------- */

  create(params: CreateParams, _ctx: Context): CreateResult {
    return (this.add(params.data) as unknown as Promise<string>)
      .then(id => ({ id })) as unknown as CreateResult;
  }

  update(params: UpdateParams, _ctx: Context): UpdateResult {
    const { id, find, data, force } = params;
    const ids = Array.isArray(id) ? id : [id];

    // 一次性查出所有 id + find 条件下存在的 _id，避免 N 次查询
    return this.chkIds(ids, find, force, 'update').then(operable => {
        if (!operable.length) return { count: 0 };

        /**
         * 逐个调用 set，触发完整 validator
         * updateMany() 即便 runValidators 为 true，也不会触发自定义 validator
         */
        return (async (): Promise<UpdateResult> => {
          let count = 0;
          for (const id of operable) {
            count += await (this.set(id, data) as unknown as Promise<0 | 1>);
          }
          return { count };
        })() as unknown as UpdateResult;
      }) as unknown as UpdateResult;
  }

  delete(params: DeleteParams, _ctx: Context): DeleteResult {
    const { id, find, data, force } = params;
    const ids = Array.isArray(id) ? id : [id];

    // 一次性查出所有 id + find 条件下存在的 _id，避免 N 次查询
    return this.chkIds(ids, find, force, 'delete').then(operable => {
        if (!operable.length) return { count: 0 };

        return (this.delAll(operable, data) as unknown as Promise<number>)
          .then(count => ({ count }));
      }) as unknown as DeleteResult;
  }

  search(params: SearchParams, _ctx: Context): SearchResult {
    const { id, find = {}, cols, sort, start = 0, count } = params;
    const Model = this.getModel();
    const sdel  = this.getSoftDeleteCond( );
    const cond  = idAndFind(id, find, sdel);

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

    if (count === 'only') {
      return Model.countDocuments(cond).then(total => ({ count: total })) as unknown as SearchResult;
    }

    if (count === 'next') {
      return Promise.all([
        buildQuery().exec(),
        Model.findOne(cond).skip(start + limit).select('_id').lean().exec(),
      ]).then(([list, probe]) => ({ list, count: probe ? 1 : 0 })) as unknown as SearchResult;
    }

    if (count === 'all') {
      return Promise.all([
        buildQuery().exec(),
        Model.countDocuments(cond),
      ]).then(([list, total]) => ({ list, count: total })) as unknown as SearchResult;
    }

    return buildQuery().exec().then(list => ({ list })) as unknown as SearchResult;
  }

  counts(params: CountsParams, _ctx: Context): CountsResult {
    const { find = {}, cols, sels, top = 10 } = params;
    const sdel  = this.getSoftDeleteCond();
    const Model = this.getModel();

    // 基础条件：find + 软删除
    const baseCond: Record<string, any> = { ...find };
    if (sdel) Object.assign(baseCond, sdel);

    // sels 转 $in 查询（'id' 还原为 '_id'，空数组视为没值，不生成任何条件）
    const selConds: Record<string, any> = {};
    if (sels) {
      for (const [field, values] of Object.entries(sels)) {
        if (!Array.isArray(values) || !values.length) continue;
        const actual = field === 'id' ? '_id' : field;
        selConds[actual] = { $in: values };
      }
    }

    // total：应用全部条件（find + sdel + sels 中所有非空）
    const totalCond    = { ...baseCond, ...selConds };
    const totalPromise = Model.countDocuments(totalCond).exec();

    // 取出所有 countable: true 的字段
    const countableFields: string[] = [];
    for (const [key, path] of Object.entries(this.getSchema().paths)) {
      if (key.startsWith('__')) continue;
      const opts = (path as any).options || {};
      if (opts.countable) countableFields.push(key === '_id' ? 'id' : key);
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
      const actual = f === 'id' ? '_id' : f;
      if (selConds[actual]) selTargets.push(f); // 已选有值 → B 组
      else                unselTargets.push(f); // 未选没值 → A 组
    }

    // 读取 top 工具函数
    const topFor = (f: string): number => {
      if (typeof top === 'number') return top;
      if (top && typeof top === 'object' && top[f] !== undefined) return top[f];
      return 0;
    };

    // 生成单个字段的 group/sort/limit stages（不含 $match）
    const buildGroupStages = (f: string): any[] => {
      const actual = f === 'id' ? '_id' : f;
      const stages: any[] = [
        { $group  : { _id: '$' + actual, count: { $sum: 1 } } },
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
      const actual = f === 'id' ? '_id' : f;
      const fieldCond: Record<string, any> = { ...baseCond };
      for (const [selActual, selIn] of Object.entries(selConds)) {
        if (selActual === actual) continue; // 排除自身
        fieldCond[selActual] = selIn;
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

  schema(params: SchemaParams, _ctx: Context): SchemaResult {
    const cols  = params.cols;
    const paths = this.getSchema().paths;

    const fields: Record<string, SchemaField> = {};
    const enums : Record<string, EnumItem []> = {};
    const menus : Record<string, EnumItem []> = (this.getSchema() as any).get('enums') || {};

    for (const [key, path] of Object.entries(paths)) {
      if (key.startsWith('__')) continue;
      const fieldName = key === '_id' ? 'id' : key;

      // 边遍历边按 cols 过滤
      if (cols) {
        const mode = Object.values(cols).every(v => v === 1) ? 1 : 0;
        const included = mode === 1
          ? cols[fieldName] === 1
          : cols[fieldName] !== 0;
        if (!included) continue;
      }

      const st = path as unknown as SchemaType;
      const opts = (st as any).options || {};

      const info: SchemaField = {
        type: (st as any).instance || 'Mixed',
      };
      if ((st as any).defaultValue !== undefined && typeof (st as any).defaultValue !== 'function') {
        info.default = (st as any).defaultValue;
      }
      if (opts.required && typeof opts.required !== 'function' && (st as any).isRequired) {
        info.required = true;
      }
      if (opts.immutable && typeof opts.immutable !== 'function') {
        info.immutable = true;
      }
      if (opts.select === false) {
        info.invisible = true;
      }
      if (opts.countable) {
        info.countable = true;
      }
      if (opts.description) {
        info.description = opts.description;
      }

      // options：优先读字段内 options（自定义内部 options），再补齐 mongoose 的校验选项
      const options: Record<string, any> = opts.options ? { ...opts.options } : {};
      if (options.min === undefined && opts.min !== undefined) options.min = opts.min;
      if (options.max === undefined && opts.max !== undefined) options.max = opts.max;
      if (options.minLength === undefined && opts.minlength !== undefined) options.minLength = opts.minlength;
      if (options.maxLength === undefined && opts.maxlength !== undefined) options.maxLength = opts.maxlength;
      if (options.pattern === undefined && opts.match) options.pattern = String(opts.match);
      if (Object.keys(options).length) info.options = options;

      // enumRef：优先读字段内 enumRef（自定义引用）
      if (opts.enumRef) {
        info.enumRef = opts.enumRef;
        // enumRef 可为对象或字符串，统一从 enumName 取 key 去查
        const enumName = typeof opts.enumRef !== 'string'
          ? opts.enumRef.enumName
          : opts.enumRef;
        if (menus[enumName]) {
          enums[enumName] = menus[enumName];
        }
      } else if ((st as any).enumValues && (st as any).enumValues.length) {
        // 字段原生 mongoose enum：把字段名当 enumRef，枚举值同步收集
        info.enumRef = fieldName;
        enums[fieldName] = (st as any).enumValues.map((v: any) => ({
          value: v,
          label: String(v),
        }));
      }

      // dataRef：直接读字段内 dataRef（自定义引用）
      if (opts.dataRef) {
        info.dataRef = opts.dataRef;
      }

      fields[fieldName] = info;
    }

    const result: SchemaResult = { fields, enums };
    return result;
  }

}

/* ---------- Helpers ---------- */

export function getValues(items: EnumItem[], valueField: string = 'value'): string[] {
  return items.map(item => String((item as any)[valueField]));
}

export function mergeFind(
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

export function idAndFind(
  id: string | string[] | undefined,
  ...conds: (Record<string, any> | undefined | null)[]
): Record<string, any> {
  const conditions: Record<string, any>[] = [];
  if (id !== undefined) {
    const ids = Array.isArray(id) ? id : [id];
    conditions.push(ids.length === 1
      ? { _id: new mongoose.Types.ObjectId(ids[0]) }
      : { _id: { $in: ids.map(i => new mongoose.Types.ObjectId(i)) } });
  }
  for (const c of conds) {
    if (c && Object.keys(c).length) conditions.push(c);
  }
  if (conditions.length === 0)
    return {};
  if (conditions.length === 1)
    return conditions[0];
  return { $and : conditions };
}

export function isPermitted(auth: string, roles: string[] | Set<string>): boolean {
  for (const role of roles) {
    const auths: Set<string> = ROLES[role];
    if (auths && auths.has(auth)) return true;
  }
  return false;
}

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
