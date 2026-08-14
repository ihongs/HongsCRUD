import type { Document } from 'mongoose';

export type FindSpec = Record<string, any>;
export type ColsSpec = Record<string, 0 |  1>;
export type SortSpec = Record<string, 1 | -1>;
export type CountMode = 'all' | 'next' | 'only';

export interface SearchParams {
  id?: string | string[];
  find?: FindSpec;
  cols?: ColsSpec;
  sort?: SortSpec;
  start?: number;
  limit?: number;
  count?: CountMode;
}

export interface SearchResultWithList {
  list: Document[];
  count?: number;
}

export interface SearchResultCountOnly {
  count: number;
}

export type SearchResult = SearchResultWithList | SearchResultCountOnly;

export interface CreateParams {
  data: Record<string, any>;
}

export interface CreateResult {
  id: string;
}

export interface UpdateParams {
  id: string | string[];
  find?: FindSpec;
  data : Record<string, any>;
  force?: boolean;
}

export interface UpdateResult {
  count: number;
}

export interface DeleteParams {
  id: string | string[];
  find?: FindSpec;
  data?: Record<string, any>;
  force?: boolean;
}

export interface DeleteResult {
  count: number;
}

export interface SchemaParams {
  cols?: ColsSpec;
}

export interface SchemaResult {
  fields: Record<string, SchemaField>;
  enums : Record<string, EnumItem []>;
}

export interface SchemaField {
  type: string;
  default?: any;
  required?: boolean;
  immutable?: boolean;
  description?: string;
  enumRef?: string ;
  dataRef?: DataRef;
  rules?: Record<string, any>;
}

/** Schema options 扩展结构（仅供参考） */
export interface SchemaExtra {
  collection?: string ;
  softDelete?: SoftDel;
  enums?: Record<string, EnumItem[]>;
  enumRefs?: Record<string, string >;
  dataRefs?: Record<string, DataRef>;
  rules?: Record<string, Record<string, any>>;
}

export interface SoftDel {
  /** 伪删除字段名 */
  field: string;
  /** 已删除标记值，可为值或函数，默认 true */
  value?: any;
  /** 未删除的查询，可以显式指定，默认 $ne: value */
  query?: any;
}

export interface DataRef {
  ref: string;
  fk?: string;
  pk?: string;
  find?: FindSpec;
  sort?: SortSpec;
  cols?: ColsSpec;
}

export interface EnumItem {
  value: string;
  label: string;
  [key: string]: any;
}

export interface Context {
  uid?: string;
  roles?: string[] | Set<string>;
  [key: string]: any;
}

export interface Crud {
  callable: string[];
  schema(params: SchemaParams, ctx: Context): SchemaResult;
  search(params: SearchParams, ctx: Context): SearchResult;
  create(params: CreateParams, ctx: Context): CreateResult;
  update(params: UpdateParams, ctx: Context): UpdateResult;
  delete(params: DeleteParams, ctx: Context): DeleteResult;
}

export type Func = (params: Record<string, any>, ctx: Context) => any;
