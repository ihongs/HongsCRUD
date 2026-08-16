// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

import type { Document } from 'mongoose';

export type FindSpec = Record<string, any>;
export type ColsSpec = Record<string, 0 |  1>;
export type SortSpec = Record<string, 1 | -1>;
export type CountMode = 'all' | 'next' | 'only';

export interface CreateParams {
  data: Record<string, any>;
  [key: string]: any;
}

export interface CreateResult {
  id: string;
  [key: string]: any;
}

export interface UpdateParams {
  id: string | string[];
  find?: FindSpec;
  data : Record<string, any>;
  force?: boolean;
  [key: string]: any;
}

export interface UpdateResult {
  count: number;
  [key: string]: any;
}

export interface DeleteParams {
  id: string | string[];
  find?: FindSpec;
  data?: Record<string, any>;
  force?: boolean;
  [key: string]: any;
}

export interface DeleteResult {
  count: number;
  [key: string]: any;
}

export interface SearchParams {
  id?: string | string[];
  find?: FindSpec;
  cols?: ColsSpec;
  sort?: SortSpec;
  start?: number;
  limit?: number;
  count?: CountMode;
  [key: string]: any;
}

export interface SearchResult {
  list?: Document[];
  count?: number;
  [key: string]: any;
}

export interface CountsParams {
  find?: FindSpec;
  cols?: ColsSpec;
  sels?: Record<string, any[]>; // 已选值 {field: [value1, value2, ...]}
  top?: number | Record<string, number>; // 最大数量 {field: 10}
  [key: string]: any;
}

export interface CountsResult {
  counts: Record<string, Record<any, number>>; // 统计量 {field: {value1: 10, value2: 20, ...}}
  count : number; // 总数，范围：find + sels
  [key: string]: any;
}

export interface UpsertParams {
  uks?: string[];
  list: Record<string, any>[];
}

export interface UpsertResult {
  created: number;
  updated: number;
  errors?: UpsertError[];
}

export interface UpsertError {
  index: number;
  message: string;
  errors?: Record<string, any>;
}

export interface SchemaParams {
  cols?: ColsSpec;
  [key: string]: any;
}

export interface SchemaResult {
  fields: Record<string, SchemaField>;
  enums : Record<string, EnumItem []>;
  [key: string]: any;
}

export interface SchemaField {
  type: string;
  default?: any;
  required?: boolean;
  immutable?: boolean;
  /** 字段值不可见，对应 select: false，如 password: {type: String, select: false} */
  invisible?: boolean;
  /** 字段是否可被 counts() 统计，对应 countable: true  */
  countable?: boolean;
  /** 字段内声明的枚举引用名，对应 enums 的键 */
  enumRef?: string | EnumRef;
  /** 字段内声明的数据引用名，对应 FUNCS 的键 */
  dataRef?: string | DataRef;
  /** 字段内声明的公开选项（非 mongoose 的） */
  options?: Record<string, any>;
  /** 字段标签 */
  label?: string;
  /** 字段描述 */
  description?: string;
}

/** Schema options 扩展结构（仅供参考） */
export interface SchemaExtra {
  collection?: string ;
  softDelete?: SoftDel;
  enums?: Record<string, EnumItem[]>;
  /** search 默认 limit，未传时的取值，默认 1；设为 0 表示不限 */
  limitDef?: number;
  /** search 最大 limit 上限，超过会被截断，默认 1000；设为 0 表示不限 */
  limitMax?: number;
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
