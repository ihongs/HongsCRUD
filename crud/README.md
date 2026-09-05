# hongs-crud

基于 Mongoose Schema 的 CRUD 封装，提供 `search / create / update / delete` 四个标准方法，以及 `statis / upsert / schema` 三个扩展方法，通过 schema 可返回 JSON Schema 规范的结构，以便前端和 AI 识别处理。

另含可选的检索组件 `Chaser`（从 `hongs-crud/es` 引入），把 `search` / `statis` 的查询执行搬到 ElasticSearch，采用与 MongoDB 一致的查询语法，提供更强的搜索及筛选能力，并在写入后自动同步索引，见第 4 节。

源码：[github.com/ihongs/HongsCRUD](https://github.com/ihongs/HongsCRUD/tree/main/crud)

```bash
npm install hongs-crud
```

> 依赖（peer）：mongoose `^7 || ^8`；`@elastic/elasticsearch` `^8`（可选，仅使用 ES 检索组件时需要）

---

## 1. Schema 配置

`hongs-crud` 围绕标准 Mongoose `Schema` 展开，能力通过两种扩展叠加获得：

- **字段内部自定义选项**：`title` / `description` / `writable` / `readable` / `countable` / `reference` / `enumTags` 等。
- **扩展参数自定义选项**：`title` / `description` / `collection` / `softDelete` / `limitDef` / `limitMax` 等。

下面是一个完整、简单的例子，包含所有扩展点：

```ts
import { Schema } from 'mongoose';

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
      readable: false,                               // → writeOnly，同 select（程序层面）
      required: true,
    },
    passsalt: {
      type: String,
      writable: false,                               // → readOnly，外部不可写（程序层面）
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
      countable: true,                               // → x-countable，可被 statis() 统计
      enum: ['active', 'frozen', 'closed'],          // mongoose 原生枚举验证，不透出
      enumTags: {                                    // → x-enum-tags，码值 → 标签
        active: '启用', frozen: '冻结', closed: '关闭',
      },
    },
    orgId: {
      type: Schema.Types.ObjectId,                   // → type: string, format: object-id
      reference: {                                   // 远程取数，search/statis 传 refs 时取回关联数据
        method     : 'org.search',                   // json-rpc 方法名（Func 或 CrudName.MethodName）
        params     : { cols: { _id: 1, name: 1 } },  // 附加参数
        refName    : 'org',                          // refs 聚集名，默认为字段名
        listKey    : 'list',                         // 返回结果中的列表键，默认 list
        idField    : '_id',                          // 关联项取值字段，默认 _id
        idParam    : 'id',                           // 查询参数名，默认 id
        description: '所属组织',                     // 关联说明
      },
    }
  },

  /* ====================== Schema 第二参数的 hongs-crud 扩展 ====================== */
  {
    collection: 'users',                 // 必填：集合名，同时用作 mongoose.model() 名称
    timestamps: true,                    // mongoose 原生：自动维护 createdAt / updatedAt
    softDelete: true,                    // 伪删除，等价于 { isDeleted: 'isDeleted', deletedAt: 'deletedAt', deleted: true, default: false }
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
| `writable` | 字段内 | 写 `writable: false` 表示外部不可写，透出为 `readOnly` |
| `readable` | 字段内 | 写 `readable: false` 表示预留的禁读声明，透出为 `writeOnly`；与 `writable` 同属程序层面预留的读写符号，`select` 则为 mongoose 原生投影控制 |
| `countable` | 字段内 | 写 `countable: true` 表示该字段可被 `statis()` 统计，透出为 `x-countable` |
| `reference` | 字段内 | 声明该字段的关联数据来源，透出为 `x-reference`；通过 `method` 远程调用，供 `refs` 取数，见 2.4 / 3.5 |
| `enumTags` | 字段内 | 枚举值 → 标签映射，透出为 `x-enum-tags`，与 `enum` 配套使用 |
| `collection` | Schema 扩展 | **必填**，集合名 |
| `softDelete` | Schema 扩展 | 伪删除配置；`true` 或 `{ isDeleted, deletedAt, deleted, default }`，启用后自动补字段，且 search / update / delete / statis 自动注入条件 |
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
| `readable: false` | `writeOnly` |
| `writable: false` | `readOnly` |
| `select or readable: false` + `writable: false` | 整个字段跳过，不透出 |
| `createdAt` / `updatedAt` | `readOnly`（ timestamps 自动维护） |
| `immutable: true` | `x-immutable` |
| `countable: true` | `x-countable` |
| `reference: { ... }` | `x-reference` |
| `enumTags: { ... }` | `x-enum-tags` |

然后，`new Cradle(userSchema)` 即可获得 `create` / `update` / `delete` / `search` / `statis` / `upsert` / `schema` 能力。

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

- `force: true` 时，不存在的 id 静默跳过；缺省则抛异常。
- `find` 可选，附加查询条件（做租户/归属隔离）。

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
  mode: '',                           // 列表模式，见下
  refs: true,                         // 关联数据：true 全部，或 {字段名: 1} 白名单，见下
}

// 返回
{
  list : [{ _id: '66b...a01', username: 'alice', status: 'active' }, ...],
  total: 32,
  refs : {                            // 传了 refs 且有外键时才有，见下
    'orgId': [{ _id: '66b...o01', name: '组织A' }, ...],
  },
}
```

`mode` 模式：

| 值 | 返回 |
|---|---|
| 未传 | `{ list, total }` |
| `'list-more'` | `{ list, more }` |
| `'only-list'` | `{ list }` |
| `'only-total'` | `{ total }` |

`refs` 关联数据：对结果 `list` 里声明了 `reference` 的字段，按聚集名 `reference.refName`（默认字段名）收集外键值（数组自动展开去重）——多个字段同指一个 refName（如工作单位所在地和毕业院校所在地都指向地区表）时，共享首个字段的 ref 配置（method、params 等），收集的外键值合并去重后一起查；各聚集名分别调 `reference.method`（经 `callFunc` 调度，需相应权限），返回 `{refName: [关联数据]}`（按外键查到的行数组，不建外键映射，映射由前端按需建立）。`refs` 传 `true` 全取，传对象时按字段名或 refName 命中：全为 `1` 是白名单，含 `0` 是黑名单，`undefined` / `null` 等同 `false` 不取（默认不取关联）。

### 2.5 statis（扩展）

对字段内声明了 `countable: true` 的字段做分组统计，常用于搜索页筛选器。

```ts
// 请求
{
  find: { status: 'active' },         // 基础过滤
  sels: { status: ['active'] },       // 联动已选；空数组视为没选
  tops: 10,                           // 每字段取前 N，默认 10；也可按字段 { status: 5 }
  refs: true,                         // 关联数据：true 全部，或 {字段名: 1} 白名单，规则同 search
}

// 返回
{
  total: 35,                          // 应用 sels 已选条件后的总文档数
  hits : {                            // 每字段 [{value, count}]，按 count 降序
    status: [{ value: 'active', count: 28 }, { value: 'frozen', count: 5 }, { value: 'closed', count: 2 }],
    roles : [{ value: 'user', count: 32 }, { value: 'admin', count: 3 }],
    orgId : [{ value: '66b...o01', count: 12 }],
  },
  refs : {                            // 传了 refs 且有外键时才有，规则同 search
    'orgId': [{ _id: '66b...o01', name: '组织A' }, ...],
  },
}
```

`sels` 联动规则：

- 任一非空数组转为 `$in` 并入总过滤条件，`total` 反映该条件下的总数。
- 已选字段不应用自己的 `sels` 条件（避免无法继续筛选该字段其他选项）。
- 其他字段应用所有 `sels` 条件，结果相互联动。

`hits` 桶结构：`value` 统一 `String()` 化（ObjectId / Date / 数字都可直接作键比对），字段缺失的文档记 `value: ''`；同 `count` 的桶顺序不保证稳定，按 `value` 对齐而非下标。

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

把 Mongoose Schema 转译为标准 **JSON Schema**（draft 2020-12），供前端渲染表单及 AI 编排。返回体本身就是 JSON Schema 根节点：`$schema` / `type: 'object'` / `title` / `description` / `required` / `properties` 都在顶层，`properties` 里才是具体字段。

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
      "maximum": 200
    },
    "status": {
      "type": "string",
      "default": "active",
      "x-immutable": true,
      "x-countable": true,
      "x-enum-tags": { "active": "启用", "frozen": "冻结", "closed": "关闭" }
    },
    "orgId": {
      "type": "string",
      "format": "object-id",
      "x-reference": {
        "method"     : "org.search",
        "params"     : { "cols": { "_id": 1, "name": 1 } },
        "refName"    : "org",
        "listKey"    : "list",
        "idField"    : "_id",
        "idParam"    : "id",
        "description": "所属组织"
      }
    },
    "createdAt": { "type": "string", "format": "date-time", "readOnly": true },
    "updatedAt": { "type": "string", "format": "date-time", "readOnly": true }
  }
}
```

节点说明：

- **标准关键字**：`type` / `title` / `description` / `default` / `format` / `pattern` / `minLength` / `maxLength` / `minimum` / `maximum` / `minItems` / `maxItems` / `minProperties` / `maxProperties` / `items` / `properties` / `additionalProperties` / `required` / `readOnly` / `writeOnly`，语义与 JSON Schema 一致。
- **扩展关键字**：`x-immutable`（创建后不可改）、`x-countable`（可被 `statis()` 统计）、`x-reference`（关联数据来源）、`x-enum-tags`（枚举值 → 标签映射）。
- **`required` 只在 object 节点上**：根节点及子文档节点用 `required: string[]`，字段节点自身不带 `required`。
- 数组与子文档递归展开：`[String]` → `items: { type: 'string' }`，`[SubDocument]` → `items: { type: 'object', properties: {...} }`，`Map` → `additionalProperties: { ... }`。

---

## 3. 注册器：crud / func / hook / role

四者都是扁平的全局注册表；`callFunc(name, params, ctx)` 会按「Func 名 → CrudName.MethodName」的顺序解析并执行，并对执行进行钩子包裹。

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
callable = ['create', 'update', 'delete', 'search', 'statis', 'upsert', 'schema'];
```

