# hongs-crud

一个基于 Mongoose Schema 的轻量 CRUD 封装，提供 `search / create / update / delete` 四个标准方法，以及 `counts / schema` 两个扩展方法，并内置 `crud / func / role` 三大注册器用于权限管控与统一调度。

```bash
npm install hongs-crud
```

> 依赖（peer）：mongoose `^7 || ^8`

---

## 1. Schema 配置

`hongs-crud` 围绕一个标准的 Mongoose `Schema` 展开，能力通过两种扩展叠加获得：

- **字段内部自定义选项**：在字段 `options` 里直接写 `enumRef` / `dataRef` / `options` / `description` 等，全部是 Mongoose 的非保留字段，不会影响模型运行。
- **Schema 第二个参数的扩展**：`collection` / `enums` / `softDelete` / `countable` / `limitDef` / `limitMax` / `timestamps` 等。

下面是一个完整、最小的例子，包含所有扩展点：

```ts
import { Schema } from 'mongoose';

/* ---------- 枚举字典：放到 Schema options.enums 里，字段通过 enumRef 引用 ---------- */
const ENUMS = {
  userStatus: [
    { value: 'active',  label: '启用' },
    { value: 'frozen',  label: '冻结' },
    { value: 'closed',  label: '关闭' },
  ],
  userRole: [
    { value: 'admin', label: '管理员' },
    { value: 'user',  label: '普通用户' },
  ],
};

const userSchema = new Schema(
  /* ====================== 字段定义 ====================== */
  {
    /* ---- 普通字段 ---- */
    username: {
      type: String,
      required: true,
      unique: true,
      maxlength: 32,
      description: '登录名',                         // 非 mongoose 保留字段，schema() 会原样透出
      options: { maxLength: 32, minLength: 3 },      // 字段内自定义的公开选项（前端/AI 可直接消费）
    },
    password: { type: String, required: true },

    /* ---- 带枚举：通过 enumRef 指向 options.enums 的 key ---- */
    status: {
      type: String,
      default: 'active',
      enumRef: 'userStatus',                         // 1) 字符串：引用 enums[userStatus]
      // enumRef: { enumName: 'userStatus' },        // 2) 或对象写法，当 valueKey/labelKey 非默认时可写
      // enumRef: { enumName: 'userStatus', valueKey: 'value', labelKey: 'label' },
    },
    roles: {
      type: [String],
      default: ['user'],
      enumRef: 'userRole',
    },

    /* ---- 带关联：dataRef 指向一个已注册的 Func（见 §3 注册器）---- */
    orgId: {
      type: Schema.Types.ObjectId,
      dataRef: { method: 'org.options', valueKey: '_id', labelKey: 'name' },
    },

    /* ---- 软删除标记字段（见下 softDelete 扩展）---- */
    isDeleted: { type: Boolean, default: false },
  },

  /* ====================== Schema 第二参数的 hongs-crud 扩展 ====================== */
  {
    collection: 'users',                 // ① 必填：集合名，同时用作 mongoose.model() 名称
    timestamps: true,                    // mongoose 原生：自动维护 createdAt / updatedAt
    softDelete: {                        // ③ 伪删除
      field: 'isDeleted',                //   标记字段名
      value: true,                       //   删除时写入的值，也可传 () => new Date()
      // query: { isDeleted: false },    //   （可选）显式指定查询时过滤软删的条件，默认 $ne: value
    },
    enums: ENUMS,                        // ② 枚举字典，字段通过 enumRef 引用
    countable: ['status', 'roles'],      // ④ 允许 counts() 统计的字段名白名单
    limitDef : 20,                       // ⑤ search() 默认 limit, 未传时的默认值，默认 1；0 表示不限
    limitMax : 500,                      // ⑥ search() limit 上限，超过会抛出异常，默认 1000；0 表示不限
  },
);
```

几个说明：

| 扩展点 | 归属 | 作用 |
|---|---|---|
| `enumRef` | 字段内 | 把字段关联到 `options.enums` 中的某个字典；可写字符串或 `{ enumName, valueKey?, labelKey? }` |
| `dataRef` | 字段内 | 声明该字段的值来源于某个已注册的 Func；写 `{ method, params?, valueKey?, labelKey? }` |
| `options` | 字段内 | 自定义公开选项，前端/AI 可直接消费（表单校验等） |
| `description` | 字段内 | 字段说明文字，schema() 会原样透出 |
| `collection` | SchemaExtra | **必填**，集合名 |
| `enums` | SchemaExtra | 枚举字典（`Record<string, {value,label}[]>`） |
| `softDelete` | SchemaExtra | 伪删除配置；启用后 search / update / delete 自动注入条件 |
| `countable` | SchemaExtra | 允许被 `counts()` 统计的字段名数组 |
| `limitDef` | SchemaExtra | `search()` 默认 `limit`，默认 1，0 不限 |
| `limitMax` | SchemaExtra | `search()` `limit` 上限，默认 1000，0 不限 |

