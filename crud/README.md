# hongs-crud

一个基于 Mongoose Schema 的轻量 CRUD 封装，提供 `search / create / update / delete` 四个标准方法，以及 `counts / upsert / schema` 三个扩展方法，并内置 `crud / func / role` 三大注册器用于权限管控与统一调度。

源码：[](https://github.com/ihongs/HongsCRUD/tree/main/crud)

```bash
npm install hongs-crud
```

> 依赖（peer）：mongoose `^7 || ^8`

---

## 1. Schema 配置

`hongs-crud` 围绕标准 Mongoose `Schema` 展开，能力通过两种扩展叠加获得：

- **字段内部自定义选项**：`description` / `options` / `enumRef` / `dataRef` / `countable` 等。
- **扩展参数自定义选项**：`collection` / `softDelete` / `enums` / `limitDef` / `limitMax` 等。

下面是一个完整、简单的例子，包含所有扩展点：

```ts
import { Schema } from 'mongoose';

/* ---------- 枚举字典：放到 Schema options.enums 里，字段通过 enumRef 引用 ---------- */
const ENUMS = {
  userStatus: [
    { value: 'active', label: '启用' },
    { value: 'frozen', label: '冻结' },
    { value: 'closed', label: '关闭' },
  ],
  userRole: [
    { value: 'admin', label: '管理员' },
    { value: 'user', label: '普通用户' },
  ],
};

const userSchema = new Schema(
  /* ====================== 字段定义 ====================== */
  {
    username: {
      type: String,
      unique: true,
      required: true,
      maxlength: 32,
      description: '用户名',                          // 非 mongoose 保留字段，schema() 会原样透出
      options: { customOption: 3 },                  // 字段内自定义的公开选项（前端/AI 可直接消费）
    },
    password: {
      type: String,
      select: false,                                 // select: false 在 schema() 中会透出为 invisible: true
      required: true,
    },
    status: {
      type: String,
      default: 'active',
      enum: getValues(ENUMS.userStatus),             // mongoose 原生枚举验证
      enumRef: 'userStatus',                         // 1) 字符串，引用 enums[userStatus]
      // enumRef: { enumName: 'userStatus' },        // 2) 对象写法，当键值非默认时可写：
      // enumRef: { enumName: 'userStatus', valueKey: 'value', labelKey: 'label' },
      countable: true,
    },
    roles: {
      type: [String],
      default: ['user'],
      enumRef: 'userRole',
      countable: true,
    },
    orgId: {
      type: Schema.Types.ObjectId,
      dataRef: { method: 'org.options', valueKey: '_id', labelKey: 'name' },
    },
    // 软删除标记字段（见下 softDelete 扩展）
    isDeleted: { 
      type: Boolean,
      default: false,
    },
  },

  /* ====================== Schema 第二参数的 hongs-crud 扩展 ====================== */
  {
    collection: 'users',                 // 必填：集合名，同时用作 mongoose.model() 名称
    timestamps: true,                    // mongoose 原生：自动维护 createdAt / updatedAt
    softDelete: true,                    // 伪删除，使用 isDeleted 字段，还可用 { field: 'isDeleted', value: true, query: { $ne: true } }
    enums: ENUMS,                        // 枚举字典，字段通过 enumRef 引用
    limitDef : 20,                       // search() 默认 limit，未传时的默认值，默认 1；0 表示不限
    limitMax : 500,                      // search() limit 上限，超过抛 CrudErrno.PARAMS_INVALID，默认 1000；0 表示不限
  },
);
```

几个说明：

| 扩展点 | 归属 | 作用 |
|---|---|---|
| `options` | 字段内 | 自定义公开选项，AI 和前端可直接消费（表单渲染、校验等） |
| `enumRef` | 字段内 | 把字段关联到 `options.enums` 中的某个字典；可写字符串或 `{ enumName, valueKey?, labelKey? }` |
| `dataRef` | 字段内 | 声明该字段的值来源于某个已注册的 Func 或 Crud 方法；可写字符串或 `{ method, params?, valueKey?, labelKey? }` |
| `countable` | 字段内 | 写 `countable: true` 表示该字段可被 `counts()` 统计 |
| `description` | 字段内 | 字段说明文字，schema() 会原样透出 |
| `collection` | SchemaExtra | **必填**，集合名 |
| `softDelete` | SchemaExtra | 伪删除配置；启用后 search / update / delete 自动注入条件 |
| `enums` | SchemaExtra | 枚举字典（`Record<string, {value, label}[]>`） |
| `limitDef` | SchemaExtra | `search()` 默认 `limit`，默认 1，0 不限 |
| `limitMax` | SchemaExtra | `search()` `limit` 上限，默认 1000，0 不限，超过抛异常 `CrudErrno.PARAMS_INVALID` |

然后，`new Cradle(userSchema)` 即可获得 `create` / `update` / `delete` / `search` / `counts` / `import` / `schema` 能力。

---

## 2. 方法请求参数与返回结果

6 个方法的入参与返回都是纯 POJO，可直接 JSON 化；所有参数和结果都支持附加任意扩展字段。下面用最简单的举例说明每个方法的请求参数与返回数据。

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
{ count: 1 }
```

- `force: true` 时，不存在的 id 静默跳过；缺省则抛异常。
- `find` 可选，附加查询条件（做租户/归属隔离）。

### 2.3 delete

```ts
// 请求
{ id: '66b...a01' }

// 返回（硬删：删除条数；软删：被打标条数，重复打标计 0）
{ count: 1 }
```

### 2.4 search

```ts
// 请求
{
  id   : ['66b...a01'],               // 可单个或数组，用于获取详情
  find : { status: 'active' },        // 查询条件
  cols : { username: 1, status: 1 },  // 投影
  sort : { createdAt: -1 },           // 排序
  start: 0,                           // 跳过
  limit: 20,                          // 上限；缺省用 schema.limitDef，超过 limitMax 抛异常
  count: 'all',                       // 统计模式，见下
}

// 返回
{
  list: [{ _id: '66b...a01', username: 'alice', status: 'active' }, ...],
  count: 32,                          // 仅当传了 count 模式才有
}
```

`count` 模式：

| 值 | 返回 |
|---|---|
| 未传 | `{ list }` |
| `'all'` | `{ list, count }`（count = 总数） |
| `'next'` | `{ list, count }`（count = 0 / 1，是否有下一页） |
| `'only'` | `{ count }`（不要列表） |

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
  count: 35,                          // 应用 sels 已选条件后的总文档数
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
  list: [
    { name: 'alice', age: 20 },                       // 没 _id → 添加
    { _id: '66b...a01', name: 'alice', age: 21 },     // 有 _id 且存在 → 更新
    { _id: '66b...xxx', name: 'ghost' },              // 有 _id 但不存在 → 报错
  ],
}

// 返回
{
  created: 1,
  updated: 1,
  errors: [
    { index: 2, message: 'Item with _id "66b...xxx" not found' },
  ],
}
```

- `uks` 默认 `['_id']`：有 `_id` 就更新、没 `_id` 就添加；有 `_id` 但找不到记入 `errors`。
- `uks` 为其他字段（如 `['username']`）时：按 `uks` 查到则更新，查不到则添加（upsert 语义，不报错）。
- 校验失败的行：`errors` 项含 `message` + `errors`（字段级明细）；其他错误只记 `message`。

### 2.7 schema（扩展）

把 Mongoose Schema 转译为 `{ fields, enums }`，供前端渲染及 AI 编排。

```ts
// 请求
{ }

// 返回
{
  fields: {
    username: { type: 'String', required: true, description: '登录名' },
    password: { type: 'String', required: true, invisible: true },
    status: { type: 'String', default: 'active', countable: true, enumRef: 'userStatus' },
  },
  enums: {
    userStatus: [
      { value: 'active', label: '启用' },
      { value: 'frozen', label: '冻结' },
    ],
  },
}
```

`fields` 里每个字段可能透出：`type` / `default` / `required` / `immutable` / `invisible`（select:false 标记）/ `countable` / `description` / `enumRef` / `dataRef` / `options` 等。

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
