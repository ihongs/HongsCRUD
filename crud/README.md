# HongsCRUD

## 定位

`hongs-crud` 是 HongsCRUD 项目的核心包，负责将外部接口调用（RPC / MCP）与底层 Mongoose Schema 串联起来。围绕三条主线展开：**简化 CRUD**、**权限细分可控**、**暴露数据结构**。

### 1. 简化 CRUD

把"写一个数据接口"从「拼查询条件 + 处理分页 + 校验存在性 + 转换 ObjectId + 重复样板」压缩为「注册一个 `Crud` 实例」。

- **标准方法即开即用**：`schema` / `search` / `create` / `update` / `delete` 五个方法覆盖 90% 的数据访问需求，省去手写 controller。

  ```ts
  const userSchema = new Schema({ name: String, age: Number }, { collection: 'user' });
  regCrud('user', new Cradle(userSchema)); // 一行注册即获得全部 CRUD 能力
  ```

- **统一请求参数**：ObjectId 转换（`idAndFind`）、查询条件合并（`mergeFind`）、字段 / 排序 / 分页（`cols` / `sort` / `start` / `limit`）均在 `search` 内部完成，业务侧只传业务参数。

- **统计按需开关**：`search` 的 `count` 字段支持四种模式，避免无谓的 `countDocuments`：

  | `count` | 行为 |
  |---|---|
  | 未传 | 仅返回 `{ list }`，零统计成本 |
  | `'next'` | 用 `findOne().skip(start+limit)` 探测下一页更高效 |
  | `'only'` | 仅返回 `{ count }`，用于独立计数场景 |
  | `'all'` | 列表 + 总数一并返回 |

- **可操作校验**：`update` / `delete` 在写之前逐个检查，部分缺失时通过 `force: true` 决定「抛错」还是「跳过」，避免误操作与静默失败。

- **伪删除透明**：配置 `softDelete` 后，`del` 自动改写为「打标记」，`search` / `update` / `delete` 自动注入排除条件，业务代码完全无感。

- **可定制不重写**：内核方法 `add` / `put` / `del` 与标准方法解耦，子类覆盖 `search` 注入数据隔离、覆盖 `create` 补字段时，仍可复用 `super` 的查询/写入逻辑。

### 2. 权限细分可控

在「外部接口 → 数据库」之间架设一道统一的权限闸门，三层防线层层收紧：

```
外部调用
  │
  ▼
① callFunc 解析 name → FUNCS / CRUDS 中查找
  │
  ▼
② callable 白名单 ──► Crud 声明哪些方法可被外部调用（默认 4 个数据方法）
  │
  ▼
③ isPermitted ──► 校验当前用户角色是否拥有该 name 的执行权限
  │
  ▼
执行方法（业务层可再做细粒度校验，如 owner / 租户隔离）
```

- **角色 → 动作 集合扁平映射**：`regRole(role, acts)` 把角色登记为一组动作字符串，动作名即 `callFunc` 的 `name`，与代码组织方式天然对齐。

  ```ts
  regRole('admin', ['user.search', 'user.create', 'user.update', 'user.delete']);
  regRole('user',  ['user.search']);                  // 普通用户只能查
  regRole('guest',  ['health.ping', 'system.stats']); // 仅放行全局函数
  ```

- **`callable` 声明式白名单**：`Crud` 接口要求实现 `callable: string[]`，`Cradle` 默认 `['schema','search','create','update','delete']` —— 即使 `name` 解析成功，只要方法不在 `callable` 中就被拒。**这层防线与权限解耦**：决定"这个模型愿不愿意把这个方法暴露出去"，与"哪个用户能用"是两件事。

- **统一权限校验**：`callFunc` 在调用 `Func` 与 `Crud` 方法前都会用 `isPermitted(name, ctx.roles)` 校验，未通过抛 `CradleError(UNPERMITTED)`。两条调用通道（全局函数 / 模型方法）走同一套权限逻辑，无遗漏。

- **双通道覆盖**：

  | 通道 | 名称形式 | 用途 |
  |---|---|---|
  | Func | `health.ping` | 不绑定模型的工具方法（健康检查、统计、运维） |
  | Crud | `user.search` | 模型相关的数据方法（CRUD + 自定义业务方法） |

- **ctx 携带身份上下文**：`Context` 包含 `uid`、`roles`，可自由扩展（`tenant`、`ip`、`locale` 等），业务方法内可基于 `ctx` 做行级权限（如 `params.find.owner = ctx.uid` 实现数据隔离）。