子类可覆写 `callable` 来收紧或扩展，不在其中的方法即便权限符合也不会被调度。

### 3.2 注册 Func（全局函数）

```ts
import { regFunc, getFunc, hasFunc, getFuncNames } from 'hongs-crud';

regFunc('health.ping',     () => ({ ok: true, ts: Date.now() }));
regFunc('system.versions', () => ({ node: process.version }));
regFunc('org.search',  async ({ id, cols }) => {
  // 常见 reference 目标：可接收 params { id: [外键值] }（refs 取数时传入），
  // 返回 { list: [{_id, name}, ...] } 供下拉选项与关联数据消费
  return { list: [{ _id: 'o1', name: '组织A' }, { _id: 'o2', name: '组织B' }] };
});
```

> 注意：上面 schema 例子中 `orgId.reference.method = 'org.search'` 就是指向这里注册的 Func。

### 3.3 注册 Hook（钩子函数）

```ts
import { regHook, hookPermits } from 'hongs-crud';

// !!! callFunc 不内置权限检查：不注册 hookPermits 则所有方法都不做权限检查
// !!! 务必第一个注册（最外层），缺省 name 即作用于全部调用
regHook(undefined, hookPermits);

// 先注册的在外层，包裹方法执行
// 第一参为 name：缺省（undefined/null/空串）时通配全部，字符串精确匹配，亦可用正则匹配
regHook('note.search', async (name, pms, ctx, next) => {
  pms.uid = ctx.uid;            // 输入干预：强制当前用户
  const res = await next(pms, ctx);
  res.list.pop();               // 输出干预：去掉最后一行
  return res;
});
```

