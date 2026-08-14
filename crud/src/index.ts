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
  SchemaParams,
  SchemaResult,
  SchemaField,
  EnumItem,
  DataRef,
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
    throw new CrudError(`Role "${role}" is not registered. Call regRole() first.`, CrudErrorCode.UNPERMITTED);
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
    throw new CrudError(`Func "${name}" is not registered. Call regFunc() first.`, CrudErrorCode.UNCALLABLE);
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
    throw new CrudError(`Crud "${name}" is not registered. Call regCrud() first.`, CrudErrorCode.UNCALLABLE);
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

export enum CrudErrorCode {
  UNPERMITTED = -32001,
  UNCALLABLE  = -32601,
  UNOPERABLE  = -32602,
}

/* ---------- Cradle ---------- */

export class Cradle implements Crud {
  private readonly _schema: Schema;
  private readonly _model: Model<any>;

  callable = ['schema', 'search', 'create', 'update', 'delete'];

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

  /* ---------- Crud interface ---------- */

  schema(params: SchemaParams, _ctx: Context): SchemaResult {
    const paths = this.getSchema().paths;
    const userEnums: Record<string, EnumItem[]> = (this.getSchema() as any).get('enums') || {};
    const userEnumRefs: Record<string, string > = (this.getSchema() as any).get('enumRefs') || {};
    const userDataRefs: Record<string, DataRef> = (this.getSchema() as any).get('dataRefs') || {};
    const userRules: Record<string, Record<string, any>> = (this.getSchema() as any).get('rules') || {};
    const cols = params.cols;

    const fields: Record<string, SchemaField> = {};
    const enums : Record<string, EnumItem []> = {};

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
      const info: SchemaField = {
        type: (st as any).instance || 'Mixed',
      };
      const opts = (st as any).options || {};
      if ((st as any).defaultValue !== undefined && typeof (st as any).defaultValue !== 'function') {
        info.default = (st as any).defaultValue;
      }
      if (opts.required && typeof opts.required !== 'function' && (st as any).isRequired) {
        info.required = true;
      }
      if (opts.immutable && typeof opts.immutable !== 'function') {
        info.immutable = true;
      }

      const rules: Record<string, any> = userRules[fieldName] ? { ...userRules[fieldName] } : {};
      if (rules.min === undefined && opts.min !== undefined) rules.min = opts.min;
      if (rules.max === undefined && opts.max !== undefined) rules.max = opts.max;
      if (rules.minLength === undefined && opts.minlength !== undefined) rules.minLength = opts.minlength;
      if (rules.maxLength === undefined && opts.maxlength !== undefined) rules.maxLength = opts.maxlength;
      if (rules.pattern === undefined && opts.match) rules.pattern = String(opts.match);
      if (Object.keys(rules).length) info.rules = rules;

      // enum 处理：同步收集到 enums
      if (userEnumRefs[fieldName]) {
        info.enumRef = userEnumRefs[fieldName];
        const refName = userEnumRefs[fieldName];
        if (userEnums[refName]) enums[refName] = userEnums[refName];
      } else if ((st as any).enumValues && (st as any).enumValues.length) {
        info.enumRef = fieldName;
        enums[fieldName] = (st as any).enumValues.map((v: any) => ({
          value: v,
          label: String(v),
        }));
      }

      // dataRef 处理
      if (userDataRefs[fieldName]) {
        info.dataRef = userDataRefs[fieldName];
      }

      fields[fieldName] = info;
    }

