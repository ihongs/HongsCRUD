// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

import type { Document } from 'mongoose';

export type FindMode = 'only-total' | 'only-list' | 'list-more';
export type FindSpec = Record<string, any>;
export type SelsSpec = Record<string, any[] >; // 已选 {field: [value1, value2, ...]}
export type SortSpec = Record<string, 1 | -1>;
export type ColsSpec = Record<string, 1 | 0 >;
export type RefsSpec = boolean | Record<string, 1 | 0 >; // true 全部或 {field: 1}，undefined/null 等同 false 不取
export type TopsSpec = number  | Record<string, number>; // 取前 10 或 {field: 10}

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
  affected : number;
  validIds?: string[];
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
  affected : number;
  validIds?: string[];
  [key: string]: any;
}

export interface SearchParams {
  id?: string | string[];
  wd?: string;
  mode?: FindMode;
  find?: FindSpec;
  sort?: SortSpec;
  cols?: ColsSpec;
  refs?: RefsSpec;
  start?: number;
  limit?: number;
  [key: string]: any;
}

export interface SearchResult {
  list ?: Document[];
  refs ?: Record<string, any[]>; // 关联数据 {field: [{_id: '123', name: '关联项1'}, {_id: '456', name: '关联项2'}]}
  more ?: boolean;
  total?: number;
  [key: string]: any;
}

export interface StatisParams {
  id?: string | string[];
  wd?: string;
  find?: FindSpec;
  cols?: ColsSpec;
  sels?: SelsSpec;
  tops?: TopsSpec;
  refs?: RefsSpec;
  [key: string]: any;
}

export interface StatisResult {
  hits : Record<string, any[]>; // 统计数据 {field: [{value: 'value1', count: 20}, {value: 'value2', count: 10}]}
  refs?: Record<string, any[]>; // 关联数据 {field: [{_id: '12', name: '关联项1'}, {_id: '34', name: '关联项2'}]}
  total: number; // 总数，范围：find + sels
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
 *     required: true, // 必填字段，对应上级 object 的 required 数组
 *     select: false, // 不返回该字段，对应 writeOnly
 *     immutable: true, // 不可变字段，对应 x-immutable
 *     // 下为扩展项
 *     writable: false, // 外部不可写，对应 readOnly
 *     readable: false, // 外部不可读，对应 writeOnly；与 writable 同属程序层面预留的读写符号
 *     countable: true, // 可统计字段，对应 x-countable
 *     enum: ['value1', 'value2'], // 枚举值
 *     enumTags: { // 枚举标签
 *       value1: '选项1',
 *       value2: '选项2',
 *     },
 *     reference: { // 引用关系
 *       method: 'method', // 远程请求方法名
 *       params: { find }, // 远程请求参数集
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
 *   title: '模型标题',
 *   description: '模型说明',
 * })
 * ```
 * 1. 根节点：对应 mongoose 模型的根节点，包含模型标题、说明、必填字段、字段集合、数据列表等。
 * 2. 字段节点：对应 mongoose 模型的字段节点，包含字段标题、说明、默认值、正则、最小最大值等。
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
  format?: string;
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

  /** 对应 writable: false（系统字段，可读不可写） */
  readOnly?: boolean;
  /** 对应 select: false 或 readable: false（秘密字段，可写不可读） */
  writeOnly?: boolean;

  /** 创建后不可修改，对应字段内 immutable: true */
  'x-immutable'?: boolean;
  /** 统计接口可计算，对应字段内 countable: true */
  'x-countable'?: boolean;
  /** 关联的数据来源，对应字段内 reference: { items } */
  'x-reference'?: RefItem;
  /** 枚举标签，对应字段内 enumTags */
  'x-enum-tags'?: Record<string, string>;

  [key: string]: any;
}

export interface RefItem {
  /** json-rpc 获取方法 */
  method?: string;
  /** json-rpc 附加参数 */
  params?: Record<string, any>;
  /** 关联资源名，默认同字段名 */
  refName?: string;
  /** 返回列表键，默认 list */
  listKey?: string;
  /** 关联值字段，默认 _id  */
  idField?: string;
  /** 查询参数名，默认  id  */
  idParam?: string;
  /** 关联说明  */
  description?: string;
}

export interface RefPath {
    path: string[];
    name: string  ; // 全名，对应 path.join('.')
    key : string  ; // 键名，对应 refName，默认同 name
    ref : RefItem ;
}

export interface SoftDel {
  /** 伪删除字段名 */
  isDeleted?: string;
  /** 删除时间字段 */
  deletedAt?: string;
  /** 已删除标记值，可为值或函数，默认 true */
  deleted?: any;
  /** 默认值, 可为值或函数，默认 undefined */
  default?: any;
}

export interface Context {
  via?: string;
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

export type Func = (
  pms : Record<string, any>,
  ctx : Context
) => any;

export type Hook = (
  name: string,
  pms : Record<string, any>,
  ctx : Context,
  next: Func,
) => any;