说明：

- 执行顺序为：钩子链（按注册顺序由外到内）→ 方法执行（Func 查找 / CrudName.MethodName 调度）
- `name` 缺省（undefined/null/空串）时匹配全部方法，为字符串时精确匹配方法名，为正则时匹配方法名
- `next` 为 `Func` 签名，须显式传参：`next(params, ctx)` 原样放行；改写传入的对象（引用传递）即完成输入干预
- 钩子抛错即短路，调用方收到该异常；返回值即最终结果，可对 `next(params, ctx)` 的结果（多为 Promise）调整后返回

### 3.4 注册 Role（角色 → 动作集合）

```ts
import { regRole, hasRole, getRole, getRoleNames, isPermitted } from 'hongs-crud';

// 一个角色对应可执行「动作字符串」集合（Func 名 或 CrudName.MethodName）
regRole('admin', ['user.search', 'user.create', 'user.update', 'user.delete',
                  'user.statis', 'user.schema',
                  'health.ping', 'system.versions']);
regRole('user',  ['user.search', 'health.ping']);
regRole('guest', ['health.ping']);

// 单个判断：任一角色包含动作即放行
isPermitted('user.delete',   ['user']);   // → false
isPermitted('user.delete',   ['admin']);  // → true
isPermitted('health.ping',   ['guest']);  // → true
```

`acts` 参数可传 `string[]` 或 `Set<string>`。

### 3.5 统一调度入口 `callFunc`

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

## 4. ES 检索组件（Chaser）

`Chaser` 继承自 `Cradle`，在保留全部 CRUD 能力的基础上，把 `search` / `statis` 的查询执行搬到 Elasticsearch（全文检索、多条件过滤、聚合统计），并在写入后自动同步索引。适合数据量大、需要全文检索或复杂筛选联动的场景；mongo 始终是权威数据源，ES 只承担查询。

### 4.1 引入与初始化

从 subpath `hongs-crud/es` 引入，主入口 `hongs-crud` 不含 `es`：

