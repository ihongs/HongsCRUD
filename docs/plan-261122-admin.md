# crud-admin 管理后台开发计划（Vue 3 + Bootstrap 5）

> 状态：**已实施 P0–P3（构建通过，已做端到端联调）**。发布时按 §8 将 `crud-admin/dist` 放入线上 static 的 `/admin` 目录。
>
> 范围：新增前端子项目 `crud-admin`（Vue + Bootstrap 最新稳定版）+ `crud-api` 侧最小改动（管理员登录权限门、权限快照、角色对齐）。
>
> 关联：[plan-260818-login.md](file:///d:/Workspace/HongsCRUD/docs/plan-260818-login.md)（其中 `verify.challenge` 已被当前代码改为 `auth.chall`，本文一律以当前代码为准）。

---

## 1. 目标与非目标

### 目标

1. 新增 `crud-admin/` 前端：概览首页、管理员登录、用户管理、自己的 API Key 管理、个人资料。
2. **只有具备 admin 权限的用户能进入后台**：判定条件是 `isPermitted('admin', roles)`，**不判断角色名**（不是 `roles.includes('root')`）。
3. 用户管理列表展示：头像、用户名、姓名、角色（roles）、邮箱、手机、创建时间；支持搜索（`name/username/phone/email` 复合 text 索引）、分页、新建、资料编辑、停用（复用 `user.delete` 软删除）。
4. 用户可管理自己的 API Key（`mineApiKey.*`）：创建时展示并可复制完整 key（**之后任何列表/查询都不再返回 key**），删除、查看过期时间。
5. 复用现有 `auth.chall` / `auth.login` / `auth.refresh` / `auth.logout` 与 PoW 机制，不引入新认证体系。
6. **方法最小化**：数据操作只用现有 `search / create / update / delete / statis`；仅新增 `auth.permits`（当前用户权限表查询，不涉及数据模型）。

### 非目标（本期不做）

- ❌ 角色/权限的可视化配置（后台只做“按已有角色分配”，不编辑角色→动作矩阵）。
- ❌ 硬删除；停用即软删除，**不提供回收站/恢复**（日后需要时给 `user.search` / `user.update` 加参数实现）。
- ❌ 新增 `recycle` / `restore` / `overview` / `session` 等自定义方法。
- ❌ 操作审计日志、登录失败计数、按设备维度的会话管理（改密只统一吊销该用户 refresh）。
- ❌ 多租户、数据权限（行级）。
- ❌ 注册接口。
- ❌ 服务端渲染（SSR）。

---

## 2. 现状核对（与计划直接相关的代码事实）

| 事实 | 位置 |
|---|---|
| PoW 出题/校验：`issueChallenge(objective)` / `checkChallenge(objective, challenge, nonce)`，objective 为 `auth:<username>`，一次性消费用 kv.add | [challenge.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/utils/challenge.ts#L39-L85) |
| 登录 func：`auth.chall` 出题；`auth.login` 从 `params.chall = {challenge, nonce}` 取参，并已支持 `scene` 参数 | [auth.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/funcs/auth.ts#L163-L237) |
| 登录内部：`resolveUserCtx` 解析 `sk-` / JWT；`loadUserRoles(uid)` 从 DB 取 `roles` | [auth.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/funcs/auth.ts#L113-L161) |
| 角色注册：`anon` / `user` / `root`；`user` 含 `guest`（客户用户组），`root` 含 `admin`（管理用户组/后台准入）与 `admin-all`（数据范围） | [roles.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/roles.ts#L3-L21) |
| 权限判定：`isPermitted(name, roles)` 精确匹配角色动作集合；`hookPermits` 在 roles 为空时回退 `['anon']` | [crud/src/index.ts](file:///d:/Workspace/HongsCRUD/crud/src/index.ts#L678-L700) |
| `user` schema：`username/password/passsalt/name/avatar/email/phone/roles`，`softDelete: true`；**password/passsalt 未设 `select:false`**；当前只有 `username` unique、`email/phone` 普通索引，**无 text 索引** | [user.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/user.ts#L7-L23) |
| `User` 只重写了 `add/set` 做密码哈希，未覆盖 `search`；`Mine.search` 才手动剔除 password/passsalt | [user.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/user.ts#L25-L43) / [mine.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/mine.ts#L53-L73) |
| `mineApiKey`：`userId` 限定本人、`app='sk'`；`create` 返回新 key，`search` 返回含完整 key 的行 | [mine.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/mine.ts#L92-L157) |
| `wd` 走 Mongo `$text`，需要集合有 text 索引；本期给 user 增加 `username/name/phone/email` 复合 text 索引 | [crud/src/index.ts](file:///d:/Workspace/HongsCRUD/crud/src/index.ts#L924-L948) |
| 软删除：`isDeleted` 由插件加为 `select:false + writable:false`，`search` 自动注入 `isDeleted != true`，外部不可列出已删用户 | [crud/src/index.ts](file:///d:/Workspace/HongsCRUD/crud/src/index.ts#L1123-L1154) |
| `init-admin` 已改为写入 `roles: ['root']`；root 现有动作已覆盖后台所需（`admin` / `admin-all` / `user.*` / `mine.*` / `upload.config`） | [init-admin.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/scripts/init-admin.ts#L34-L50) |
| 静态服务：非 `/api` 的 GET 映射到 `crud-api/static/`，目录回落 `index.html`，但**无 SPA history 回落** | [static.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/api/static.ts#L59-L113) |
| RPC：始终 HTTP 200，错误通过 JSON-RPC `error.code` 表达；错误码 `LOGIN_REQUIRED=-32001` / `RIGHT_DEPRIVED=-32003` / `PARAMS_INVALID=-32602` | [rpc.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/api/rpc.ts#L28-L44) |

### 由此确认的 1 个必须先处理的问题

1. **密码哈希可能泄漏**：`user.search` 未剔除 `password/passsalt`（白名单 `cols` 显式点名可取出）。计划给 schema 加 `select:false`，并在 `User` 覆盖 `search` 强制剔除。

> `auth.login` 的 scene 已就绪：查询已 `select` 包含 `roles`，scene 判定放在密码校验之前——语义上等于“该账号不在这个 scene 里”，与“用户不存在”同义，不额外区分。停用直接复用 `user.delete`（软删除），本期不提供恢复。关键词搜索给 user 加 `username/name/phone/email` 复合 text 索引，前端统一传 `wd`，由 `User.search` 内部判断改写（见 D7）。

---

## 3. 设计决策

- **D1 准入 = 权限，不是角色名**：后台准入用已有的 `admin` 权限动作（commit 123cc20 已授予 root）。登录成功后，用 `isPermitted('admin', roles)`（roles 从 DB 实时读取）判定；任何角色只要被授予该动作即可进后台。代码中**不出现** `roles.includes('root')` 之类判断。`admin-all` 是另一个维度：表示“可管理所有数据”，用于后续 user 等角色“仅能操作自己的数据”时的范围判断，不参与后台准入。
- **D2 复用 `auth.login` 的 scene，不新增方法**：后台登录传 `scene:'admin'`，服务端用 `isPermitted('admin', roles)` 提前拦截；不通过时 reason 与“用户不存在”统一为 `bad_credentials`（`-32602`），前端无法区分。scene 只影响登录体验，不是安全边界；登录后的每个方法仍由 `hookPermits` 按 `ctx.roles` 校验。
- **D3 双保险**：scene 只是入口提示；后台实际调用的 `user.*` / `mine.*` / `mineApiKey.*` / `upload.config` 仍逐方法校验。即使绕过 scene 登录成功，没有对应动作也调不动。
- **D4 权限快照走 `auth.permits`**：登录后调 `auth.permits { methods }`，服务端用 `getRole` 取用户各角色的动作并集，返回 `permits` 数组（methods 与动作的交集）。前端 `config/features.ts` 维护“功能点 → 方法数组”的或关系，菜单/按钮据此显隐；后端仍是最终裁决。
- **D5 前端技术栈固定**：Vue 3 + Bootstrap 5，均安装 **npm 最新稳定版**并由 `package-lock.json` 锁定；构建用 Vite + TypeScript。**不使用 `bootstrap-vue-next`**（其版本滞后于 Bootstrap），直接使用 Bootstrap 原生 CSS + JS bundle（无 jQuery）。
- **D6 哈希路由**：`createWebHashHistory()`，产物按 `/admin` 前缀放入 static 目录，访问 `/admin/#/users`，无需给静态服务加 SPA history 回落。
- **D7 关键词搜索在 `User.search` 内部消化**：user schema 增加复合 text 索引 `{ username, name, phone, email }`；前端一律只传 `wd`。`User.search` 覆写里先判断 `wd`：不含 CJK 时保持 `wd` 走 text 索引；含 CJK 时把 `wd` 转成 `find.$or + $regex`（正则元字符转义）并与调用方已有的 `find` 合并，同时清空 `wd`。这样前端无需关心索引细节，后续若有需要再考虑在 crud 核心提供 schema 级配置（如 `textFields`）自动处理。
- **D8 令牌存储（安全优先）**：access token 只放内存（Pinia）；refresh token 只放 `sessionStorage`，**不提供“记住登录”**，关闭标签页/浏览器即退出。启动时用 refresh 换新 access，再调 `mine.search` 校验并取最新 roles。
- **D9 复用现有 `auth.refresh` 轮换**：前端必须做**单飞**刷新（并发 401 只触发一次刷新），否则轮换会让其余请求用旧 refresh 失败。
- **D10 停用 = 软删除**：直接调现有 `user.delete`，不新增状态字段与恢复方法。停用后 `loadUserRoles` 过滤 `isDeleted`（roles 为空 → 所有业务调用被拒），同时删除该用户 `app='rt'`。回收站/恢复本期不做，日后给 `user.search` / `user.update` 加参数实现。
- **D11 API Key 一次性展示**：`mineApiKey.create` 返回完整 key；`mineApiKey.search` 覆写强制剔除 `key` 字段，之后任何查询都不返回，前端列表只显示名称/时间/状态。
- **D12 用户组靠权限位区分**：`admin` 表示“管理用户组”（后台准入），`guest` 表示“客户用户组”，`admin-all` 表示“可管理所有数据”。三者都是权限位，不靠角色名判断；`admin` 与 `guest` **独立判断、允许重叠**（同一账号可同时计入管理员和客户）。
- **D13 方法最小化**：`api/rpc` 是数据模型的标准暴露层，默认只提供 `search / create / update / delete / statis / schema`。**新增方法仅 `auth.permits`**（权限查询，不是数据 CRUD）；其余概览统计、权限判断等用现有方法组合或一次 `auth.permits`。日后确需新方法时，必须说明性能或逻辑复杂度原因并单独评估。
- **D14 前台错误模糊化**：给用户看的文案刻意合并（如“账号不存在、密码错误或无权访问后台”“操作失败或无权限”），不暴露具体原因；完整错误（code / message / data.reason）统一 `console.error` 输出，便于开发调试。日志只打印错误对象，**不打印请求参数**，避免密码等敏感信息进入控制台。

---

## 4. 权限模型

### 4.1 权限位（与角色解耦）

```
admin              // 管理用户组（后台准入）
guest              // 客户用户组（普通用户）
admin-all          // 可管理所有数据（数据范围判断；不用于方法放行）
```

后台所需的数据操作全部复用现有方法，仅新增权限查询动作 `auth.permits`：

```
auth.permits
upload.config
mine.search / mine.update
mineApiKey.search / mineApiKey.create / mineApiKey.delete
user.search / user.create / user.update / user.delete / user.schema
```

`root` / `user` 增加 `auth.permits`；其余动作均保持现状。

### 4.2 角色矩阵（现状，全部不变）

| 角色 | 动作 |
|---|---|
| `anon` | 现有 `auth.*`（含 `auth.login`） |
| `user` | 现有动作 + `auth.permits`（含 `guest`、`mine.*`、`mineApiKey.*`、`upload.config`） |
| `root` | 现有动作 + `auth.permits`（含 `admin` / `admin-all`、`user.*`、`mine.*`、`mineApiKey.*`、`upload.config`） |

> 不新增 `admin` 角色：管理员账号使用 `root`（`init-admin` 已改为 `roles: ['root']`）。
>
> `guest` 授予 `user` 角色（客户用户组），`admin` 授予 `root`（管理用户组）；两者都是权限位，不是角色名。

> `auth.login` 已在 `anon` 动作中；`auth.permits` 只授予已登录的 `user` / `root`。

### 4.3 准入判定（走现有 `auth.login`）

```
auth.login（scene = 'admin'）:
  1. 校验 challenge + nonce
  2. 查用户（select 已包含 roles）
  3. if (scene && !isPermitted(scene, roles)) throw CrudError(-32602, { reason: 'bad_credentials' })
  4. 校验密码
  5. 签发 access + 写 refresh
```

- scene 判定在密码之前，失败 reason 统一为 `bad_credentials`：与“用户不存在”完全一致，外部无法区分“账号不存在 / 密码错 / 无该 scene 权限”。
- 未传 scene：照常登录（普通业务路径）；scene 传其他值：按该值做一次 isPermitted 预检，仅影响登录返回。
- 无论 scene 如何，登录后的方法权限仍由 `hookPermits` 按 `ctx.roles` 决定。

---

## 5. 后端改动（文件级）

### 5.1 `crud-api/src/funcs/auth.ts`

- `auth.login` 的 scene 已就绪：`select` 已含 `roles`，判定在密码校验前（语义=该 scene 下用户不存在），**无需改动**。
- `loadUserRoles(uid)` 改为 `findOne({ _id: uid, isDeleted: { $ne: true } }).select('roles')`：停用/删除后的用户 roles 为空，旧 access token 立即失去所有业务权限（`ctx.roles = []` 不会回退 `anon`）。
- 不拆分登录流程、不新增导出函数：scene 逻辑在 `authLogin` 内部完成即可。

### 5.2 新增 `auth.permits`（唯一的权限查询方法）

- 参数：`{ methods: string[] }`。
- 返回：`{ permits: string[] }`；用 `getRole` 取用户所有角色的动作并集，只返回与入参 methods 的交集（顺序同入参、去重）。
- 不在角色动作里的方法不返回，前端按不可用处理。
- 要求已登录，`anon` 角色不授予该动作。
- 其余操作全部用现有 CRUD 方法组合，不新建文件/方法。

### 5.3 `crud-api/src/roles.ts`

- `user` / `root` 增加 `auth.permits`；其余不变。

### 5.4 `crud-api/src/funcs/index.ts`

- **无改动**。

### 5.5 `crud-api/src/cruds/user.ts`

- `password`、`passsalt` 字段加 `select: false`（`auth.login` 已显式 `+password +passsalt`，不受影响）。
- `User` 覆盖 `search(params, ctx)`，只做一件事：
  1. **秘密字段剔除**：强制排除 `password/passsalt`（白名单模式从 `cols` 删除，删空后退化为黑名单），确保任何角色都无法通过 `user.search` 取到哈希。
- **关键词搜索**：前端只传 `wd`，由底层走复合 text 索引；不再做中文正则回退（Mongo text 对中文不分词，先凑合用，后续需要再上 ES）。
- **新增复合 text 索引**：`userSchema.index({ username: 'text', name: 'text', phone: 'text', email: 'text' })`。
  - 保留现有 `username` unique 索引与 `email/phone` 普通索引；一个集合只允许一个 text 索引，这几项合并为一个复合索引。
  - 开发环境由 mongoose `autoIndex` 自动建；生产需执行一次 `syncIndexes()`（或等价的建索引脚本），否则 `wd` 会因缺少 text 索引报错。
- **密码写入语义（资料编辑用）**：
  - `password` 非空 → 照旧生成新 salt 并 pbkdf2 哈希（`User.set` 现有逻辑）。
  - `password === ''` → 视为“清空密码”：不哈希，并同时清空 `passsalt`（避免残留旧盐），该账号此后不能密码登录（仍可用 API Key）。
  - 不传 `password` → 保持不变（现行为）。
- **改密/清空密码后吊销会话**：`User.set` 成功更新且本次写入了 `password` 时，追加 `userApiKey.getModel().deleteMany({ userId, app: 'rt' })`，一次 DB 操作即可；`init-admin` 重置密码同样生效。**不吊销 `app='sk'`**（sk 面向 AI/特殊客户端，与登录会话不是一层，已定）。
- **停用即失效**：`User` 覆写 `del`（软删除）：删除成功后追加 `deleteMany({ userId, app: 'rt' })`；配合 §5.1 的 `loadUserRoles` 过滤，停用用户的旧 access 也立刻无权限。
- 建议同时给 user schema 加 `limitDef: 20`（当前默认 1，容易误解；后台会显式传 limit，但默认值更合理）。

### 5.6 `crud-api/src/scripts/init-admin.ts`

- 保持已改好的 `roles: ['root']`，无需再注册 `admin` 角色；同时把第 36 行注释里的“admin 角色”改为“root 角色”，避免误导。

### 5.7 `crud-api/src/cruds/mine.ts`

- `MineApiKey.search` 覆写：强制剔除 `key` 字段（白名单模式从 `cols` 删除，删空后退化为黑名单），与 `Mine.search` 处理 password 的方式一致。
- 保持 `create` 返回完整 key（仅此一次可见）；列表/详情任何情况下都不再返回 key。

### 5.8 不改动

- `crud/` 核心库（零修改）。
- `challenge.ts`、`api/rpc.ts`、`api/upload.ts`、`api/sse.ts`。

### 5.9 接口示例

```jsonc
// 后台登录：复用 auth.login，scene='admin'
{"jsonrpc":"2.0","method":"auth.login","params":{
  "username":"admin","password":"xxxxxx","scene":"admin",
  "chall":{"challenge":"<auth.chall 返回>","nonce":"<PoW 解>"}
},"id":1}
// 成功（结构不变）
{"jsonrpc":"2.0","result":{
  "accessToken":"eyJ...","accessExp":1755560900000,
  "refreshToken":"rt-...","refreshExp":1787110000000,
  "user":{"id":"66a...","name":"管理员","avatar":""}
},"id":1}
// 随后前端调 mine.search 取 roles（并据本地角色配置计算 can）
// 无 admin 权限（与密码错误/用户不存在同一 reason）
{"jsonrpc":"2.0","error":{"code":-32602,"message":"Not permitted scene","data":{"reason":"bad_credentials"}},"id":1}
```

```jsonc
// 用户列表（前端只传 wd，底层统一走 text 索引）
{"jsonrpc":"2.0","method":"user.search","params":{
  "wd":"ali",
  "find":{"roles":"user"},
  "cols":{"username":1,"name":1,"avatar":1,"roles":1,"email":1,"phone":1,"createdAt":1,"updatedAt":1},
  "sort":{"createdAt":-1},"start":0,"limit":20
},"id":2}
// → { list, total, more }
```

```jsonc
// 中文关键词：请求形态相同，按 text 索引整词匹配（暂不分词）
{"jsonrpc":"2.0","method":"user.search","params":{
  "wd":"张",
  "find":{"roles":"user"},
  "cols":{"username":1,"name":1,"avatar":1,"roles":1,"email":1,"phone":1,"createdAt":1,"updatedAt":1},
  "sort":{"createdAt":-1},"start":0,"limit":20
},"id":2}
```

```jsonc
// 资料编辑：密码三态（不传=不变；传值=新密码；传空串=清空密码并清 salt）
{"jsonrpc":"2.0","method":"user.update","params":{
  "id":"66a...",
  "data":{"username":"alice","name":"Alice","avatar":"/upload/a.png",
          "phone":"13800000000","email":"a@b.c","roles":["user"],
          "password":"N3wPassw0rd"}
},"id":3}
// 清空密码：{"password":"", "passsalt":""}（服务端按 §5.5 语义处理）
```

```jsonc
// 首页统计：全部用现有 search 组合（并行发起）
{"jsonrpc":"2.0","method":"user.search","params":{"mode":"only-total"},"id":3}                    // 用户总数
{"jsonrpc":"2.0","method":"user.search","params":{"mode":"only-total","find":{"createdAt":{"$gte":"<7天前>"}}},"id":4}
{"jsonrpc":"2.0","method":"user.search","params":{"mode":"only-total","find":{"roles":{"$in":["root"]}}},"id":5}   // 管理员
{"jsonrpc":"2.0","method":"user.search","params":{"mode":"only-total","find":{"roles":{"$in":["user"]}}},"id":6}   // 客户
{"jsonrpc":"2.0","method":"user.search","params":{"limit":5,"sort":{"createdAt":-1},
  "cols":{"username":1,"name":1,"avatar":1,"roles":1,"createdAt":1}},"id":7}                        // 最近注册

{"jsonrpc":"2.0","method":"mineApiKey.search","params":{"find":{"app":"sk"},"limit":100,
  "cols":{"name":1,"expiresAt":1,"createdAt":1}},"id":8}                                            // 前端汇总 key 数量/到期
```

> `$in` 的取值由前端 `config/roles.ts` 推导：`admin` = 含 `admin` 动作的角色，`guest` = 含 `guest` 动作的角色。若并发请求成为性能问题，再评估是否新增聚合方法（见 D13）。

```jsonc
// 创建自己的 API Key（key 只在创建时随结果返回一次）
{"jsonrpc":"2.0","method":"mineApiKey.create","params":{"data":{"name":"CLI"}},"id":5}
// → { id, key:"sk-..." }

// 之后的搜索不再返回 key
{"jsonrpc":"2.0","method":"mineApiKey.search","params":{"find":{"app":"sk"}},"id":6}
// → { list:[{_id,name,expiresAt,createdAt}] }（无 key 字段）
```

---

## 6. 前端 `crud-admin`（Vue 3 + Bootstrap 5）

### 6.1 技术栈与依赖

| 依赖 | 说明 |
|---|---|
| `vue` | 3.x 最新稳定版 |
| `vue-router` | 4.x，哈希模式 |
| `pinia` | 会话与权限状态 |
| `bootstrap` | 5.x 最新稳定版：CSS + `bootstrap.bundle.min.js`（含 Popper，无 jQuery） |
| `bootstrap-icons` | 图标（最新稳定版） |
| `vite` / `typescript` / `@vitejs/plugin-vue` | 构建与类型 |

- 依赖安装时取 npm latest，由 `package-lock.json` 锁定；不手写具体小版本号。
- **不引入** Element/Ant 等第二套 UI，也不引入 `bootstrap-vue-next`；Bootstrap 组件（Modal/Toast/Offcanvas/Dropdown）用官方 JS API 在 Vue 中按需实例化。

### 6.2 目录结构

```
crud-admin/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts            # dev proxy: /api -> http://localhost:3000
├── public/
└── src/
    ├── main.ts               # createApp / router / pinia / bootstrap 引入
    ├── App.vue
    ├── styles/theme.css      # Bootstrap CSS 变量覆盖（主色、圆角、侧栏）
    ├── config/roles.ts       # 角色代号/显示名（不记录权限动作）
    ├── config/features.ts    # 功能点 → 方法数组（或关系）
    ├── api/
    │   ├── rpc.ts            # JSON-RPC fetch 封装 + 错误归一 + 自动刷新
    │   ├── auth.ts           # auth.chall / auth.login(scene) / auth.refresh / auth.logout
    │   ├── users.ts          # user.*（含首页统计用的 only-total 查询）
    │   ├── apiKeys.ts        # mineApiKey.search/create/delete
    │   ├── profile.ts        # mine.search / mine.update
    │   └── upload.ts         # upload.config + PUT 上传
    ├── stores/session.ts     # access/refresh/user/permits
    ├── workers/pow.worker.ts # PoW 求解
    ├── composables/useToast.ts # Toast + 错误记录
    ├── router/index.ts       # 路由 + 前置守卫
    ├── layouts/AdminLayout.vue
    └── views/
        ├── Login.vue
        ├── Overview.vue
        ├── Users.vue
        ├── ApiKeys.vue
        └── Profile.vue
```

**角色配置 `src/config/roles.ts`**（只记代号与显示名，不记权限动作）：

```ts
export const ROLES = [
  { code: 'anon', name: '匿名',       assignable: false },
  { code: 'user', name: '普通用户',   assignable: true  },
  { code: 'root', name: '超级管理员', assignable: true  },
] as const;
```

**功能点配置 `src/config/features.ts`**（功能点 → 方法数组，或关系）：

```ts
export const FEATURES = {
  users:      { label: '用户管理',      methods: ['user.search'] },
  apiKeys:    { label: '我的 API Key', methods: ['mineApiKey.search'] },
  profile:    { label: '个人资料',      methods: ['mine.search'] },
  userCreate: { label: '新建用户',      methods: ['user.create'] },
  userUpdate: { label: '编辑用户',      methods: ['user.update'] },
  userDelete: { label: '停用用户',      methods: ['user.delete'] },
  apiKeyCreate: { label: '创建 API Key', methods: ['mineApiKey.create'] },
  apiKeyDelete: { label: '删除 API Key', methods: ['mineApiKey.delete'] },
  avatarUpload: { label: '上传头像',    methods: ['upload.config'] },
  profileUpdate:{ label: '修改资料',    methods: ['mine.update'] },
} as const;

// 登录后一次性询问
export const FEATURE_METHODS = 去重(FEATURES.flatMap(f => f.methods));
// 或关系：任一方法为 true 即可用；空数组恒真
export const featureAllowed = (key, permits) =>
  FEATURES[key].methods.length === 0 || FEATURES[key].methods.some(m => permits[m] === true);
```

- `config/roles.ts` 只用于展示与角色分配，不含任何权限动作，避免与后端两份配置同步。
- 登录后调用一次 `auth.permits { methods: FEATURE_METHODS }`，结果存入 session；菜单/按钮用 `canFeature(key)` 判断。
- 一个功能点可对应多个方法（或关系）；更复杂的关系不处理，内部细分由后续需要时再拆功能点。
- 用户 `roles` 中出现未知代号时，界面回退显示代号本身；角色筛选/多选只展示 `assignable: true`。
- 首页“管理员/客户”统计仅为展示口径，按当前角色代号 `root` / `user` 计数。

### 6.3 路由与守卫

| 路径 | 组件 | 说明 |
|---|---|---|
| `/login` | Login.vue | 无会话时唯一可访问页 |
| `/` | Overview.vue | 概览首页（登录后默认页） |
| `/users` | Users.vue | 用户管理 |
| `/api-keys` | ApiKeys.vue | 我的 API Key |
| `/profile` | Profile.vue | 个人资料 |
| 404 | — | 重定向 `/` / `/login` |

- `beforeEach`：无 access 且无 refresh → `/login`；有 refresh 无 access → 先 `auth.refresh`，失败清会话回 `/login`。
- 启动时（App 挂载）调用 `mine.search` 恢复当前用户与 roles，再调 `auth.permits` 一次性拉取功能权限；失败视为会话失效/权限为空。
- 菜单按 `canFeature` 显隐：`users` 功能点依赖 `user.search`，`apiKeys` 依赖 `mineApiKey.search`。

### 6.4 RPC 客户端与会话

- `rpc(method, params)`：
  - 自动注入 `Authorization: Bearer <access>`；`id` 自增；统一返回 `result` 或抛出 `{ code, message, data }`。
  - `code === -32001`（LOGIN_REQUIRED）或 JWT 过期 → 触发一次 `refresh()` 后重试原请求（仅重试一次）。
  - **单飞刷新**：模块级 `refreshPromise`，并发失败请求共享同一次刷新，避免 refresh 轮换互相踢掉。
- 错误处理（D14）：
  - 用户可见文案统一模糊化：登录失败一律“账号不存在、密码错误或无权访问后台”；业务操作失败按场景提示“无权限或数据不存在”“操作失败，请稍后重试”等，不展示 `reason`；
  - 同时 `console.error('[rpc]', method, error)` 输出完整错误对象（code/message/data.reason），便于调试；
  - 日志不包含请求参数（避免密码、token 进控制台）。
- 会话存储（安全优先，不做“记住登录”）：
  - access 只在 Pinia 内存；
  - refresh 只放 `sessionStorage`，键名 `crud-admin.rt`；关闭标签页/浏览器即失效；
  - 退出：调 `auth.logout { refreshToken }` 后清空并回 `/login`。
- 请求超时与网络错误：统一 Toast 提示，401/403 类不弹表单级错误。

### 6.5 PoW Worker

- 输入 `{ challenge, difficulty }`，输出 `{ nonce }`。
- 算法：`nonce` 从 0 递增，`sha256(challenge + '.' + nonce)`，按位统计前导 0 位 ≥ `difficulty`。
- 使用 Web Crypto `crypto.subtle.digest('SHA-256', ...)`；**要求安全上下文（HTTPS 或 localhost）**，部署必须启用 HTTPS；不支持时登录页明确报错（不做纯 JS 降级）。
- 默认难度 16（约 65536 次哈希），正常在几十毫秒内完成；界面显示“安全校验中…”并可取消（`worker.terminate()`）。

### 6.6 页面设计

#### 登录页 `Login.vue`

- 居中卡片；字段：用户名、密码（无“记住登录”）。
- 流程：`auth.chall { username }` → Worker 求 nonce → `auth.login { username, password, scene:'admin', chall }`。
- 错误映射（D14：文案模糊化 + 控制台详细日志）：
  - `bad_credentials` → “账号不存在、密码错误或无权访问后台”，同时 `console.error` 完整错误对象；
  - `challenge_failed / challenge_expired / challenge_marked` → “安全校验失败，请重试”（自动重新取 challenge），同样记录原始错误；
  - 网络错误 → “无法连接服务器”，并记录原始异常。

#### 概览首页 `Overview.vue`

- 数据来源：**全部用现有 `search` 组合**（并行）：
  - `user.search {mode:'only-total'}` → 用户总数；
  - `user.search {mode:'only-total', find:{createdAt:{$gte:7天前}}}` → 近 7 天新增；
  - `user.search {mode:'only-total', find:{roles:{$in:['root']}}}` → 管理员数（展示口径）；
  - `user.search {mode:'only-total', find:{roles:{$in:['user']}}}` → 客户数（展示口径，与管理员可重叠）；
  - `user.search {limit:5, sort:{createdAt:-1}, cols:...}` → 最近注册；
  - `mineApiKey.search {find:{app:'sk'}, limit:100}` → 前端汇总 key 总数/30 天内到期/已过期。
  - 当前账号信息直接取会话中的 `mine.search` 结果。
- **顶部 4 张指标卡**（Bootstrap `.card`，不做图表库）：
  1. 用户总数（副文案：近 7 天新增 +N）
  2. 近 7 天新增
  3. 管理员数（有 `admin` 权限）
  4. 客户用户数（有 `guest` 权限即可，可能与管理员数重叠）
- **左侧「最近注册用户」**：5 条，列头像、姓名、用户名、角色徽章、注册时间；点击行跳转 `/users` 并带上该用户名关键词。
- **右侧「快捷操作」**：新建用户（`/users?create=1`）、创建 API Key（`/api-keys?create=1`）、个人资料（`/profile`）。
- **右侧「我的 API Key」**：总数、30 天内到期、已过期；点击进入 `/api-keys`。
- **右侧「当前账号」**：头像、姓名、用户名、角色徽章（不展示 `admin` / `admin-all` 权限标识）。
- **安全提示条**：`expiring30d > 0` 时提示“有 N 个 API Key 将在 30 天内到期”。
- 加载态用骨架占位；接口失败时整页 Toast 并提供重试按钮。
- 注：若这 6~7 个并行请求在真实数据量下成为性能瓶颈，再按 D13 评估是否新增聚合方法。

#### 用户管理 `Users.vue`

- 顶部工具条：关键词输入（回车/按钮触发）、角色筛选（来自本地角色配置 `config/roles.ts`）、刷新、新建。
- 表格列：头像（`rounded-circle`，无头像显示姓名首字）、用户名、姓名、角色（`badge`）、邮箱、手机、创建时间、操作（编辑/停用）。
- 查询参数：
  - 关键词 → **只传 `wd`**，统一走复合 text 索引（暂不处理中文分词，见 D7）；
  - 角色 → `find.roles = role`；
  - 固定 `sort: { createdAt: -1 }`，`start/limit` 分页，`limit = 20`；
  - `cols` 固定白名单，绝不包含 password/passsalt。
- 新建弹窗（Bootstrap Modal）：`username` 必填且唯一；姓名、头像（上传）、邮箱、手机、角色（多选，默认 `user`）均选填；密码可选（可手动输入、生成、或留空）。
- **资料编辑弹窗（本次重点）**：字段为名称、头像、用户名、phone、email、密码、角色，**全部选填**，默认回填当前值。
  - 用户名可改（唯一）；重复时提示“用户名已存在”。
  - 头像：复用 `upload.config { scene:'avatar' }` 上传后回填 URL。
  - 角色：多选（来自本地角色配置）；**自己的账号禁用角色编辑**，避免把自己锁在后台外。
  - 密码三态（默认“不修改”）：
    - **不修改（默认）**：请求中不携带 `password`；
    - **生成密码**：前端用 `crypto.getRandomValues` 生成 12 位随机密码（排除 `0/O/o/1/l/I` 等易混字符），填入输入框并可“重新生成/复制”；提交时作为新密码；
    - **设置为空**：提交 `password: ""`（服务端同时清空 `passsalt`），表示该账号不再支持密码登录；点击时二次确认。
    - 也可直接手动输入新密码。
- **停用（软删除）**：二次确认；**禁止停用自己**；后端 `user.delete`，服务端同时吊销该用户 refresh、旧 access 立即无权限。本期不提供恢复入口。
- 空态/加载态/错误态齐全；分页展示 `total`；无权限的动作按钮隐藏。

#### API Key `ApiKeys.vue`

- 列表（`mineApiKey.search`，`find.app='sk'`）：名称、创建时间、过期时间、状态（有效/已过期）、删除。**不显示 Key**（服务端已保证不返回）。
- 新建：输入名称 → `mineApiKey.create` → 弹窗展示完整 key + 复制按钮 + “仅此一次展示，请立即保存”提示；关闭弹窗后不可再查看。
- 复制用 `navigator.clipboard`（同样要求 HTTPS/localhost），失败时提供手动选中。

#### 个人资料 `Profile.vue`

- 读取 `mine.search`（`username/name/avatar/email/phone/roles`）。
- 编辑：姓名、头像、邮箱、手机；`mine.update`（服务端会自动剥离 `roles`）。
- 修改密码：可选字段（新密码）；成功后服务端会吊销该用户全部 refresh，前端立即清会话并提示“密码已更新，请重新登录”。
- 头像上传：`upload.config { scene:'avatar', name, size }` → 按返回的 `method/url/headers` PUT 文件 → 用 `accessUrl` 写回 `avatar`。
- 角色只读展示（不可自改）。

### 6.7 Bootstrap 使用规范

- `main.ts` 一次性引入：`bootstrap/dist/css/bootstrap.min.css`、`bootstrap-icons/font/bootstrap-icons.css`、`bootstrap/dist/js/bootstrap.bundle.min.js`。
- 组件实例化用官方 API（`new Modal(el)` / `new Toast(el)`），在 `onUnmounted` 释放；禁止自造遮罩层。
- 表单用 `.form-control` / `.form-select` / `.is-invalid` + `.invalid-feedback`。
- 表格 `.table.table-hover.align-middle`；角色/状态用 `.badge.text-bg-*`。
- 布局：`AdminLayout` 左侧固定侧栏（≥lg）+ 顶部栏；<lg 用 Offcanvas 侧栏。
- 主题：仅覆盖 Bootstrap CSS 变量（`--bs-primary` 等）与少量侧栏样式，保持升级兼容。

---

## 7. 关键流程

### 登录

```
Login.vue            crud-api
  |-- auth.chall {username} ------------>| 签发 challenge
  |<-- {challenge,difficulty,alg,ttl} ---|
  |  Worker 求 nonce
  |-- auth.login {username,password,scene:'admin',chall} -->| checkChallenge → 查用户 → scene 判定 → 密码
  |                                          | 不通过：-32602 bad_credentials（与用户不存在一致）
  |<-- {accessToken,refreshToken,user} -----|
  |-- mine.search（取 roles，前端算 can）--->| 返回自己的用户信息
```

### 每次后台请求

```
rpc(method, params)
  |-- Authorization: Bearer <access>
  |<-- result | error.code
        ├─ -32001 → refresh()（单飞）→ 重试一次 → 仍失败则回登录
        ├─ -32003 → 提示无权限；若 mine.search 也失败（如账号被停用）则清会话回登录
        └─ -32602 → 表单/参数错误提示
```

### 概览首页

```
Overview.vue（并行调用现有 search，见 §5.9）
  |-- user.search × 4（only-total：总数/近7天/管理员/客户）
  |-- user.search（limit 5 最近注册）
  |-- mineApiKey.search（本人 sk，前端汇总到期情况）
  |-- session.user（来自 mine.search）
  |-- 快捷入口 → /users?create=1 | /api-keys?create=1 | /profile
```

### 用户管理

```
Users.vue
  |-- config/roles.ts（角色下拉/多选）
  |-- user.search（只传 wd / 角色 / 分页 / cols 白名单）
  |-- user.create / user.update（资料编辑全部选填；密码不传=不变、生成=新密码、空串=清空；自己禁改角色）
  |-- user.delete（停用/软删；禁止停用自己；无恢复入口）
```

### 我的 API Key

```
ApiKeys.vue
  |-- mineApiKey.search（app=sk；服务端不返回 key）
  |-- mineApiKey.create（返回完整 key，仅弹窗展示一次）
  |-- mineApiKey.delete（确认后删除）
```

---

## 8. 部署与配置

- **路径前缀固定为 `/admin`**：Vite 配 `base: '/admin/'`，路由用哈希模式，入口形如 `/admin/#/login`。开发阶段不处理部署细节，只保证该前缀正确。
- **开发**：`crud-admin` 用 Vite dev server（`http://localhost:5173/admin/`），`vite.config.ts` 配 `server.proxy['/api'] → http://localhost:3000`，无需 CORS。
- **发布**：`npm run build` 产出 `crud-admin/dist`，最终放入线上 `static` 目录下（如 `static/admin/`），由现有静态服务按 `/admin` 路径访问；不需要改 SPA 回落（哈希路由）。
- **HTTPS 必须**：Web Crypto 与剪贴板 API 仅安全上下文可用；生产必须 HTTPS，开发用 `localhost` 不受限。
- **环境变量**：本期无新增后端环境变量（沿用 `JWT_SECRET` / `CHALLENGE_DIF` / `CHALLENGE_TTL` / `MONGO_URI`）。
- **初始化管理员**：`npm run init-admin` 分配 `roles: ['root']`；登录时传 `scene:'admin'`，`root` 已有 `admin` 权限，无需改角色配置。

---

## 9. 实施顺序（确认后执行）

| 阶段 | 内容 | 可验收结果 |
|---|---|---|
| P0 | 后端：`loadUserRoles` 过滤停用、`user.ts` 秘密字段加固 + text 索引 + `search` 的 wd 分流 + 改密/停用吊销、`mine.ts` search 屏蔽 key | RPC 层可完成管理员登录（scene）、关键词检索、资料编辑、停用、一次性 key |
| P1 | 前端骨架：Vite + Vue + Bootstrap（`base:'/admin/'`）、布局、路由守卫、RPC 客户端、会话（sessionStorage）、PoW Worker、登录页、概览首页（现有 search 组合）、角色配置 | 能用管理员账号登入并看到概览首页 |
| P2 | 用户管理页（列表/搜索/分页/新建/资料编辑/密码生成与清空/停用） | 用户管理全流程可用 |
| P3 | API Key 页（一次性展示）+ 个人资料页（含头像上传、改密后重新登录） | 自助配置闭环 |
| P4 | 构建产物按 `/admin` 前缀联调、生产建索引、响应式与错误态打磨 | 路径与交互验收通过 |

---

## 10. 验证清单

### 后端

1. `npm run check`（crud-api）类型通过。
2. `npm run init-admin` 后，用输出账号走 `auth.chall` → `auth.login {scene:'admin'}` 成功；再调 `mine.search` 能拿到自己的 `roles`（不含 password/passsalt）。
3. 新建一个仅 `roles:['user']` 的账号：带 `scene:'admin'` 时（密码对错均）返回 `-32602 reason:bad_credentials`，与“用户不存在/密码错误”完全一致；不传 scene 可正常登录，但调 `user.search` 等仍 `-32003`。
4. 不带 token 调 `user.search` → `-32003`；带管理员 access → 正常返回列表。
5. `user.search` 返回项中**不存在** `password/passsalt`（包括显式 `cols:{password:1}` 也不返回）。
6. `auth.refresh` 轮换正常；`auth.logout` 后旧 refresh 失效。
7. `mine.search` 只返回本人、且不含 password/passsalt；`user.search` 的 `cols` 白名单不会泄漏秘密字段。
8. `mineApiKey.create` 返回完整 key；`search` 仅返回本人 `app='sk'` 行且**不含 key 字段**（显式 `cols:{key:1}` 也不返回）；`delete` 后不可见。
9. 软删除（停用）用户后：`user.search` 不再返回；该用户旧 access 调业务方法被拒；旧 refresh 失效；`sk-` key 也不再可用。
10. 关键词搜索：请求只传 `wd`；命中 `username/name/phone/email`；user 集合存在复合 text 索引（`getIndexes()` 确认）；中文关键词按 text 整词匹配（暂不做正则回退）。
11. 资料编辑：所有字段均为选填，只传需要改的字段；用户名改成已存在值 → 报“用户名已存在”。
12. 密码三态：不传 → 原密码仍可登录；传新值 → 新密码可登录、旧密码失败；传空串 → `auth.login` 返回 `bad_credentials`，且库中 `password/passsalt` 为空。
13. 改密/清空密码后：该用户原有 `app='rt'` 行被删除，旧 refresh 调 `auth.refresh` 返回 `refresh_invalid`；`sk-` 行保留（已定不吊销）。
14. 停用：`user.delete` 后该用户从 `user.search` 消失；再登录/刷新失败；无恢复接口（后续需要时另评估 `search`/`update` 参数）。
15. 概览统计（用现有 `user.search` / `mineApiKey.search` 组合）：总数、近 7 天、管理员（有 `admin`）、客户（有 `guest`，允许重叠）、最近 5 条及本人 key 汇总均与库中数据一致。
16. 用户组判定：`root` 账号计入管理员、不计入客户；`user` 账号（含 `guest`）计入客户；同一账号若同时具备 `admin` 与 `guest`，则管理员数与客户数都计入。
17. `auth.permits`：`methods:['user.search','auth.login','foo.bar']` 返回 `permits:['user.search']`（交集，其余不返回）；未登录/无该动作调用被拒绝。

### 前端

18. 概览首页：4 张指标卡、最近 5 条用户、快捷入口、到期 key 提示显示正确；**不出现 `admin` / `admin-all` 标识**；点击最近用户跳转 `/users` 并带上关键词。
19. 登录页：正确/错误密码、非管理员、无效 challenge、断网提示均正确；错误文案保持模糊（不出现“无权限”等具体原因），控制台能看到完整 `code/reason`；**无“记住登录”**。
20. 会话只在当前标签页有效：刷新页面可恢复；新开标签页 / 关闭浏览器后需重新登录（sessionStorage 为空）。
21. 用户管理：关键词/角色筛选、分页、新建（含头像）、资料编辑（全部选填、改用户名、密码生成/清空/不变）、停用（禁止停用自己）均正常。
22. 权限控制：`auth.permits` 返回后，无 `user.create` / `user.update` / `user.delete` 时对应按钮隐藏；直接调接口仍被后端拒绝。
23. 角色展示：`config/roles.ts` 只有代号/显示名；未知代号回退显示代号；`anon` 不出现在可选列表。
24. API Key：创建后弹窗显示完整 key 并可复制；关闭后列表**不显示 key**；删除生效；过期状态展示正确。
25. 个人资料：改姓名/邮箱/手机、上传头像、改密后立即退出并需重新登录。
26. 响应式：≥1280 / 768 / 375 三档布局与侧栏（Offcanvas）可用。

---

## 11. 风险与最终决策

### 风险

- **Web Crypto 依赖 HTTPS**：纯 HTTP 非 localhost 下 PoW 无法求解，需在部署说明中强制 HTTPS。
- **密码哈希泄漏面**：`user.search` 的 `cols` 可被调用方任意指定，必须依赖 §5.5 的服务端剔除；实现时需补测试。
- **text 索引对中文不分词**：`wd` 对中文姓名只能整词命中，本期接受；数据量大或检索要求提高时直接上 ES。
- **text 索引需在生产补建**：`autoIndex` 通常只在开发环境开启；上线前必须执行一次建索引/`syncIndexes()`，否则 `wd` 直接报错。
- **清空密码的账号**：不能密码登录；改密/清空会统一吊销 `app='rt'`，`sk-` API Key 按既定策略保留（仅面向程序调用，与登录会话无关）。
- **停用与 sk**：停用用户后其 `sk-` key 仍在库中，但每次请求的 `loadUserRoles` 返回空 → 业务调用被拒；本期无恢复入口。
- **功能点配置需维护**：`config/features.ts` 决定菜单/按钮依赖哪些方法；新增功能时补一条即可，不需要同步后端角色动作。
- **概览请求数较多**：首页由 5~6 个 `search` 并行组成；若数据量/延迟成为问题，再按 D13 评估聚合方法。
- **数据范围约束尚未实现**：本期仍是方法级权限；后续 user 等角色“仅能操作自己的数据”时，以 `isPermitted('admin-all', roles)` 判断是否放开全量数据。
- **用户组统计口径**：展示层按角色代号 `root` / `user` 计数，只用于概览，不参与任何权限判断。
- **refresh 轮换并发**：前端必须单飞刷新；否则标签页/并发请求会互相失效。
- **管理员自锁**：停用自己、把自己角色改掉都会导致无法再进后台；本期用“禁止停用自己 + 自己角色只读”兜底，后端未加强制校验。
- **退出登录不吊销 access**：access 短期自然过期；refresh 已删除，不再续签。

### 最终决策（已确认）

| # | 决策 |
|---|---|
| 1 | 后台登录复用 `auth.login`，传 `scene:'admin'`；不通过统一返回 `-32602 reason:'bad_credentials'`（与用户不存在/密码错误一致）。scene 仅为提前拦截，方法权限仍逐次校验 |
| 2 | 停用复用现有 `user.delete`（软删除）；**本期不提供回收站/恢复**，日后需要时给 `search` / `update` 加参数 |
| 3 | 路径前缀固定 `/admin`；开发阶段不管部署，发布时构建产物放入线上 `static`（如 `static/admin/`） |
| 4 | refresh 只存 `sessionStorage`，不做“记住登录”，安全优先 |
| 5 | 改密/清空密码只吊销 `app='rt'`，**不吊销** `sk-`（AI/特殊客户端用途，不在同一层） |
| 6 | API Key 仅创建时返回完整 key，之后 `mineApiKey.search` 不再返回 `key` |
| 7 | 用户组靠权限位：`admin`=管理用户组（后台准入），`guest`=客户用户组；两者独立判断，允许重叠 |
| 8 | **方法最小化**：仅新增 `auth.permits`（权限查询）；数据操作一律用现有 `search / create / update / delete / statis` |
| 9 | 前台错误文案刻意模糊化；完整 `code/message/reason` 用 `console.error` 输出（不含请求参数） |
| 10 | 权限判断走 `auth.permits`，返回允许的方法数组；前端 `config/features.ts` 维护功能点→方法（或关系），`config/roles.ts` 不再记录权限动作 |
