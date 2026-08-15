// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

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

export interface CountsParams {
  find?: FindSpec;
  cols?: ColsSpec;
  sels?: Record<string, any[]>; // 已选值 {field: [value1, value2, ...]}
  top?: number | Record<string, number>; // 最大数量 {field: 10}
}

export interface CountsResult {
  counts: Record<string, Record<any, number>>; // 统计量 {field: {value1: 10, value2: 20, ...}}
  total: number; // 总数量
}

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
  /** 字段是否可被 counts 接口统计（schema 字段上声明 countable: true） */
  countable?: boolean;
  /** 字段内声明的枚举引用名（对应 enums 的键） */
  enumRef?: string | EnumRef;
  /** 字段内声明的数据引用名（对应 FUNCS 的键） */
  dataRef?: string | DataRef;
  /** 字段内声明的公开选项（给前端使用，非 mongoose 保留） */
  options?: Record<string, any>;
}

/** Schema options 扩展结构（仅供参考） */
export interface SchemaExtra {
  collection?: string ;
  softDelete?: SoftDel;
  enums?: Record<string, EnumItem[]>;
  /** 可统计字段名（schema 第二个参数扩展，代替逐字段 opts.countable） */
  countable?: string[];
}

export interface EnumItem {
  value: string;
  label: string;
  [key: string]: any;
}

export interface EnumRef {
  enumName : string;
  valueKey?: string; // 默认 value
  labelKey?: string; // 默认 label
}

export interface DataRef {
  method : string;
  params?: Record<string, any>;
  valueKey?: string; // 默认 _id
  labelKey?: string; // 默认 name
}

export interface SoftDel {
  /** 伪删除字段名 */
  field: string;
  /** 已删除标记值，可为值或函数，默认 true */
  value?: any;
  /** 未删除的查询，可以显式指定，默认 $ne: value */
  query?: any;
}

export interface Context {
  uid?: string;
  roles?: string[] | Set<string>;
  [key: string]: any;
}

export interface Crud {
  callable: string[];
  search(params: SearchParams, ctx: Context): SearchResult;
  create(params: CreateParams, ctx: Context): CreateResult;
  update(params: UpdateParams, ctx: Context): UpdateResult;
  delete(params: DeleteParams, ctx: Context): DeleteResult;
}

export type Func = (params: Record<string, any>, ctx: Context) => any;