```ts
import { Client } from '@elastic/elasticsearch';
import { Chaser, setEsClient } from 'hongs-crud/es';  // 注意：从 subpath 引入

const es = new Client({ node: 'http://127.0.0.1:9200' });

// 方式一：构造时注入（第二参 model 沿用 Cradle，第三参为 es 客户端）
const userCrud = new Chaser(userSchema, undefined, es);

// 方式二：注册全局默认客户端，构造时可省略 es
setEsClient(es);
const userCrud = new Chaser(userSchema);
```

用不到检索的项目无需安装 `@elastic/elasticsearch`，且安装 / 类型检查 / 打包三环节均不受影响：

| 环节 | 未装 ES 客户端且不用 `es` | 说明 |
|---|---|---|
| 安装 | 包管理器不告警 | ES 客户端在 peerDependencies 中标记为 optional |
| 类型检查 | 不报错，无需 `skipLibCheck` | subpath 隔离，不 `import 'hongs-crud/es'` 就不会加载其类型声明 |
| 打包 | 不报 `module not found`、无告警 | `es` 内对 ES 客户端只用 `import type`，产物零引用 |

类与全局客户端（同步选项与统计见 4.5）：

```ts
export class Chaser extends Cradle {
  constructor(schema: Schema, model?: Model<any>, es?: Client);

  getClient(): Client;                   // 未注入则取全局默认，缺失抛 CrudErrno.INTERNEL_ERROR
  getIndex (): string;                   // esIndex || collection

  /* ---------- mapping 与字段清单 ---------- */
  getMapping(): Record<string, any>;     // 入索引字段 -> ES mapping，含合并字段
  getSyncable(): Set<string>;            // 入索引字段名集合（含子文档点号路径）
  getTextable(): Set<string>;            // 并入全文的 textable 字段名集合
  getCountable(): Set<string>;           // 入索引 + countable 字段名集合
  getNestedPaths(): Set<string>;         // 声明了 nested 的字段路径集合

  /** 拼装全文内容，写入 esFullText 字段；默认按 getTextable() 取值拼接，子类可覆盖 */
  protected getFullText(doc: any): string;

  /* ---------- 直查 mongo：透传 Cradle 原实现 ---------- */
  rawSearch(params: SearchParams, ctx: Context): Promise<SearchResult>;
  rawStatis(params: StatisParams, ctx: Context): Promise<StatisResult>;

  /* ---------- 覆盖：读走 ES ---------- */
  search(params: SearchParams, ctx: Context): Promise<SearchResult>;
  statis(params: StatisParams, ctx: Context): Promise<StatisResult>;

  /* ---------- 覆盖：写后同步（esAutoSync，见 4.5） ---------- */
  add   (data: Record<string, any>): [ any, string ];
  set   (id : string, data: Record<string, any>): [ any, number ];
  putAll(ids: string[], data : Record<string, any>): number;
  delAll(ids: string[], data?: Record<string, any>): number;

  /* ---------- 索引与同步（见 4.5 / 4.6） ---------- */
  makeIndex(): Promise<void>;
  initIndex(): Promise<void>;
  dropIndex(): Promise<void>;
  pushMapping(): Promise<string[]>;
  syncDocs(docs: any[], opts?: SyncOpts): Promise<SyncStat>;
  syncDels(ids: string[], opts?: SyncOpts): Promise<SyncStat>;
  syncFind(find?: Record<string, any>, opts?: SyncFindOpts): Promise<SyncStat>;
  syncCull(opts : SyncCullOpts): Promise<SyncStat>;
}

/** 注册 / 读取全局默认 ES 客户端 */
export function setEsClient(client: Client): void;
export function getEsClient(): Client | undefined;
```

构造方法只在 `Cradle` 的 `model` 之后加一个 `es`，其余可调项（索引名、合并字段名、分词器、是否自动同步等）一律放在 Schema 扩展选项里，见下节。

### 4.2 Schema 扩展选项

```ts
const userSchema = new Schema({
  username: { type: String, textable: true },                  // 入全文，wd 可搜
  intro   : { type: String, textable: true, analyzer: 'ik_smart' },  // 可选，字段级分词器，覆盖 esAnalyzer
  remark  : { type: String },                                  // 进 ES 可单独精确查，默认不并入全文
  notes   : { type: String, syncable: false },                 // 不进 ES，find / wd / sort 均不可用
  passwd  : { type: String, select: false, syncable: false },  // select 只管显示，不入索引须显式关闭
  works   : { type: [workSchema], nested: true },              // 数组子文档，声明 nested 才保留元素关联
}, {
  collection : 'users',
  timestamps : true,
  esIndex    : 'crud_users',   // 可选，索引名，默认取 collection
  esFullText : 'fullText',     // 可选，合并搜索字段名，默认 fullText
  esSyncTime : 'syncTime',     // 可选，同步戳字段名，默认 syncTime
  esAnalyzer : 'ik_max_word',  // 可选，分词字段的默认分词器，默认不设（用 ES 的 standard）
  esAutoSync : true,           // 可选，写入后是否自动同步 ES，默认 true
  esSyncError: console.error,  // 可选，同步失败回调 (err, info) => void
});
```