然后，`new Crud(userSchema)` 即可获得 `search` / `create` / `update` / `delete` / `counts` / `schema` 能力。

---

## 2. 方法请求参数与返回结果

6 个方法的入参与返回都是纯 POJO，可被直接 JSON 化，所有 `XxxParams` / `XxxResult` 均支持附加 `[key: string]: any` 的扩展字段。

> 约定：`FindSpec = Record<string, any>`（MongoDB 查询对象）；`ColsSpec = Record<string, 0 | 1>`；`SortSpec = Record<string, 1 | -1>`。

### 2.1 create

```ts
// 入参
interface CreateParams {
  data: Record<string, any>;            // 要写入的文档
  [key: string]: any;
}
// 出参
interface CreateResult {
  id: string;                            // 新文档 _id（hex 字符串）
  [key: string]: any;
}
```

```ts
await crud.create({
  data: { username: 'alice', status: 'active' },
}, ctx);
// → { id: '66b...a01' }
```

### 2.2 update

```ts
interface UpdateParams {
  id   : string | string[];              // 目标 _id 或 _id 数组（批量）
  find?: FindSpec;                       // 附加查询条件（可做租户/归属隔离）
  data : Record<string, any>;            // 要更新的字段
  force?: boolean;                       // 缺省：目标 id 有不存在或不可变更 → 抛 CrudErrno.OWNER_MISMATCH
                                         // true：静默跳过不可操作的 id，只处理可操作的
  [key: string]: any;
}
interface UpdateResult {
  count: number;                         // 实际内容发生变化的文档数（同值更新计入 0）
  [key: string]: any;
}
```

```ts
await crud.update({
  id: '66b...a01',
  data: { status: 'frozen' },
}, ctx);
// → { count: 1 }
```

### 2.3 delete

```ts
interface DeleteParams {
  id   : string | string[];              // 目标 _id 或 _id 数组
  find?: FindSpec;                       // 附加查询条件
  data?: Record<string, any>;            // （保留位，软删除场景可写扩展信息）
  force?: boolean;                       // 作用同 update：缺省=严格，true=静默跳过
  [key: string]: any;
}
interface DeleteResult {
  count: number;                         // 硬删：实际删除条数；软删：实际被打标的条数（重复打标计 0）
  [key: string]: any;
}
```

- 若 schema 配置了 `softDelete`，此方法做「打标记」，并对查询侧自动注入过滤条件。
- 未配置 `softDelete` 时做物理删除。

### 2.4 search

```ts
interface SearchParams {
  id   ?: string | string[];             // _id 或 _id 数组（便捷入口）
  find ?: FindSpec;                      // 一般查询条件
  cols ?: ColsSpec;                      // 字段投影，如 { name: 1, status: 1 }
  sort ?: SortSpec;                      // 排序，如 { createdAt: -1 }
  start?: number;                        // 跳过条数，默认 0
  limit?: number;                        // 返回上限；缺省用 schema.limitDef（默认 1），超过 limitMax 会被截断
  count?: 'all' | 'next' | 'only';       // 统计模式（见下）
  [key: string]: any;
}

type SearchResult =
  | { list: Document[]; count?: number; [k:string]: any }   // 非 count:'only'
  | { count: number;            [k:string]: any };          // count:'only'
```

`count` 模式：

| 值 | 行为 | 返回附带 |
|---|---|---|
| 未传 | 只查列表 | 仅 `{ list }` |
| `'all'` | 列表 + `countDocuments` | `{ list, count }`（count = 总数） |
| `'next'` | 列表 + 是否有下一页 | `{ list, count }`（count = 0 / 1） |
| `'only'` | 仅统计，不要列表 | `{ count }`（无 list） |

### 2.5 counts（扩展）

对 `schema.countable` 里声明的字段做分组统计（`$group + $sort + $limit`），常用于搜索页左侧「筛选条」。

```ts
interface CountsParams {
  find?: FindSpec;                              // 基础过滤条件
  cols?: ColsSpec;                              // 只统计其中某些字段（白/黑名单模式）
  sels?: Record<string, any[]>;                 // 联动已选：{ field: [v1, v2, ...] }，空数组视为没选
  top ?: number | Record<string, number>;       // 每字段取前 N；默认 10；0 不限；也可按字段 { status: 5, roles: 20 }
  [key: string]: any;
}
interface CountsResult {
  counts: Record<string, Record<string, number>>;   // { field: { value1: cnt1, value2: cnt2, ... } }
  count : number;                                   // 当前条件下的总文档数（应用 sels 已选项）
  [key: string]: any;
}
```

`sels` 联动规则（重点）：

- `sels` 中任一非空数组都会转换为 `$in` 并入**总体过滤条件**，`CountsResult.count` 反映该总体过滤下的总文档数。
- 对某个字段自身的统计：**不应用该字段自己的 sels**，保证「已选中的值也能看到它的计数」。
- 对**其他**字段的统计：应用所有 `sels` 条件，结果相互联动。
- `sels.field = []`（空数组）：视为没值，不参与任何条件。

