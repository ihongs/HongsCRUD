// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

import type { Document } from 'mongoose';

export type FindMode = 'only-items' | 'only-total' | 'has-more';
export type FindSpec = Record<string, any>;
export type ColsSpec = Record<string, 0 |  1>;
export type SortSpec = Record<string, 1 | -1>;

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
  data : Record<string, any>;
  find?: FindSpec;
  force?: boolean;
  [key: string]: any;
}

export interface UpdateResult {
  affected: number;
  [key: string]: any;
}

export interface DeleteParams {
  id: string | string[];
  data?: Record<string, any>;
  find?: FindSpec;
  force?: boolean;
  [key: string]: any;
}

export interface DeleteResult {
  affected: number;
  [key: string]: any;
}

export interface SearchParams {
  id?: string | string[];
  wd?: string;
  mode?: FindMode;
  find?: FindSpec;
  cols?: ColsSpec;
  sort?: SortSpec;
  start?: number;
  limit?: number;
  [key: string]: any;
}

export interface SearchResult {
  items?: Document[];
  total?: number;
  more?: boolean;
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
  total : number; // 总数，范围：find + sels
  [key: string]: any;
}

export interface UpsertParams {
  uks?: string[];
  items: Record<string, any>[];
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

/**
 * ## mongoose 配置结构：
 * ```json
 * new mongoose.Schema({
 *   field1: {
 *     type: String,
 *     default: 'default value', // 默认值，对应 default
 *     min: 3, // 最小长度，对应 minimum
 *     max: 9, // 最大长度，对应 maximum
 *     minlength: 3, // 最小长度，对应 string 的 minLength，object 的 minProperties，array 的 minItems
 *     maxlength: 9, // 最大长度，对应 string 的 maxLength，object 的 maxProperties，array 的 maxItems
 *     match: /^[a-zA-Z0-9_]+$/, // 正则表达式，对应 pattern
 *     enum: ['value1', 'value2'], // 枚举值（无需体现在返回中，返回枚举数据总用 refData）
 *     required: true, // 必填字段，对应上级 object 的 required 数组
 *     select: false, // 不返回该字段，对应 writeOnly
 *     immutable: true, // 不可变字段，对应 x-immutable
 *     // 下为扩展项
 *     assign: false, // 外部不可赋值，对应 readOnly
 *     countable: true, // 可统计字段，对应 x-countable
 *     refData: { // 对应 x-ref，无 method 表示取 dataList 中数据
 *       method: 'field1', // 远程请求方法名
 *       params: { find }, // 远程请求参数集
 *       list: 'list', // dataList 的键或请求返回的列表键
 *       value: 'value', // 取值字段名，ref 时指 dataList.name1 中的 value 字段
 *       title: 'title', // 标题字段名，ref 时指 dataList.name1 中的 title 字段
 *     },
 *     options: { // 对应 x-opt，不确定的公开选项
 *       opt: 'value',
 *     },
 *     title: '字段1', // 对应 x-title
 *     description: '字段1说明', // 对应 x-description
 *   },
 *   // 其他字段...
 * }, {
 *   collection: 'MongoDB 集合名称',
 *   timestamps: true, // 开启 createdAt,updatedAt
 *   softDelete: { // 设为 true 同下
 *     isDeleted: 'isDeleted', // 软删除字段名
 *     deletedAt: 'deletedAt', // 删除时间字段，可用 false 取消
 *     deleted: true, // 软删除值
 *   },
 *   dataList: {
 *     field1: [
 *       { value: 'value1', title: '选项1' },
 *       { value: 'value2', title: '选项2' },
 * *   ]
 *   },
 *   title: '模型标题',
 *   description: '模型说明',
 * })
 * ```
 * 1. 根节点：对应 mongoose 模型的根节点，包含模型标题、说明、必填字段、字段集合、数据列表等。
 * 2. 字段节点：对应 mongoose 模型的字段节点，包含字段标题、说明、默认值、正则、最小最大值等。
 * 3. 数据列表：对应 mongoose 模型的 datalist 选项，用于枚举值。
 */

/** schema() 的返回，本身即 JSON Schema 的根节点 */
export interface SchemaResult extends SchemaNode {
  /** JSON Schema 版本声明，固定值 */
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  /** 根节点固定为 object */
  type: 'object';
  /** 模型标题，对应 Schema 扩展 title */
  title?: string;
  /** 模型说明，对应 Schema 扩展 description */
  description?: string;
  /** 必填字段，对应 Schema 字段 required: true */
  required?: string[];
  /** 字段集合，键为字段名 */
  properties: Record<string, SchemaNode>;
  /** 数据列表，对应 Schema 扩展 datalist，仅根节点有 */
  'x-datalist'?: Record<string, Record<string, any>[]>;
  [key: string]: any;
}

/** JSON Schema 节点，根节点、字段节点共用此结构 */
export interface SchemaNode {
  /** String→string，Number→number，Date→string，Boolean→boolean，Map/SubDocument→object，[X]→array */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  /** 字段标题，对应字段内 title */
  title?: string;
  /** 字段说明，对应字段内 description */
  description?: string;
  /** 对应 default（函数型默认值不透出） */
  default?: any;
  