Schema 扩展选项：

| 选项 | 默认 | 说明 |
|---|---|---|
| `esIndex` | `collection` | ES 索引名 |
| `esFullText` | `'fullText'` | 合并搜索字段名，`wd` 的查询目标 |
| `esSyncTime` | `'syncTime'` | 同步戳字段名，每次写入 ES 时置为当前时间，见 4.5 |
| `esAnalyzer` | 无（ES 的 `standard`） | 索引内所有分词字段（`textable` 的 `.text` 子字段与合并字段）的默认分词器，可被字段级 `analyzer` 覆盖 |
| `esAutoSync` | `true` | 写入（`add` / `set` / `putAll` / `delAll`）后是否自动同步 ES；`false` 则完全交给定时 `syncFind` |
| `esSyncError` | `console.error` | 同步失败回调 `(err, info) => void` |

字段扩展项：

| 扩展项 | 默认 | 说明 |
|---|---|---|
| `syncable` | `true` | 是否纳入 ES 索引；`false` 则该字段（容器字段则整棵子树）不进 ES，`find` / `wd` / `sort` 引用时抛 `CrudErrno.PARAMS_INVALID`，但不影响返回（文档一律回 mongo 取） |
| `textable` | `false` | String 是否附 `.text` 子字段（分词、并入全文，`wd` 可搜）；`false` 仍进索引、仍可单独 `find` / `sort`（主类型 keyword），供备注、日志这类无需全文的长文本使用 |
| `nested` | `false` | 数组子文档标 `nested: true` 才映射为 ES `nested`（保留元素关联），默认按扁平模式，见 4.4 |
| `analyzer` | 无 | 字段级分词器，覆盖 Schema 级 `esAnalyzer`；只对 `textable: true` 的 String 有效，标在其他字段上视为配置矛盾，构造时抛 `CrudErrno.INTERNEL_ERROR` |
| `termsize` | `256` | `textable` 字段 keyword 主字段的截断阈值（`ignore_above`）：超过的长串不进 keyword，等值匹配本就不可靠；`0` 不要 keyword 视角（主字段纯 text，只搜不精确匹配，省索引，等值 / 排序 / 聚合静默不命中不报错）；`-1` 不限长（超长串也能精确匹配）；仅对 `textable` 生效，改它需 `initIndex()` 重建 |

规则：

- **默认全同步**：Schema 中所有可映射字段一律纳入索引，仅 `syncable: false` 与不可映射类型（如 `Map`）不进。
- `select: false` 的字段**默认照常同步**：`select` 只管「能否显示」，不管「能否查询」；同步进 ES 后可查、可排序，但不会出现在返回中（`cols` 显式指定时可取出）。确实不该入索引的（如密码）显式加 `syncable: false`。
- `countable: true` 仍单独决定可否被 `statis()` 统计，但字段须先在索引内；与 `syncable: false` 并用视为配置矛盾，构造时抛 `CrudErrno.INTERNEL_ERROR`。
- 启用 `softDelete` 时，`isDeleted` / `deletedAt` 不入索引（ES 只留有效文档，见 4.4 / 4.5）；`timestamps` 的 `createdAt` / `updatedAt` 自动入索引，可直接排序与范围过滤。
- **`esFullText` / `esSyncTime` 是组件内部字段**，分别承担全文检索与同步水位，不可在 `find` / `sort` / `statis` 中引用（引用时同不可映射字段一样抛 `PARAMS_INVALID`）；与业务字段撞名时改 Schema 选项避开即可。

分词器：

- 两级配置、就近覆盖：Schema 选项 `esAnalyzer` 定索引默认，字段扩展项 `analyzer` 就近覆盖，都不设则不写 `analyzer`，由 ES 用 `standard`（中文按字切分，可满足基本包含式检索）。
- 组件不负责安装分词插件：配了 ES 未安装的分词器，建索引时由 ES 直接报错。
- `wd` 的分词只由合并字段（取 `esAnalyzer`）决定：`getFullText()` 拼进去的是原始文本，源字段各自的 `analyzer` 不影响 `wd`。
- **改分词器要重建索引**：已建索引的字段换 `analyzer` 会被 ES 拒绝，只能 `initIndex()` + `syncFind()`，见 4.6。

