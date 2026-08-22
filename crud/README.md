# hongs-crud

一个基于 Mongoose Schema 的轻量 CRUD 封装，提供 `search / create / update / delete` 四个标准方法，以及 `counts / upsert / schema` 三个扩展方法，并内置 `crud / func / role` 三大注册器用于权限管控与统一调度。各方法可供 json-rpc 和 mcp 调用，通过 schema 可返回 JSON Schema 规范的结构，以便前端和 AI 识别处理等。

源码：[github.com/ihongs/HongsCRUD](https://github.com/ihongs/HongsCRUD/tree/main/crud)

```bash
npm install hongs-crud
```

> 依赖（peer）：mongoose `^7 || ^8`

---

## 1. Schema 配置

`hongs-crud` 围绕标准 Mongoose `Schema` 展开，能力通过两种扩展叠加获得：

- **字段内部自定义选项**：`title` / `description` / `assign` / `countable` / `reference` 等。
- **扩展参数自定义选项**：`title` / `description` / `collection` / `references` / `softDelete` / `limitDef` / `limitMax` 等。

下面是一个完整、简单的例子，包含所有扩展点：

```ts
import { Schema } from 'mongoose';
import { getValues } from 'hongs-crud';

/* ---------- 数据列表：放到 Schema 的 references 里，字段通过 reference 引用 ---------- */
const REFERENCES = {
  status: [
    { value: 'active', title: '启用' },
    { value: 'frozen', title: '冻结' },
    { value: 'closed', title: '关闭' },
  ]
};

const userSchema = new Schema(
  /* ====================== 字段定义 ====================== */
  {
    username: {
      type: String,
      unique: true,
      required: true,                                // → 上级 object 的 required 数组
      minlength: 3,                                  // → minLength
      maxlength: 32,                                 // → maxLength
      match: /^[a-zA-Z0-9_]+$/,                      // → pattern（正则转字符串）
      title: '用户名',                                // → title
      description: '登录账号，字母数字下划线',           // → description
    },
    password: {
      type: String,
      select: false,                                 // → writeOnly，可写不可读
      required: true,
    },
    passsalt: {
      type: String,
      assign: false,                                 // → readOnly，外部不可赋值
    },
    age: {
      type: Number,
      min: 0,                                        // → minimum
      max: 200,                                      // → maximum
    },
    status: {
      type: String,
      default: 'active',                             // → default
      immutable: true,                               // → x-immutable，创建后不可修改
      countable: true,                               // → x-countable，可被 counts() 统计
      reference: { items: 'userStatus' },            // → x-reference，引用 references.userStatus
      enum: getValues(REFERENCES.userStatus),        // mongoose 原生枚举验证，不透出
    },
    orgId: {
      type: Schema.Types.ObjectId,                   // → type: string, format: object-id
      reference: {                                   // 有 method 即远程取数
        method: 'org.search',                        // json-rpc 方法名（Func 或 CrudName.MethodName）
        params: { cols: { _id: 1, name: 1 } },       // 附加参数
        items : 'items',                             // 返回结果中的列表键，默认 items
        value : '_id',                               // 取值字段名，默认 value
        title : 'name',                              // 显示字段名，默认 title
      },
      options: {
        opt: 'value',                                // → x-opt，公开扩展选项
      }
    }
  },

  /* ====================== Schema 第二参数的 hongs-crud 扩展 ====================== */
  {
    collection: 'users',                 // 必填：集合名，同时用作 mongoose.model() 名称
    timestamps: true,                    // mongoose 原生：自动维护 createdAt / updatedAt
    softDelete: true,                    // 伪删除，等价于 { isDeleted: 'isDeleted', deletedAt: 'deletedAt', deleted: true, default: false }
    references: REFERENCES,              // 数据表，字段通过 reference 引用
    limitDef  : 20,                      // search() 默认 limit，未传时的默认值，默认 1；0 表示不限
    limitMax  : 500,                     // search() limit 上限，超过抛 CrudErrno.PARAMS_INVALID，默认 1000；0 表示不限
    title       : '用户',                 // 模型标题，透出到 schema() 根节点 title
    description : '系统用户表',            // 模型说明，透出到 schema() 根节点 description
  },
);
```

mongoose 扩展：

| 扩展点 | 归属 | 作用 |
|---|---|---|
| `title` | Schema 扩展、字段内 | 模型标题、字段标题，透出为 JSON Schema 的 `title` |
| `description` | Schema 扩展、字段内 | 模型说明、字段说明，透出为 JSON Schema 的 `description` |
| `assign` | 字段内 | 写 `assign: false` 表示外部不可赋值，透出为 `readOnly` |
| `countable` | 字段内 | 写 `countable: true` 表示该字段可被 `counts()` 统计，透出为 `x-countable` |
| `reference` | 字段内 | 声明该字段的选项数据来源，透出为 `x-reference`；无 `method` 时取 `references[items]`，有 `method` 时远程调用 |
| `options` | 字段内 | 任意附加信息，每个 key 加 `x-` 前缀后透出（如 `opt` → `x-opt`） |
| `collection` | Schema 扩展 | **必填**，集合名 |
| `softDelete` | Schema 扩展 | 伪删除配置；`true` 或 `{ isDeleted, deletedAt, deleted, default }`，启用后自动补字段，且 search / update / delete / counts 自动注入条件 |
| `references` | Schema 扩展 | 引用数据表，字段通过 `reference.items` 引用，透出为 `x-references` |
| `limitDef` | Schema 扩展 | `search()` 默认 `limit`，默认 1，0 不限 |
| `limitMax` | Schema 扩展 | `search()` `limit` 上限，默认 1000，0 不限，超过抛异常 `CrudErrno.PARAMS_INVALID` |

mongoose 选项到 JSON Schema 的映射：

| Mongoose | JSON Schema |
|---|---|
| type: `String` / `Number` / `Boolean` | type: 'string' / 'number' / 'boolean' |
| type: `Schema.Types.Decimal128` | type: 'number' |
| type: `Date` | type: 'string', format: 'date-time' |
| type: `Schema.Types.ObjectId` | type: 'string', format: 'object-id' |
| type: `Map` / `SubDocument` | type: 'object'（`properties` / `additionalProperties`） |
| type: `[X]` | type: 'array'（`items`） |
| `default` | `default`（函数型默认值不透出） |
| `required: true` | 追加到上级 object 的 `required` 数组 |
| `min` / `max` | `minimum` / `maximum` |
| `minlength` / `maxlength` | `minLength`/`maxLength`、`minItems`/`maxItems`、`minProperties`/`maxProperties`（按 type） |
| `match` | `pattern` |
| `select: false` | `writeOnly` |
| `assign: false` | `readOnly` |
| `select: false` + `assign: false` | 整个字段跳过，不透出 |
| `createdAt` / `updatedAt` | `readOnly`（ timestamps 自动维护） |
| `immutable: true` | `x-immutable` |
| `countable: true` | `x-countable` |
| `reference: { items }` | `x-reference` |
| `options: { opt: ... }` | `x-opt`（每个 key 加 `x-` 前缀） |

然后，`new Cradle(userSchema)` 即可获得 `create` / `update` / `delete` / `search` / `counts` / `upsert` / `schema` 能力。

---

## 2. 方法请求参数与返回结果

方法的入参与返回都是纯 POJO，可直接 JSON 化；所有参数和结果都支持附加任意扩展字段。下面用最简单的举例说明每个方法的请求参数与返回数据。

### 2.1 create

```ts
// 请求
{ data: { username: 'alice', status: 'active' } }

// 返回
{ id: '66b...a01' }
```

### 2.2 update

```ts
// 请求
{ id: '66b...a01', data: { status: 'frozen' } }

// 返回（实际内容发生变化的文档数；同值更新计 0）
{ affected: 1, validIds: ['66b...a01'] }
```

- `force: true` 时，不存在的 id 静默跳过；缺省则抛异常。
- `find` 可选，附加查询条件（做租户/归属隔离）。

### 2.3 delete

```ts
// 请求
{ id: '66b...a01' }

// 返回（硬删：删除条数；软删：被打标条数，重复打标计 0）
{ affected: 1, validIds: ['66b...a01'] }
```

### 2.4 search

```ts
// 请求
{
  id   : ['66b...a01'],               // 可单个或数组，用于获取详情
  wd   : 'alice',                     // 搜索关键词
  find : { status: 'active' },        // 查询条件
  cols : { username: 1, status: 1 },  // 投影
  sort : { createdAt: -1 },           // 排序
  start: 0,                           // 跳过
  limit: 20,                          // 上限；缺省用 schema.limitDef，超过 limitMax 抛异常
  mode: '',                           // 统计模式，见下
}

// 返回
{
  items: [{ _id: '66b...a01', username: 'alice', status: 'active' }, ...],
  total: 32,
}
```

`mode` 模式：

| 值 | 返回 |
|---|---|
| 未传 | `{ items, total }` |
| `'only-items'` | `{ items }` |
| `'only-total'` | `{ total }` |
| `'has-more'` | `{ items, more }`（more = true 时有下一页） |

### 2.5 counts（扩展）

对字段内声明了 `countable: true` 的字段做分组统计，常用于搜索页筛选器。

```ts
// 请求
{
  find: { status: 'active' },         // 基础过滤
  sels: { status: ['active'] },       // 联动已选；空数组视为没选
  top : 10,                           // 每字段取前 N，默认 10；也可按字段 { status: 5 }
}

// 返回
{
  counts: {
    status: { active: 28, frozen: 5, closed: 2 },
    roles : { user: 32, admin: 3 },
  },
  total: 35,                          // 应用 sels 已选条件后的总文档数
}
```

`sels` 联动规则：

- 任一非空数组转为 `$in` 并入总过滤条件，`count` 反映该条件下的总数。
- 已选字段不应用自己的 `sels` 条件（避免无法继续筛选该字段其他选项）。
- 其他字段应用所有 `sels` 条件，结果相互联动。

### 2.6 upsert（扩展）

批量 upsert：逐行根据 `uks` 检查是否存在，存在则更新，不存在则添加。单行失败不中断，记入 `errors`。

```ts
// 请求
{
  uks: ['_id'],                       // 默认 ['_id']；有 _id 更新、没 _id 添加
  items: [
    { name: 'alice', age: 20 },                       // 没 _id → 添加
    { _id: '66b...a01', name: 'alice', age: 21 },     // 有 _id 且存在 → 更新
    { _id: '66b...xxx', name: 'ghost', age: 99 },     // 有 _id 不存在 → 报错
  ],
}

// 返回
{
  created: 1,
  updated: 1,
  errors: [
    { index: 2, message: 'Item with _id(66b...xxx) not found' },
  ],
}
```

- `uks` 默认 `['_id']`：有 `_id` 就更新、没 `_id` 就添加；有 `_id` 但找不到记入 `errors`。
- `uks` 为其他字段（如 `['username']`）时：按 `uks` 查到则更新，查不到则添加（upsert 语义，不报错）。
- 校验失败的行：`errors` 项含 `message` + `errors`（字段级明细）；其他错误只记 `message`。

### 2.7 schema（扩展）

把 Mongoose Schema 转译为标准 **JSON Schema**（draft 2020-12），供前端渲染表单及 AI 编排。返回体本身就是 JSON Schema 根节点：`$schema` / `type: 'object'` / `title` / `description` / `required` / `properties` / `x-references` 都在顶层，`properties` 里才是具体字段。

```ts
// 请求
{ cols: { username: 1, status: 1 } }    // 可选，投影，只输出指定字段

// 返回
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "title": "用户",
  "description": "系统用户表",
  "required": ["username", "password"],
  "properties": {
    "_id": {
      "type": "string",
      "format": "object-id"
    },
    "username": {
      "type": "string",
      "title": "用户名",
      "description": "登录账号，字母数字下划线",
      "minLength": 3,
      "maxLength": 32,
      "pattern": "^[a-zA-Z0-9_]+$"
    },
    "password": {
      "type": "string",
      "writeOnly": true
    },
    "age": {
      "type": "number",
      "minimum": 0,
      "maximum": 200,
      "x-opt": "value"
    },
    "status": {
      "type": "string",
      "default": "active",
      "x-immutable": true,
      "x-countable": true,
      "x-reference": { "list": "userStatus" }
    },
    "orgId": {
      "type": "string",
      "format": "object-id",
      "x-reference": {
        "method": "org.search",
        "params": { "cols": { "_id": 1, "name": 1 } },
        "list"  : "list",
        "value" : "_id",
        "title" : "name"
      }
    },
    "createdAt": { "type": "string", "format": "date-time", "readOnly": true },
    "updatedAt": { "type": "string", "format": "date-time", "readOnly": true }
  },
  "x-references": {
    "userStatus": [
      { "value": "active", "title": "启用" },
      { "value": "frozen", "title": "冻结" },
      { "value": "closed", "title": "关闭" }
    ],
    "userRole": [
      { "value": "admin", "title": "管理员" },
      { "value": "user" , "title": "普通用户" }
    ]
  }
}
```

节点说明：

- **标准关键字**：`type` / `title` / `description` / `default` / `format` / `pattern` / `minLength` / `maxLength` / `minimum` / `maximum` / `minItems` / `maxItems` / `minProperties` / `maxProperties` / `items` / `properties` / `additionalProperties` / `required` / `readOnly` / `writeOnly`，语义与 JSON Schema 一致。
- **扩展关键字**：`x-immutable`（创建后不可改）、`x-countable`（可被 `counts()` 统计）、`x-reference`（引用数据来源）、`x-references`（引用数据列表，仅根节点）。
- **`required` 只在 object 节点上**：根节点及子文档节点用 `required: string[]`，字段节点自身不带 `required`。
- **`x-xxx`**：对应字段内的 `options`，所有 key 加上 'x-' 前缀。
- 数组与子文档递归展开：`[String]` → `items: { type: 'string' }`，`[SubDocument]` → `items: { type: 'object', properties: {...} }`，`Map` → `additionalProperties: { ... }`。

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
getCrud('user');           // → userCrud 实例（类型：Crud 接口）
getCrudNames();            // → ['user', ...]
```

`Cradle` 默认的 `callable`（可被外部调度的方法白名单）为：

```ts
callable = ['create', 'update', 'delete', 'search', 'counts', 'upsert', 'schema'];
```

子类可覆写 `callable` 来收紧或扩展，不在其中的方法即便权限符合也不会被调度。

### 3.2 注册 Func（全局函数）

```ts
import { regFunc, getFunc, hasFunc, getFuncNames } from 'hongs-crud';

regFunc('health.ping',     () => ({ ok: true, ts: Date.now() }));
regFunc('system.versions', () => ({ node: process.version }));
regFunc('org.search',  async () => {
  // 常见 reference 目标：返回 { items: [{_id, name}, ...] } 供下拉选项消费
  return { items: [{ _id: 'o1', name: '组织A' }, { _id: 'o2', name: '组织B' }] };
});
```

> 注意：上面 schema 例子中 `orgId.reference.method = 'org.search'` 就是指向这里注册的 Func。

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

// 以 RPC 调度函数举例
async function dispatch(req: RpcRequest, ctx: Context): Promise<RpcResponse> {
  const id = req.id ?? null;

  if (typeof req.method !== 'string') {
    return { jsonrpc: '2.0', error: {code: -32600, message: 'Invalid Request: method required!'}, id };
  }

  try {
    const result = await callFunc(req.method, req.params || {}, ctx);
    return { jsonrpc: '2.0', result, id };
  } catch (e: any) {
    if (e instanceof CrudError) {
      return { jsonrpc: '2.0', error: {code: e.code || -32603, message: e.message, data: e.data}, id };
    }
    return { jsonrpc: '2.0', error: {code: -32603, message: e?.message || 'Internal error!'}, id };
  }
}
```

错误 code 枚举：
```ts
enum CrudErrno {
  METHOD_MISSING = -32601,   // 方法缺失 / 不在 callable
  PARAMS_INVALID = -32602,   // 参数非法
  INTERNEL_ERROR = -32603,   // 内部错误
  LOGIN_REQUIRED = -32001,   // 需要登录
  RIGHT_DEPRIVED = -32003,   // 权限不足（isPermitted 拒绝）
  ALTER_REJECTED = -32009,   // 目标 id 不存在 / 非当前可变更的数据
}
```

---

## License

MIT