- **可审计的错误码**：`CradleError` 用 JSON-RPC 风格错误码区分失败原因，调用方与上游网关可据此做差异化处理。

  | Code | 枚举 | 含义 |
  |---|---|---|
  | `-32001` | `UNPERMITTED` | 无权限调用 |
  | `-32601` | `UNCALLABLE` | 找不到目标方法（未注册 / 不在 callable） |
  | `-32602` | `UNOPERABLE` | 找不到目标数据（不存在或不可操作） |

### 3. 暴露数据结构

让数据库结构对调用方「可读、可消费、可生成」，而不是黑盒，以便 AI 及前端开发人员查阅。

- **`schema` 方法自省 Mongoose Schema**：遍历 `schema.paths`，把 Mongoose 内部的 `SchemaType` 转译为干净的 `{ fields, enums }` 结构，调用方无需依赖 mongoose 即可消费。

  ```ts
  // 一个 schema 即可生成结构化描述
  const { fields, enums } = crud.schema({ cols: { name: 1, age: 1 } }, ctx);
  ```

- **每个字段携带元信息**：`SchemaField` 不止有类型，还把校验规则、默认值、是否必填、是否不可变、枚举引用、外部引用一并暴露。

  | 字段属性 | 来源 | 用途 |
  |---|---|---|
  | `type` | Mongoose `instance` | 类型推断 |
  | `default` | `defaultValue` | 表单默认值、补全字段 |
  | `required` / `immutable` | schema 选项 | 表单必填、只读判定 |
  | `rules` | `min`/`max`/`minlength`/`maxlength`/`match` | 前端表单校验 |
  | `enumRef` | `enumRefs` + `enums` | 下拉选项绑定 |
  | `dataRef` | `dataRefs` | 外键关联描述（ref/fk/pk/find/sort/cols） |

- **cols 投影按需裁剪**：`schema({ cols: { name: 1, age: 1 } })` 即可只返回指定字段，与 `search` 的 `cols` 行为一致，适合"只取关心的字段"场景。

- **枚举字典独立输出**：`enums` 把字段引用的枚举值（含 `value` + `label`）单独打包返回，前端可直接渲染下拉框、AI 可直接理解可选值。

- **`dataRef` 描述关联关系**：声明字段引用其他模型（`ref`）、外键字段（`fk`）、显示主键（`pk`）、关联过滤（`find` / `sort` / `cols`），让 AI / 前端在不查数据库的前提下理解表间关系。

- **AI 友好的三大特性**：
  1. **结构化**：JSON 输出，无需解析注释或 .d.ts 即可消费；
  2. **自描述**：字段类型 + 校验规则 + 枚举 + 关联齐全，AI 可据此生成合法的 `create` / `search` 请求；
  3. **零依赖**：调用方拿到 `{ fields, enums }` 后无需 mongoose，AI Agent 在 MCP 等场景可直接基于 schema 编排查询。

- **开发人员友好**：可基于 `schema` 输出动态生成表单、API 文档、TypeScript 类型、Mock 数据，避免 schema 与文档/类型/表单的多处同步维护。

## 依赖