    const result: SchemaResult = { fields, enums };
    return result;
  }

  search(params: SearchParams, _ctx: Context): SearchResult {
    const Model = this.getModel();
    const { id, find = {}, cols, sort, start = 0, limit = 1, count } = params;
    const sdel = this.getSoftDeleteCond();
    const cond = idAndFind(id, find, sdel);

    const buildQuery = () => {
      const q = Model.find(cond);
      if (cols) q.select(cols as any);
      if (sort) q.sort(sort as any);
      if (start) q.skip(start);
      if (limit) q.limit(limit);
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

  create(params: CreateParams, _ctx: Context): CreateResult {
    return (this.add(params.data) as unknown as Promise<string>)
      .then(id => ({ id })) as unknown as CreateResult;
  }

  update(params: UpdateParams, _ctx: Context): UpdateResult {
    const { id, find, data, force } = params;
    const ids = Array.isArray(id) ? id : [id];
    const Model = this.getModel();

    // 逐个检查 id+find 是否存在
    return Promise.all(
      ids.map(id => Model.findOne(idAndFind(id, find)).select('_id').lean().exec()),
    ).then(docs => {
      const operable: string[] = [];
      const unoperable: string[] = [];
      docs.forEach((doc, i) => {
        if (doc) operable.push(ids[i]);
        else unoperable.push(ids[i]);
      });

      if (unoperable.length && !force) {
        throw new CrudError(
          `Cannot update, ids not found or not permitted: ${unoperable.join(', ')}`,
          CrudErrorCode.UNOPERABLE,
          { ids: unoperable },
        );
      }

      if (!operable.length) return { count: 0 };

      return Promise.all(
        operable.map(id => this.put(id, data) as unknown as Promise<0 | 1>),
      ).then(results => ({ count: results.reduce<number>((sum, r) => sum + r, 0) }));
    }) as unknown as UpdateResult;
  }

  delete(params: DeleteParams, _ctx: Context): DeleteResult {
    const { id, find, data, force } = params;
    const ids = Array.isArray(id) ? id : [id];
    const Model = this.getModel();

    return Promise.all(
      ids.map(id => Model.findOne(idAndFind(id, find)).select('_id').lean().exec()),
    ).then(docs => {
      const operable: string[] = [];
      const unoperable: string[] = [];
      docs.forEach((doc, i) => {
        if (doc) operable.push(ids[i]);
        else unoperable.push(ids[i]);
      });

      if (unoperable.length && !force) {
        throw new CrudError(
          `Cannot delete, ids not found or not permitted: ${unoperable.join(', ')}`,
          CrudErrorCode.UNOPERABLE,
          { ids: unoperable },
        );
      }

      if (!operable.length) return { count: 0 };

      return Promise.all(
        operable.map(id => this.del(id, data) as unknown as Promise<0 | 1>),
      ).then(results => ({ count: results.reduce<number>((sum, r) => sum + r, 0) }));
    }) as unknown as DeleteResult;
  }
  
  /* ---------- core methods ---------- */

  add(data: Record<string, any>): string {
    const Model = this.getModel();
    return Model.create(data).then((doc: any) => String(doc._id)) as unknown as string;
  }

  put(id: string, data: Record<string, any>): 0 | 1 {
    const Model = this.getModel();
    const cond = idAndFind(id);
    return Model.findOneAndUpdate(cond, { $set: data }, { new: true, runValidators: true }).exec()
      .then(doc => (doc ? 1 : 0)) as unknown as 0 | 1;
  }

  del(id: string, _data?: Record<string, any>): 0 | 1 {
    const Model = this.getModel();
    const cond = idAndFind(id);
    const sdel = this.getSoftDeleteData();
    if (sdel) {
      return Model.findOneAndUpdate(cond, { $set: sdel }, { new: true, runValidators: true }).exec()
        .then(doc => (doc ? 1 : 0)) as unknown as 0 | 1;
    }
    return Model.findOneAndDelete(cond).exec()
      .then(doc => (doc ? 1 : 0)) as unknown as 0 | 1;
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
      throw new CrudError(`Current user not permitted to call "${name}"`, CrudErrorCode.UNPERMITTED);
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
      throw new CrudError(`Current user not permitted to call "${name}"`, CrudErrorCode.UNPERMITTED);
    }
    return (crud as any)[funcName].call(crud, params, ctx);
  }

  throw new CrudError(`Method "${name}" is not registered.`, CrudErrorCode.UNCALLABLE);
}