### 2.6 schema（扩展）

把 Mongoose Schema 转译为调用方可消费的 `{ fields, enums }`，方便前端渲染及 AI 编排。

```ts
interface SchemaParams {
  cols?: ColsSpec;                 // 可选：只返回指定字段
  [key: string]: any;
}
interface SchemaResult {
  fields: Record<string, {
    type       : string;           // 'String' | 'Number' | 'Boolean' | 'Date' | 'ObjectId' | ...
    default    ?: any;
    required   ?: boolean;
    immutable  ?: boolean;
    description?: string;          // 字段内声明的描述
    enumRef    ?: string | { enumName: string; valueKey?: string; labelKey?: string };
    dataRef    ?: string | { method: string; params?: Record<string,any>; valueKey?: string; labelKey?: string };
    options    ?: Record<string, any>;   // 字段内声明的公开选项
    [k:string] : any;
  }>;
  enums: Record<string, { value: string; label: string; [k:string]: any }[]>;
  [key: string]: any;
}
```

---

## 3. 注册器：crud / func / role

三者都是扁平的全局注册表；`callFunc(name, params, ctx)` 会按「Func 名 → CrudName.MethodName」的顺序解析并执行。

### 3.1 注册 Crud（模型）

```ts
import { Cradle, regCrud, getCrud, hasCrud, getCrudNames } from 'hongs-crud';

const userSchema = new Schema({ /* ... */ }, { collection: 'users' });
const userCrud = new Cradle(userSchema);

// 注册：动作字符串 "user.search" / "user.create" ... 就指向该实例的对应方法
regCrud('user', userCrud);

hasCrud('user');           // → true
getCrud('user');           // → userCrud 实例
getCrudNames();            // → ['user', ...]
```

`Cradle` 默认的 `callable`（可被外部调度的方法白名单）为：

```ts
callable = ['create', 'update', 'delete', 'search', 'counts', 'schema'];
```

子类可覆写 `callable` 来收紧或扩展，不在其中的方法即便权限符合也不会被调度。

### 3.2 注册 Func（全局函数）

```ts
import { regFunc, getFunc, hasFunc, getFuncNames } from 'hongs-crud';

regFunc('health.ping',     () => ({ ok: true, ts: Date.now() }));
regFunc('system.versions', () => ({ node: process.version }));
regFunc('org.options',  async () => {
  // 常见 dataRef 目标：返回 [{_id, name}, ...] 供下拉选项消费
  return [{ _id: 'o1', name: '组织A' }, { _id: 'o2', name: '组织B' }];
});
```

> 注意：上面 schema 例子中 `orgId.dataRef.method = 'org.options'` 就是指向这里注册的 Func。

### 3.3 注册 Role（角色 → 动作集合）

```ts
import { regRole, hasRole, getRole, getRoleNames, isPermitted } from 'hongs-crud';

// 一个角色对应可执行「动作字符串」集合（Func 名 或 CrudName.MethodName）
regRole('admin', ['user.search', 'user.create', 'user.update', 'user.delete',
                  'user.counts', 'user.schema',
                  'health.ping', 'system.versions']);
regRole('user',  ['user.search', 'health.ping']);
regRole('guest', ['health.ping']);

// 单个判断：任一角色包含动作即放行
isPermitted('user.delete',   ['user']);   // → false
isPermitted('user.delete',   ['admin']);  // → true
isPermitted('health.ping',   ['guest']);  // → true
```

`acts` 参数可传 `string[]` 或 `Set<string>`。

### 3.4 统一调度入口 `callFunc`

```ts
import { callFunc, CrudError, CrudErrno } from 'hongs-crud';

// Context 至少可带 uid / roles，业务可自行扩展（[key:string]: any）
const ctx = { uid: 'u1', roles: ['admin'], tenant: 't1' };

// 1) 调模型方法（内部检查 callable + isPermitted）
const list = await callFunc('user.search', {
  find: { status: 'active' },
  cols: { username: 1, status: 1 },
  sort: { createdAt: -1 },
  start: 0,
  limit: 20,
  count: 'all',
}, ctx);
// → { list: [...], count: N }

// 2) 调全局函数
const pong = await callFunc('health.ping', {}, ctx);
```

错误类型：

```ts
class CrudError extends Error {
  code: number;
  data?: Record<string, any>;
  constructor(message: string, code?: number, data?: Record<string, any>);
}

enum CrudErrno {
  METHOD_MISSING = -32601,   // 方法未注册 / 不在 callable
  PARAMS_INVALID = -32602,   // 参数非法（如 search limit 超上限）
  INTERNEL_ERROR = -32603,   // 内部错误
  LOGIN_REQUIRED = -32001,   // 需要登录
  RIGHT_DEPRIVED = -32003,   // 权限不足（isPermitted 拒绝）
  OWNER_MISMATCH = -32009,   // 目标 id 不存在 / 非当前用户可操作的
}
```

---

## License

MIT