### 4.3 类型映射与全文检索

mongoose 到 ES mapping 的类型推导：

| Mongoose | ES mapping |
|---|---|
| `String` | `keyword`（主字段，`ignore_above: 256`，等值 / 排序 / 聚合走它）；标 `textable: true` 的附 `.text` 子字段（分词、并入全文），阈值由字段级 `termsize` 调整，`0` 无 keyword 视角、`-1` 不限 |
| `String` + `enum` | `keyword`（枚举值不做分词） |
| `Number` / `Schema.Types.Decimal128` | `double` |
| `Boolean` | `boolean` |
| `Date` | `date` |
| `Schema.Types.ObjectId` | `keyword` |
| `[X]` | 按元素类型推导（ES 数组与标量同 mapping） |
| 子文档（非数组） | `object`，递归推导 |
| `[SubSchema]` | 默认 `object` 扁平；标 `nested: true` 则 `nested` |
| `Map` | 不支持，一律跳过（键不可枚举，无法预生成 mapping），无需标 `syncable: false` |

- mapping 根级与所有 `object` / `nested` 容器一律 `dynamic: 'strict'`：未在 mapping 中声明的字段写入 ES 直接报错。`syncDocs` 按 mapping 裁剪字段，正常路径不会触发，它是防止 mapping 与代码脱节的安全网。
- 索引惰性建立：首次查询或同步前经 `makeIndex()` 检查索引是否存在（结果内存缓存），不存在则按 `getMapping()` 创建；已存在则不改动、不校验，避免误改线上索引。

合并字段（全文字段）与 `getFullText(doc)`：

```ts
/** 拼装全文内容，写入 esFullText 字段；子类可覆盖以追加标签等派生文本 */
protected getFullText(doc: any): string;
```

- `wd` 只查合并字段（默认 `fullText`）这一处，不做 `multi_match`；mapping 中显式定义它为 `{ type: 'text' }`，且 `_source` 排除该字段（倒排照建、能搜，但不占存储）。
- 默认实现按文本字段清单（`getTextable()`，即所有标 `textable: true` 的 String）逐个取值，扁平化数组、去空、去重后 `join(' ')`，效果与 `copy_to` 等价，但**不用 ES 的 `copy_to`**。
- 子类覆盖以追加码值标签、关联名称等派生文本（`copy_to` 只能拷字段原始值，`status: 1` 拷进去就是 `"1"`，搜不到「已发布」，这条路必须自行拼装）：

```ts
class UserChaser extends Chaser {
  protected getFullText(doc: any): string {
    return [
      super.getFullText(doc),            // 默认的文本字段拼接
      USER_STATUS[doc.status] || '',     // 码值 -> 标签，如 1 -> '已发布'
      doc.orgName || '',                 // 关联名称等派生文本
    ].filter(Boolean).join(' ');
  }
}
```

- 改 `getFullText` 的实现不涉及 mapping，**只需 `syncFind()` 重写一遍数据**即生效，无需重建索引；改某字段的 `textable` 会增删 `.text` 子字段（mapping 变更），须走 `initIndex()` 重建。

### 4.4 查询行为

`find` 保持 mongo 风格，内部翻译为 ES DSL，全部进 `filter` 上下文（不参与打分）；支持 `$eq` / `$ne` / `$gt` / `$gte` / `$lt` / `$lte` / `$in` / `$nin` / `$regex` / `$exists` / `$search` 与 `$and` / `$or` / `$not` 与字段等值（含 `null`），不认识的写法抛 `CrudErrno.PARAMS_INVALID`。其余约定：