- [mongoose](https://mongoosejs.com/) `^7.0.0 || ^8.0.0`（peerDependency）

## 核心能力

### 三套注册器

| 注册器 | 注册 API | 查询 API | 判定 API | 说明 |
|---|---|---|---|---|
| Role | `regRole(role, acts)` | `getRole(role)` / `getRoleNames()` | `hasRole(role)` | 角色到「动作字符串集合」的映射 |
| Func | `regFunc(name, func)` | `getFunc(name)` / `getFuncNames()` | `hasFunc(name)` | 全局函数注册表 |
| Crud | `regCrud(name, crud)` | `getCrud(name)` / `getCrudNames()` | `hasCrud(name)` | 模型实例注册表 |

```ts
import { regRole, regFunc, regCrud, Cradle } from 'hongs-crud';
import { Schema } from 'mongoose';

// 1. 注册角色：admin 可执行 user.search / user.create 等
regRole('admin', ['user.search', 'user.create', 'user.update', 'user.delete']);
regRole('guest',  ['user.search']);

// 2. 注册全局函数
regFunc('health.ping', async () => ({ ok: true }));

// 3. 注册 Crud：实例化 Cradle 并登记模型名
const userSchema = new Schema(
  {
    name: String,
    age : Number,
  },
  {
    collection: 'user', // 必填，作为 mongoose.model 的名称
  }
);
regCrud('user', new Cradle(userSchema));
```

### Cradle 类

`Cradle` 实现 `Crud` 接口，构造时要求 `Schema` 已配置 `options.collection`。可选传入已编译的 `Model`，否则内部用 `mongoose.model(collection, schema)` 自动编译。

```ts
class Cradle implements Crud {
  callable = ['schema', 'search', 'create', 'update', 'delete'];

  constructor(schema: Schema, model?: Model<any>);

  // 标准方法（5 个，由 Crud 接口约束）
  schema(params: SchemaParams,  ctx: Context): SchemaResult;
  search(params: SearchParams,  ctx: Context): SearchResult;
  create(params: CreateParams,  ctx: Context): CreateResult;
  update(params: UpdateParams,  ctx: Context): UpdateResult;
  delete(params: DeleteParams,  ctx: Context): DeleteResult;

  // 内核方法（被标准方法复用，子类可按需调用）
  add(data): string;               // 新建，返回 _id
  put(id, data ): 0 | 1;           // 按 _id 更新，返回影响数量
  del(id, data?): 0 | 1;           // 按 _id 删除，返回影响数量

  // 元信息访问
  getSchema(): Schema;
  getModel (): Model<any>;
  getSoftDelete(): SoftDel | undefined;
  getSoftDeleteData(): Record<string, any> | undefined; // 写入用的伪删除值
  getSoftDeleteCond(): Record<string, any> | undefined; // 查询时排除已删除
}
```

### 调度入口 callFunc

`callFunc(name, params, ctx)` 是统一调度入口，按以下顺序解析 `name`：

1. 命中 `FUNCS` 全局函数 → 权限校验后执行
2. 解析 `crudName.funcName` 形式（含 `.`） → 命中 `CRUDS` 且 `funcName` 在 `crud.callable` 中 → 权限校验后调用 `crud[funcName](params, ctx)`
3. 都未命中 → 抛 `CrudErrorCode.UNCALLABLE`

权限校验统一使用 `isPermitted(auth, roles)`：只要用户任一角色对应的动作集合中包含 `name`，即视为放行。

```ts
import { callFunc } from 'hongs-crud';

// 调用 Crud 方法（"user.search"）
const result = await callFunc('user.search', {
  find: {},
  cols: { name: 1 },
  sort: { createdAt: -1 },
  start: 0,
  limit: 20,
}, { uid: 'u1', roles: ['admin'] });

// 调用全局函数（"health.ping"）
const pong = await callFunc('health.ping', {}, { roles: ['guest'] });
```

调度链路：

```
callFunc(name, params, ctx)
  │
  ├── FUNCS 命中 ──► isPermitted? ──► func(params, ctx)
  │                  └─ 否 ──► CrudErrorCode.UNPERMITTED
  │
  ├── "crudName.funcName" 命中 + 在 callable 中
  │     └─► isPermitted? ──► crud.funcName(params, ctx)
  │                        └─ 否 ──► CrudErrorCode.UNPERMITTED
  │
  └── 都未命中 ──► CrudErrorCode.UNCALLABLE
```

## 标准方法

每个 Crud 统一封装 5 个标准方法：

| 方法 | 入参 | 出参 |
|---|---|---|
| `schema` | `{ cols? }` | `{ fields, enums }` |
| `search` | `{ id?, find?, cols?, sort?, start?, limit?, count? }` | `{ list, count? }` 或 `{ count }` |
| `create` | `{ data }` | `{ id }` |
| `update` | `{ id, find?, data, force? }` | `{ count }` |
| `delete` | `{ id, find?, data?, force? }` | `{ count }` |

### search 的 count 模式

`count` 字段控制是否附带统计与统计方式：

| `count` | 行为 | 返回 |
|---|---|---|
| 未传 | 仅查询列表 | `{ list }` |
| `'only'` | 仅统计总数 | `{ count }` |
| `'next'` | 列表 + 是否有下一页（用 `findOne().skip(start+limit)` 探测，避免 `countDocuments`） | `{ list, count }`（`count` 为 0 / 1） |
| `'all'` | 列表 + 总数 | `{ list, count }` |

### update / delete 的存在性校验

`update` 与 `delete` 会逐个用 `id` + `find` 探测目标是否存在：

- 全部命中：正常执行，返回实际操作条数 `{ count }`
- 部分未命中且未传 `force: true`：抛 `CradleError(UNOPERABLE)`，并在 `data.ids` 中给出不可操作的 id 列表
- 部分未命中但 `force: true`：跳过未命中的，仅操作可命中的

### Schema 扩展选项

`Cradle` 通过 Mongoose `Schema.options` 上的扩展字段读取附加元信息，`schema` 方法会据此输出更丰富的结构：

| 选项 | 类型 | 用途 |
|---|---|---|
| `collection` | `string` | **必填**，作为 `mongoose.model` 名称 |
| `enums` | `Record<string, EnumItem[]>` | 枚举字典，可被字段通过 `enumRefs` 引用 |
| `enumRefs` | `Record<string, string>` | 字段名 → 枚举名，把字段关联到 `enums` 中的某项 |
| `dataRefs` | `Record<string, DataRef>` | 字段名 → 外部引用描述（`ref` / `fk` / `pk` / `find` / `sort` / `cols`） |
| `rules` | `Record<string, Record<string, any>>` | 字段名 → 校验规则（`min` / `max` / `minLength` / `maxLength` / `pattern` 等） |
| `softDelete` | `SoftDel` | 伪删除配置 |

`SchemaResult` 输出形如：

```ts
{
  fields: {
    id:   { type: 'ObjectId' },
    name: { type: 'String', required: true, rules: { maxLength: 32 } },
    type: { type: 'String', enumRef: 'userType' },
    orgId:{ type: 'ObjectId', dataRef: { ref: 'org', fk: '_id', pk: 'name' } },
  },
  enums: {
    userType: [
      { value: 'admin', label: '管理员' },
      { value: 'user', label: '用户' },
    ],
  },
}
```

### 伪删除 SoftDelete

配置 `softDelete` 后，`del` 改为「打标记」式更新，`search` / `delete` 也会自动注入排除条件：

```ts
const userSchema = new Schema({
  name: String,
  deletedAt: Date,
}, {
  collection: 'user',
  softDelete: {
    field: 'deletedAt',         // 标记字段
    value: () => new Date(),    // 删除时写入的值（默认 true）
    // query: { $ne: null },     // 可选，显式指定「未删除」的查询条件
  },
});
```

- `getSoftDeleteData()`：返回 `{ [field]: value }`，供 `del` 写入
- `getSoftDeleteCond()`：返回 `{ [field]: { $ne: value } }`（或显式 `query`），自动并入 `search` 等查询条件

## 自定义 Crud

继承 `Cradle` 即可注入业务逻辑：

```ts
import { Cradle, regCrud, CrudError, CrudErrorCode } from 'hongs-crud';

class UserCrud extends Cradle {
  // 覆写 search：注入数据隔离 + 复用父类查询
  search(params, ctx) {
    if (!ctx.uid) {
      throw new CrudError('login required', CrudErrorCode.UNPERMITTED);
    }
    params.find = { ...params.find, owner: ctx.uid };
    return super.search(params, ctx);
  }

  // 覆写 create：自动补充归属字段
  create(params, ctx) {
    params.data.owner = ctx.uid;
    return super.create(params, ctx);
  }

  // 追加自定义方法：需加入 callable 才能被 callFunc 放行
  callable = [...super.prototype.callable ?? [], 'resetPassword'];
  resetPassword(params, ctx) {
    // ...业务逻辑
  }
}

regCrud('user', new UserCrud(userSchema));
```

## 全局函数 Func

无需绑定模型的工具方法（如健康检查、系统统计）通过 `regFunc` 注册，按裸名调用：

```ts
import { regFunc } from 'hogns-crud';

regFunc('health.ping', () => ({ ok: true, ts: Date.now() }));
regFunc('system.stats', async () => ({ uptime: process.uptime() }));

// 调用：callFunc('health.ping', {}, ctx)
```

## 权限模型

权限基于「角色 → 动作集合」的扁平映射：

- `regRole(role, acts)`：登记角色及其全部可执行动作（动作名即 `callFunc` 的 `name`，如 `'user.search'`、`'health.ping'`）
- `isPermitted(auth, roles)`：判断用户的角色集合中，是否任一角色包含该 `auth`
- `callFunc` 在调用 `Func` 与 `Crud` 方法前都会自动校验权限，未通过抛 `UNPERMITTED`

## CradleError

统一错误类型，遵循 JSON-RPC 错误码约定：

| Code | 枚举 | 含义 |
|---|---|---|
| `-32001` | `UNPERMITTED` | 无权限调用 |
| `-32601` | `UNCALLABLE` | 找不到接口方法 |
| `-32602` | `UNOPERABLE` | 找不到目标数据（不存在或不可操作） |

```ts
class CradleError extends Error {
  constructor(message: string, code?: number, data?: Record<string, any>);
  code?: number;
  data?: Record<string, any>;
}
```

## 辅助函数

| 函数 | 用途 |
|---|---|
| `getValues(items, valueField?)` | 从 `EnumItem[]` 提取某字段的值数组 |
| `mergeFind(...conds)` | 合并多个 find 条件（单个直接返回，多个用 `$and`，空返回 `{}`） |
| `idAndFind(id, ...conds)` | 把 `id`（`string` 或 `string[]`）转为 ObjectId 查询并与 conds 合并 |
| `isPermitted(auth, roles)` | 权限判定 |
| `callFunc(name, params, ctx)` | 统一调度入口 |

## 安装

```bash
npm install hongs-crud
# 或
pnpm add hongs-crud
```

## License

MIT