  /** type: 'number'，对应 min */
  minimum?: number;
  /** type: 'number'，对应 max */
  maximum?: number;

  /** type: 'string'，对应 Date 的 date-time、ObjectId 的 object-id */
  format?: 'date-time' | 'object-id';
  /** type: 'string'，对应 match，正则转字符串 */
  pattern?: string;
  /** type: 'string'，对应 minLength */
  minLength?: number;
  /** type: 'string'，对应 maxLength */
  maxLength?: number;

  /** type: 'array'，数组元素类型，如 [String]、[Number]、[Map]、[SubDocument] 等 */
  items?: SchemaNode;
  /** type: 'array'，对应 minLength */
  minItems?: number;
  /** type: 'array'，对应 maxLength */
  maxItems?: number;

  /** type: 'object'，Map 或 SubDocument 类型，如 type: Map, of: Number */
  properties?: Record<string, SchemaNode>;
  /** type: 'object'，Map 的值类型，如 type: Map, of: Number */
  additionalProperties?: SchemaNode | boolean;
  /** type: 'object'，对应 minLength */
  minProperties?: number;
  /** type: 'object'，对应 maxLength */
  maxProperties?: number;

  /** type: 'object'，properties 中必填的字段名列表，对应字段内 required: true */
  required?: string[];

  /** 对应 assign: false（系统字段，可读不可写） */
  readOnly?: boolean;
  /** 对应 select: false（秘密字段，可写不可读） */
  writeOnly?: boolean;

  /** 创建后不可修改，对应字段内 immutable: true */
  'x-immutable'?: boolean;
  /** counts() 可统计，对应字段内 countable: true */
  'x-countable'?: boolean;
  /** 选项来源，对应字段内 refData  */
  'x-ref'?: DataRef;

  [key: string]: any;
}

/**
 * 字段的选项数据来源
 * 关联到 dataList:
 * ```json
 * {
 *   "list": "field1"
 * }
 * ```
 * 关联到 mod.func:
 * ```json
 * {
 *   "method": "model.search",
 *   "params": {
 *     "find": { "boost": { $gt: 0 } },
 *     "cols": { "_id": 1, "name": 1 }, 
 *   },
 *   "list": "list",
 *   "value": "_id",
 *   "title": "name"
 * }
 * ```
 */
export interface DataRef {
  /** json-rpc 获取方法 */
  method?: string;
  /** json-rpc 附加参数 */
  params?: Record<string, any>;
  /** dataList 的键或返回的列表键，默认 list */
  list?: string;
  /** 取值字段名，默认 valiue */
  value?: string;
  /** 显示字段名，默认 title */
  title?: string;
}

export interface SoftDel {
  /** 伪删除字段名 */
  isDeleted?: string;
  /** 删除时间字段 */
  deletedAt?: string;
  /** 已删除标记值，可为值或函数，默认 true */
  deleted?: any;
  default?: any;
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