- **只有 `id` 没有 `wd` / `find` 的请求直查 mongo**（内部走 `rawSearch`）：纯取详情无过滤无打分，ES 帮不上忙还多一趟回表；软删除过滤等语义与 mongo 版完全一致。
- **返回文档一律来自 mongo**：ES 查询只取 `_id` 与 `_score`，命中 id 回 mongo 取完整文档并按 ES 顺序重排，返回结构与 `Cradle.search` 完全一致；`cols` 交 mongo 处理，沿用 `Cradle` 的投影与 `select: false` 规则。条件、排序、分页、计数一概仍由 ES 完成。
- `refs` 参数与 mongo 版一致：关联数据由字段级 `reference` 经 `callFunc` 补充（见 3.5），`Cradle` / `Chaser` 行为相同。
- ES 命中但 mongo 已无（索引滞后 / 已硬删）的 id 直接跳过，不补位。
- `wd` 非空时追加 `match` 到合并字段参与打分，并把 `_score` 并入结果；`wd` 为空则整个查询不计分。
- **`$search`：字段级分词匹配**（mongo 社区版无此能力），符号对齐 mongo 的 `$text: { $search }`。仅 `textable: true` 的 String 可用，ES 侧翻译为 `match`（打 `.text` 子字段；`termsize: 0` 的纯 text 字段打主名），`operator: 'and'` 须全部分词命中；分词用字段自己的 `analyzer`，可与 `$and` / `$or` / `$not` 组合。如 `find: { body: { $search: 'hello world' } }` 要求 `body` 分词后 `hello` 与 `world` 同时命中；非 textable 字段或空串抛 `PARAMS_INVALID`。
- 排序、分页（`start` / `limit`）、四种 `mode` 模式与 mongo 版一致；深翻页（`search_after`）不在范围内，`start + limit` 超出 ES `max_result_window`（默认 10000）直接报错。
- **扁平模式的限制**：数组子文档未标 `nested: true` 时按 `object` 扁平索引，元素间的关联会丢失，跨字段的联合条件不保证落在同一元素。如 `find: { 'works.tag': 'a', 'works.qty': 9 }` 在扁平模式下会误命中「tag=a 与 qty=9 分属两个元素」的文档；要求同一元素同时满足时给该字段标 `nested: true`。
- `nested` 字段：查询条件自动按 path 归组合并进同一个 nested query（保证同元素语义），排序自动带 `nested: { path }` 与 `mode`（升序 `min`、降序 `max`），`statis` 统计自动内嵌 `reverse_nested` 回到父文档计数。
- 不加软删除条件：ES 里只有有效文档；「已伪删但 ES 尚未同步」的滞后命中由回 mongo 查询的软删除条件自然过滤（等同跳过）。

**自定义排序**：`getSort` 为 `protected`，负责把外部 `sort` 翻译为 ES sort 数组（数组序即多级排序优先级），重写它可接入脚本排序。如约定虚拟字段 `vFieldx` 表示按 `field1 * 0.8 + field2 * 0.5` 加权排序：

```ts
class MyChaser extends Chaser {
  protected getSort(sort: Record<string, 1 | -1>): Record<string, any>[] {
    const out: Record<string, any>[] = [];
    for (const [field, dir] of Object.entries(sort)) {  // 按传入顺序落位，虚拟字段在中间就落中间
      if (field === 'vFieldx') {
        out.push({ _script: {
          type  : 'number',
          script: {
            // doc values 缺值须兜底，否则 painless 直接抛错
            source: `(doc['field1'].size() > 0 ? doc['field1'].value : 0) * 0.8`
               + ` + (doc['field2'].size() > 0 ? doc['field2'].value : 0) * 0.5`,
          },
          order  : dir === -1 ? 'desc' : 'asc',
          missing: '_last',
        } });
      } else {
        out.push(...super.getSort({ [field]: dir }));    // 逐字段复用原翻译与校验
      }
    }
    if (out.length) out.push({ _doc: 'asc' });           // 并列兜底，保证分页翻页稳定
    return out;
  }
}
```

- 调用侧无感：`search({ sort: { vFieldx: -1 } })`，可与真实字段混用，优先级即传入顺序。
- 脚本引用的字段必须已入索引（`syncable` 非 false 且有 doc values）；虚拟字段名被剥离，不参与 `_leaves` 校验。
- `_script` 逐文档计算、无法利用索引序，数据量大时建议物化：重写 `esDoc()` 算好加权值存成真实字段（mapping 同步声明），`getSort` 走普通排序。传了 `sort` 即不再按 `_score` 排，但 `_score` 仍并入返回文档。

### 4.5 同步

写入自动同步（`esAutoSync` 默认 `true`）：

- `add` / `set` / `putAll` / `delAll` 在 mongo 写入成功后同步 ES；`setAll` / `create` / `update` / `upsert` 内部落到这些方法，自动获得同步。
- **删除无视 `softDelete`**：ES 侧一律物理删除，索引中只保留有效文档。
- ES 同步失败**不回滚、不影响写方法的返回值**（mongo 是权威数据源），仅按 Schema 选项 `esSyncError` 告警。
- `esAutoSync: false` 时写入不触 ES，改由定时 `syncFind` 分批补齐；建议配合 `softDelete` 使用——未启用 `softDelete` 时硬删的记录定时任务无从发现，只能靠低频的全量 `syncFind()` 兜底。

手动与定时同步：

```ts
// 直接同步文档（数组），唯一的 ES 写入出口；伪删文档自动转为删除动作
await userCrud.syncDocs([ doc1, doc2 ], { refresh: 'wait_for' });

// 按 id 批量删除
await userCrud.syncDels([ '66b...a01', '66b...a02' ]);

// 只同步某机构下的数据
await userCrud.syncFind({ orgId: '66b...a01' });

// 每天同步「最近 25 小时」的变更，相邻两天有 1 小时重叠，消除时间误差与临界遗漏
await userCrud.syncFind({ updatedAt: { $gte: new Date(Date.now() - 25 * 3600e3) } });

// 全量刷新：扫 mongo 全量覆盖 ES，收尾按同步戳水位清掉孤立记录，无空窗
await userCrud.syncFind();

// 只清理不刷新（明确知道水位时；since 必传，且须早于最近一次全量同步的开始时间）
await userCrud.syncCull({ since: lastSyncStartAt });

// 索引管理：makeIndex 确保存在（幂等，已存在不动）、initIndex 删后重建（改类型 / 分词用，有空窗）、
// dropIndex 删索引、pushMapping 增量推送 mapping
await userCrud.makeIndex();
await userCrud.initIndex();
await userCrud.dropIndex();
await userCrud.pushMapping();
```

同步选项与返回：

```ts
interface SyncOpts {                       // 同步公共选项
  refresh?: boolean | 'wait_for';          // 默认 false；写后即读传 'wait_for'
}
interface SyncFindOpts extends SyncOpts {
  batch?: number;                          // 每批文档数，默认 1000
}
interface SyncCullOpts extends SyncOpts {
  since : Date;                            // 水位，删除同步戳早于此时间的文档，必传
}
interface SyncStat {
  total  : number;                         // 扫描到的文档数
  indexed: number;                         // 成功写入数
  deleted: number;                         // 删除数
  failed : number;                         // 失败数
  errors : any[];                          // 失败明细（截断保留前 N 条）
}
```

同步规则：

- 查询同步用 mongo 游标逐个取、攒批（每批 `batch` 条）一次 bulk 提交，文档量大时内存可控；重复同步幂等（`index` 按 `_id` 整体覆盖，`delete` 对不存在的 id 不报错），重叠区间安全。
- 全量 `syncFind()` 先记水位 T，扫完全量后补一次 `syncCull({ since: T })`，把「ES 里有、mongo 里已无」的孤立记录清掉，一趟完成补齐与清理且无空窗（不需要先清空索引）；失败数不为 0 时跳过收尾清理，以免误删同步失败的文档。
- 单独调 `syncCull` 必须传 `since`，且该时刻要早于最近一次覆盖全量的同步的开始时间，否则会删掉正常数据；不提供默认值就是为了避免误用。
- 增量同步依赖 `timestamps` 的 `updatedAt` 做水位，条件由调用方自行拼；Schema 未启用 `timestamps` 时只能全量。
- 全量 `syncFind()` 成本远高于增量（扫 mongo 全量并重写整个索引），百万级可每天跑、千万级建议低峰期每天一次、亿级建议每周或按段切分；不要与增量同步混在一个定时任务里。
- 不引入队列与重试机制：失败明细记入 `SyncStat.errors`，由下一次定时 `syncFind` 自然补偿。

### 4.6 Schema 变更后的索引维护

ES 的硬约束决定了各类变更不能一概而论：

| 变更 | 处理方式 |
|---|---|
| 新增字段 | `pushMapping()` + `syncFind()` 回填，无空窗 |
| 删除字段（或改标 `syncable: false`） | 只需 `syncFind()` 覆盖旧值；mapping 定义删不掉但留着无害 |
| 改 `getFullText` 实现 | 只需 `syncFind()` 重写一遍数据（改 `textable` / `termsize` 属于 mapping 变更，走下一行） |
| 改已有字段类型 / 分词 / `textable` / `termsize` | 只能 `initIndex()` + `syncFind()` 重建（有空窗） |

标准操作序列（全程无空窗、可重复执行、中断重跑即可）：

```ts
// 1. 推增量 mapping：与索引现有 mapping 做 diff，只补新增字段，不动既有定义
await userCrud.pushMapping();

// 2. 全量刷新：既回填新字段，又覆盖掉已删字段的旧值，同时清掉孤立记录
await userCrud.syncFind();
```

> 注意：已存在的索引不会被 `Chaser` 自动改动，改过 Schema 后必须显式走上述流程，否则新字段查不到且没有任何报错。`pushMapping()` 必须由本方法推送而非手写 mapping：`keyword` 子字段、nested 结构、`dynamic: 'strict'` 等推导规则都在 `getMapping()` 里，手写极易与索引内的既有定义不一致。

---

## License

MIT
