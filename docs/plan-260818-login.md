# 登录 API 计划（用户名密码 + 无状态 JWT + 无感 PoW 防爆破）

> 范围：仅"认证"层（`verify.challenge` / `auth.login` / `auth.refresh` / `auth.logout` 四个 func + JWT 中间件 + crud 子项目匿名 fallback）。
> 不含：register（暂不考虑）、role/权限矩阵（"再下一层"应用层过滤，后续 plan 细化）。
> 目标：尽可能简单、明了；复用 crud-api 与 crud 子项目现有基建，不引入新依赖。

---

## 1. 概要

为 `crud-api` 增加用户名密码登录能力：

- 登录成功返回 **极简无状态 access JWT**（载荷仅 `sub`/`iat`/`exp`，短期）+ **独立 refresh token**（存库、可吊销、可轮换、默认有效期 1 年），用于移动端长空闲续签。
- 登录前要求客户端完成一次 **无感 PoW（工作量证明）**，仅在"用户名密码登录"路径上生效（`auth.refresh` / `auth.logout` 凭 refresh token，不需 PoW）。
- PoW challenge 归到独立 **`verify.*` 命名空间**，作为通用"敏感接口验证因子"：本期仅 `verify.challenge`，未来可扩 `verify.imageCaptcha` / `verify.dragCaptcha` 等，供登录及其他敏感接口共用。
- 新增轻量鉴权预处理：解析 `Authorization: Bearer <token>` 识别 `ctx.uid`，**区分两种凭证**——`sk-` 前缀走 API key 路径（查 `userApiKeys` 的 `app='sk'` 行取 `userId`），否则走 JWT 解析。`rt-` 前缀 refresh token 不参与业务请求鉴权（仅 `auth.refresh` 内部查库）。无效/无 token 则 `ctx.uid` 留空。
- **匿名 fallback 在 crud-api 入口预处理**（不动 crud 子项目）：无 `ctx.uid` 且无 `ctx.roles` 的请求自动补 `roles: ['anon']`；crud-api 通过 `regRole('anon', [...])` 放行登录相关 func 名。不设计 role 矩阵。
- **roles 处理策略**：`loadUserRoles(uid): Promise<string[]>` **本期即实现并调用**——从 DB 查 `user.roles` 字段（`findById(uid).select('roles')`）填 `ctx.roles`。未来可在此函数内部加缓存层（进程内 LRU / Redis，按 uid）而不改调用点。本期因 `regRole('user'/'admin', ...)` 未注册，`isPermitted` 对业务 crud 方法仍返回 false（不抛错）——`mine.*` 等仍被拦截，符合预期边界。
- 不引入 `jsonwebtoken` 等新包；HS256 用 `crypto.createHmac` 手写（与现有 `hashPassword`/`genApiKey` 风格一致）。

---

## 2. 现状分析（已核对）

| 事实 | 位置 |
|---|---|
| 单入口 `POST /api/rpc`（JSON-RPC） | [crud-api/src/index.ts:24-37](file:///d:/Workspace/HongsCRUD/crud-api/src/index.ts#L24-L37) |
| 每次请求 `ctx = { uid: undefined, roles: [] }`（**全匿名、无鉴权中间件**） | [crud-api/src/index.ts:32](file:///d:/Workspace/HongsCRUD/crud-api/src/index.ts#L32) |
| `handleRpc → callFunc(method, params, ctx)` | [crud-api/src/api/rpc.ts:36](file:///d:/Workspace/HongsCRUD/crud-api/src/api/rpc.ts#L36) |
| callFunc 先查 FUNCS（func 名=method 全名）命中即 `isPermitted` 后调用 | [crud/src/cruds.ts:706-738](file:///d:/Workspace/HongsCRUD/crud/src/cruds.ts#L706-L738) |
| `regFunc(name, func)` / `regRole(role, acts)` | [crud/src/cruds.ts:57](file:///d:/Workspace/HongsCRUD/crud/src/cruds.ts#L57) / [cruds.ts:34](file:///d:/Workspace/HongsCRUD/crud/src/cruds.ts#L34) |
| `regFuncs()` / `regRoles()` 当前均为空 | [funcs/index.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/funcs/index.ts) / [roles.ts](file:///d:/Workspace/HongsCRUD/crud-api/src/roles.ts) |
| `userSchema`：`username(unique)` `password` `passsalt` `roles:[String] default ['user']` `isDeleted`，softDelete + timestamps | [crud-api/src/cruds/user.ts:7-24](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/user.ts#L7-L24) |
| `hashPassword(plain)`：16 字节随机盐 + pbkdf2Sync(plain, salt, 100000, 64, 'sha512') hex | [crud-api/src/cruds/user.ts:30-34](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/user.ts#L30-L34) |
| `userApiKeySchema`：`userId` `key(unique)` `app(default 'sk')` `name` `expiresAt`；`skExpires:86400000*365`（365 天） | [crud-api/src/cruds/user.ts:60-73](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/user.ts#L60-L73) |
| `genApiKey(prefix='sk-')`：32 字节 base64url | [crud-api/src/cruds/user.ts:91-100](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/user.ts#L91-L100) |
| `userApiKey` 实例（Cradle，未注册为 crud，服务端可直接用其 `getModel()`） | [crud-api/src/cruds/user.ts:81](file:///d:/Workspace/HongsCRUD/crud-api/src/cruds/user.ts#L81) |
| `CrudError(message, code?, data?)`；`CrudErrno`：`METHOD_MISSING -32601` / `PARAMS_INVALID -32602` / `INTERNEL_ERROR -32603` / `LOGIN_REQUIRED -32001` / `RIGHT_DEPRIVED -32003` / `ALTER_REJECTED -32009` | [crud/src/cruds.ts:101-118](file:///d:/Workspace/HongsCRUD/crud/src/cruds.ts#L101-L118) |
| 依赖仅 koa / koa-bodyparser / mongoose / hongs-crud（无 jwt/session/rate-limit） | [crud-api/package.json](file:///d:/Workspace/HongsCRUD/crud-api/package.json) |

> 关键约束：`callFunc` 对 func 也走 `isPermitted(name, ctx.roles)`；当前 roles 为空时**所有 method 都被 `RIGHT_DEPRIVED` 拦截**。本期通过 §7.4 在 crud-api 入口预处理 ctx，将无 uid 且无 roles 的请求自动补 `anon` 角色，解决 auth/verify func 的可达性。crud 子项目本期保持零修改。

---

## 3. 设计决策

- **D1 会话机制**：无状态 access JWT（HS256，手写，无新依赖）。载荷极简：`{ sub, iat, exp }`，不含 roles（"载荷尽可能少"+role 延后）。
- **D2 续签**：独立 refresh token，存入 `userApiKeys` 集合（`app='rt'`，`key=genApiKey('rt-')`，`expiresAt=now+REFRESH_TTL`，默认 1 年），可吊销、可轮换。refresh 凭 refresh token 本身，不要求 `ctx.uid`。与 `app='sk'`（长期 API key）在同类集合中以 `app` 字段区分。
- **D3 防爆破**：无感 PoW。服务端下发签名 challenge（含服务端时间，避免时钟偏斜），客户端找 nonce 使 `sha256(challenge + '.' + nonce)` 前导 0 位 ≥ `difficulty`。难度低（默认 16 位 ≈ 65536 次/尝试），合法用户 <10ms 无感；仅作用于 `auth.login`。
- **D4 匿名鉴权在 crud-api 入口预处理**：不修改 crud 子项目。在 `crud-api/src/index.ts` 构造 ctx 时做预处理：若请求**无 `ctx.uid` 且无 `ctx.roles`（或空数组）**，则自动补 `roles: ['anon']`。crud-api 通过 `regRole('anon', ['verify.challenge','auth.login','auth.refresh','auth.logout'])` 放行这 4 个方法。有效 access JWT 时再填 `ctx.uid`。**不设计 role 矩阵**（user/admin、各 crud 方法的细粒度权限留后续 plan）。
- **D5 `verify.*` 命名空间**：PoW challenge 单独归到 `verify.challenge`，作为通用"敏感接口验证因子"。未来同一前缀下可加 `verify.imageCaptcha` / `verify.dragCaptcha` 等，供登录、改密、删号等敏感接口共用。`auth.login` 仅消费 challenge，与 `verify.*` 解耦。
- **D6 register 不做**（本期不开放注册入口）。
- **D7 错误码**：复用 `CrudErrno.PARAMS_INVALID(-32602)` 表示"输入非法"（坏 challenge / 坏 PoW / 坏凭据 / 坏 refresh），通过 `data.reason` 区分；不新增枚举、不动 crud 包（除 D4 外）。需要专属码时可后续补 `CrudErrno`。
- **D8 只针对有用户名密码的用户**：登录查询 `findOne({ username, isDeleted:{'$ne':true}, password: {'$exists':true, '$ne':''} })`；无密码用户（如未来 OAuth-only 账号）一律 `PARAMS_INVALID(reason:'bad_credentials')`，不区分存在性以防枚举。

---

## 4. 接口设计（func）

> 约定：func 名 = JSON-RPC `method` 全名。参数/返回用简单 JSON 示例（对齐项目既有风格）。

### 4.1 `verify.challenge` —— 申请 PoW challenge（anon，通用验证因子）

```
// 请求
{ "username": "alice" }
// 返回
{
  "challenge": "eyJ1IjoiYWxpY2UiLCJ0IjoxNzU1NTYwMDAwLCJkIjoxNiwibiI6IjFOWDVzIn0.xYz...sig",
  "difficulty": 16,
  "alg": "sha256",
  "expiresIn": 120
}
```

- `challenge` = `base64url(payload) + '.' + base64url(hmacSha256(b64payload, JWT_SECRET))`
- payload = `{ u:username, t:Date.now(), d:DIFFICULTY, n:randomBytes(8).base64url }`
- 签名确保服务端来源 + 不可伪造；`t` 由服务端写入，校验时只比服务端时间，避免客户端时钟偏斜。
- 本期仅 PoW；该前缀为"敏感接口验证因子"通用入口，未来加图形/拖拽验证时返回结构可按 `type` 字段扩展（如 `{ type:'pow' | 'image' | 'drag', ... }`）。

### 4.2 `auth.login` —— 用户名密码登录（anon，需 PoW）

```
// 请求
{
  "username": "alice",
  "password": "pw123",
  "verify": { "challenge": "<challenge>", "nonce": "abc123" }
}
// 成功返回
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI2NmF...",   // HS256 JWT
  "accessExp": 1755560900,
  "refreshToken": "rt-7A3f...k2P",
  "refreshExp": 1787110000,
  "user": { "id":"66a...", "username":"alice", "name":"Alice", "avatar":"/a.png" }
}
// 失败（统一不区分原因，防枚举）
// error.code = -32602, error.data = { reason:"bad_credentials" | "bad_pow" | "bad_challenge" | "expired" }
```

> `verify` 作为整体对象传入，未来可扩展为 `{ challenge, nonce, imageCaptcha: {id,code} }` 等，登录函数签名保持稳定。

服务端流程：
1. `verifyLogin(verify, username)` 接收整个 `verify` 对象；从其中取 `challenge` + `nonce`；
2. 验签 challenge（重算 hmac 比对）+ 解 payload；
3. `payload.u === username` 且 `Date.now() - payload.t <= CHALLENGE_TTL`；
4. PoW 校验：取 `sha256(challenge + '.' + nonce)` 前导 0 位 ≥ `payload.d`；
5. 查 user（D8 条件）；不存在或无密码 → `bad_credentials`；
6. `pbkdf2Sync(password, user.passsalt, 100000, 64, 'sha512').hex` 与 `user.password` 用 `timingSafeEqual` 比对；不等 → `bad_credentials`；
7. 签发 access JWT（`sub=String(user._id)`, `exp=now+ACCESS_TTL`）；
8. 写 refresh 行：`userApiKey` 模型 `app='rt'`, `key=genApiKey('rt-')`, `userId=user._id`, `expiresAt=now+REFRESH_TTL`；
9. 返回上述结构。

### 4.3 `auth.refresh` —— 续签 access（凭 refresh token，无需 PoW）

```
// 请求
{ "refreshToken": "rt-7A3f...k2P" }
// 成功返回（轮换 refresh）
{
  "accessToken": "eyJ...",
  "accessExp": 1755560900,
  "refreshToken": "rt-9Bc...q7R",      // 新 refresh，旧的已删
  "refreshExp": 1787111000
}
// 失败
// error.code = -32602, error.data = { reason:"refresh_invalid" | "refresh_expired" }
```

服务端流程：
1. `findOne({ key:refreshToken, app:'rt' })`；不存在 → `refresh_invalid`；
2. `expiresAt > now`？否 → 删除该行 + `refresh_expired`；
3. 签发新 access JWT；
4. **轮换**：删旧行 + 写新 refresh 行（`app='rt'`, `key=genApiKey('rt-')`, `expiresAt=now+REFRESH_TTL`）；
5. 返回新对。

> 轮换可选关闭（保留旧行），默认开启以支持移动端长空闲续签安全。该接口不期望携带有效 access JWT（access 过期后才续签），故走匿名 `anon` 路径。

### 4.4 `auth.logout` —— 吊销 refresh（凭 refresh token）

```
// 请求
{ "refreshToken": "rt-7A3f...k2P" }
// 返回
{ "ok": true }
```

- `deleteOne({ key:refreshToken, app:'rt' })`；无论是否命中都返回 `ok:true`（幂等）。
- access JWT 短期自然过期，不做黑名单（保持无状态）。同 refresh，走匿名 `anon` 路径。

---

## 5. JWT 与 PoW 细节

### 5.1 access JWT（HS256，手写）

```
header  = base64url({"alg":"HS256","typ":"JWT"})
payload = base64url({"sub":uid, "iat":nowSec, "exp":nowSec+ACCESS_TTL_SEC})
sig     = base64url(hmacSha256(header + '.' + payload, JWT_SECRET))
token   = header + '.' + payload + '.' + sig
```

- 校验：拆 3 段 → 重算 hmac → `timingSafeEqual` 比对 → 检查 `exp`。
- 中间件校验失败一律视为"无 token"（匿名），不抛错。

### 5.2 PoW

- `hashInput = challenge + '.' + nonce`（challenge 为完整 `b64.b64sig` 串）
- `digest = sha256(hashInput)`；统计前导 0 位（按字节逐位计）≥ `difficulty` 即通过。
- `DIFFICULTY=16`（≈ 65536 次/尝试；合法客户端 <10ms，爆破成本线性抬升）。
- 客户端自由选 `nonce`（任意字符串）。

### 5.3 refresh token 存储

- 复用 `userApiKey` Cradle 实例，服务端直接 `getModel()` 操作（不经 callFunc，不受 callable/role 限制）：
  - 建：`getModel().create({ userId, app:'rt', key:genApiKey('rt-'), expiresAt: now+REFRESH_TTL })`
  - 查：`getModel().findOne({ key, app:'rt' })`
  - 删：`getModel().deleteOne({ key, app:'rt' })` 或 `deleteOne({ _id })`
- `key` 已有 unique 索引，天然防重。
- 有效期默认 1 年（`REFRESH_TTL = 365*86400000`），对齐 `userApiKeySchema.skExpires`。
- `app` 取值约定：`'sk'`=长期 API key（程序调用）、`'rt'`=refresh token（登录续签）。两类同集合、按 `app` 区分。

### 5.4 凭证识别（uid 解析）

`resolveUserCtx(authHeader?)` 从 `Authorization: Bearer <token>` 解析，**按前缀分流**：

| token 形态 | 处理 | 填充 |
|---|---|---|
| `sk-...` | 查 `userApiKeys.findOne({ key:token, app:'sk' })`；`expiresAt` 不存在或 `> now` → 取 `userId` | `ctx.uid = String(userId)` |
| `eyJ...`（JWT） | `verifyAccess(token)`：拆段→重算 hmac→`timingSafeEqual`→检 `exp` | `ctx.uid = payload.sub` |
| `rt-...` | **业务请求不处理**（仅 `auth.refresh` 内部查库） | `ctx.uid` 留空（→ 走 anon） |
| 无 header / 失败 | — | `ctx.uid` 留空（→ 走 anon） |

- 任何失败均视为"无 token"（匿名），不抛错、不写 `ctx.roles`。
- sk 路径每请求查一次 `userApiKeys`（按 unique `key` 主索引，极快）；后续可在 `loadUserRoles` 同处加缓存层一并缓存 sk→userId 映射。
- sk 与 JWT 可共存：客户端任选其一；`mine.*` 等业务方法本期仍受 role 矩阵缺失拦截（预期边界）。

### 5.5 roles 加载

- `loadUserRoles(uid: string): Promise<string[]>` **本期即实现并调用**。
- 当前实现：`userModel.findById(uid).select('roles').exec()` → 返回 `user.roles ?? []`。
- `resolveUserCtx` 在识别到 `ctx.uid` 后调用：`ctx.roles = await loadUserRoles(uid)`。
- 性能特征：每请求查一次 user 文档（按 `_id` 主键，极快）；sk 路径另有一次 `userApiKeys` 查询（共两次）。
- 未来可演进：在此函数内部包一层进程内 LRU / Redis 缓存（按 uid，TTL 可配），不改 `resolveUserCtx` 调用点。这是后续优化项，不影响本期接口。
- 边界说明：本期 `regRole('user'/'admin', ...)` 未注册，`isPermitted` 直接读 `ROLES[role]`，未注册时为 undefined → `undefined && ...` 短路为 false（不抛错），故业务 crud 方法仍被 `RIGHT_DEPRIVED` 拦截。这是预期边界，待后续 role 矩阵 plan 落地。

---

## 6. 配置（环境变量与常量）

| 名 | 默认 | 说明 |
|---|---|---|
| `JWT_SECRET` | —（必填，缺失启动即报错） | HS256 与 challenge 签名共用 |
| `ACCESS_TTL` | `15 * 60 * 1000`（15 分钟） | access JWT 有效期 |
| `REFRESH_TTL` | `365 * 86400000`（1 年） | refresh token 有效期（对齐 `userApiKeySchema.skExpires`） |
| `CHALLENGE_TTL` | `120 * 1000`（120 秒） | challenge 有效期 |
| `DIFFICULTY` | `16` | PoW 前导 0 位数 |

> 常量集中在 `funcs/auth.ts` 顶部；可选支持 env 覆盖（非必须）。

---

## 7. 实现改动（文件级）

### 7.1 新增 `crud-api/src/funcs/auth.ts`

包含：
- 常量（§6）+ `JWT_SECRET` 读取与缺失校验。
- JWT：`signAccess(uid)` / `verifyAccess(token): {uid:string} | null`。
- PoW：`issueChallenge(username)` / `verifyPoW(verify, username)`（接收整个 verify 对象，从中取 `challenge`/`nonce`）。
- `verifyPassword(plain, user)`：pbkdf2Sync + `timingSafeEqual`（与 `user.ts:hashPassword` 对称）。
- `resolveUserCtx(authHeader?): Promise<Context>`：按 §5.4 前缀分流识别 uid（sk 查库 / JWT 解析），有效填 `ctx.uid` 后**调用 `loadUserRoles(uid)` 填 `ctx.roles`**；否则两者皆留空。
- `loadUserRoles(uid): Promise<string[]>`：本期实现为 DB 查询（§5.5）；未来可在此函数内部加缓存层。
- func 实现 + `regAuthFuncs()`：`regFunc('verify.challenge', ...)` / `'auth.login'`（内部 `verifyLogin(verify, username)`）/ `'auth.refresh'` / `'auth.logout'`。

### 7.2 修改 `crud-api/src/funcs/index.ts`

```ts
import { regFunc } from 'hongs-crud';
import { regAuthFuncs } from './auth';

export function regFuncs(): void {
  regAuthFuncs();
}
```

### 7.3 修改 `crud-api/src/roles.ts`

```ts
import { regRole } from 'hongs-crud';

export function regRoles(): void {
  regRole('anon', ['verify.challenge', 'auth.login', 'auth.refresh', 'auth.logout']);
}
```

> 仅放行 auth/verify 入口；user/admin 及 crud 方法级权限矩阵为后续 plan。

### 7.4 修改 `crud-api/src/index.ts`

- 顶部读 `JWT_SECRET`（缺失 `throw`，与 `MONGO_URI` 同风格）。
- rpc 处理改为用 `resolveUserCtx` 构造 ctx，并执行**匿名 fallback 预处理**：

```ts
import { resolveUserCtx } from './funcs/auth';
// ...
let userCtx = resolveUserCtx(ctx.request.headers.authorization);

// 匿名 fallback：无 uid 且无有效 roles 时，补 anon 角色
// (crud 子项目保持零修改)
if (!userCtx.uid && (!userCtx.roles || (userCtx.roles as any[]).length === 0)) {
  userCtx = { ...userCtx, roles: ['anon'] };
}

ctx.body = await handleRpc(body, userCtx);
```

> 不新增中间件文件，直接在 rpc 处理前解析（最小侵入）。

### 7.5 新增 `crud-api/.env.example`

为了避免配置分散，建立统一的环境变量示例文件，集中管理所有运行时参数。**后续所有计划新增配置一律追加到此处，不再分散。**

```bash
# ---------- 基础服务 ----------
MONGO_URI=mongodb://localhost:27017/crud
PORT=3000

# ---------- 认证 & 鉴权 ----------
# JWT 签名密钥 (必填，生产环境务必使用强随机值)
JWT_SECRET=please-change-me-to-a-strong-random-secret

# Access Token 有效期 (毫秒)，默认 15 分钟
ACCESS_TTL=900000

# Refresh Token 有效期 (毫秒)，默认 365 天 (1 年)
REFRESH_TTL=31536000000

# PoW Challenge 有效期 (毫秒)，默认 2 分钟
CHALLENGE_TTL=120000

# PoW 难度 (2 的 N 次方运算次数)，默认 16 (即 65536 次)
DIFFICULTY=16

# ---------- 未来扩展 (预留占位) ----------
# roles 缓存策略 (内存 or redis)，默认内存
# ROLES_CACHE_DRIVER=memory
# roles 缓存 TTL (毫秒)，默认 5 分钟
# ROLES_CACHE_TTL=300000
```

- **本期代码不强制依赖 `dotenv`**：为避免引入新依赖，`src/index.ts` 启动时直接通过 `process.env.VAR` 读取；开发者可自行在本地 shell 或 `.env` 中设置，或手动注入。
- **约定**：`.env.example` 只维护键名与默认值示例，不含真实密钥。`.env` 文件（含真实密钥）加入 `.gitignore`。

### 7.6 不改动

- `crud/src/cruds.ts`（crud 子项目保持零修改）。
- `cruds/user.ts`、`cruds/mine.ts`（不改；mine 等是否可达取决于后续 role 矩阵，本期不解决）。

---

## 8. 关键流程

### 登录链路
```
客户端                        服务端
 |-- POST /api/rpc verify.challenge {username} -->|  签发 challenge
 |<-------- {challenge, difficulty, alg} -------|
 |   算 nonce 使 sha256(challenge.nonce) 前导0≥d   |
 |-- POST /api/rpc auth.login {username,password,challenge,nonce} -->|
 |                                              |  验签+TTL+PoW+用户名密码
 |<----- {accessToken, refreshToken, user} ----|
```

### 续签链路（access 过期后）
```
客户端                          服务端
 |-- POST /api/rpc auth.refresh {refreshToken} -->|
 |                                                |  查 refresh 行+未过期
 |                                                |  轮换 refresh + 签发新 access
 |<----- {accessToken, refreshToken} -------------|
```

### 鉴权链路（每次业务请求）
```
Authorization: Bearer <token>
   -> resolveUserCtx 按前缀分流（§5.4）
      sk-...      -> 查 userApiKeys(app=sk) -> ctx.uid = String(userId)
      eyJ...(JWT) -> verifyAccess -> ctx.uid = sub
      rt-... / 无 / 失败 -> ctx.uid 留空
   -> 有 uid：ctx.roles = await loadUserRoles(uid)   // 从 DB 查 user.roles（§5.5）
   -> 匿名 fallback（§7.4）：无 uid 且无 roles -> 补 roles: ['anon']
   -> callFunc(method, params, ctx)
      // verify.challenge / auth.login / auth.refresh / auth.logout 因 anon 角色可达
      // 业务 crud 方法（mine.* / user.*）因 regRole('user'/'admin',...) 未注册，本期仍被拦截（预期边界）
```

> roles 当前每请求查一次 DB；未来在 `loadUserRoles` 内部加缓存层即可，不改 `resolveUserCtx`。

---

## 9. 范围与延后（明确不做）

- ❌ `register` 注册接口（暂不考虑）。
- ❌ role/权限矩阵（`regRole('user'/'admin', [...crud 方法...])`、`ctx.roles` 注入用户 stored roles）—— 后续 plan。
- ❌ access JWT 黑名单/强撤销（靠短 TTL；吊销走 refresh 删除）。
- ❌ per-用户失败计数/锁定（采用 PoW 无感防爆破替代）。
- ❌ challenge 单次使用追踪（stateless；靠短 TTL + username 绑定 + PoW 成本控制）。
- ⚠️ 后果提示：本期完成后，`mine.*` / `user.*` 等 crud 方法仍被 `RIGHT_DEPRIVED` 拦截，直到后续 role 矩阵 plan 落地。这是预期边界。

---

## 10. 验证步骤

1. `npm run check`（`tsc --noEmit`）类型通过。
2. 准备配置：复制 `.env.example` 为 `.env`，填入本地测试密钥。
3. 启动：`npm run dev`（或 `MONGO_URI=... JWT_SECRET=testsecret npm run dev`）。
4. 未设 `JWT_SECRET` 启动应直接报错退出。
5. `POST /api/rpc` `verify.challenge {username:'alice'}` → 拿 challenge。
6. 本地算 nonce 满足难度后 `auth.login {...}` → 拿到 access + refresh（refresh `expiresAt` ≈ now+1 年）。
7. 用错误密码 → `{code:-32602, data:{reason:'bad_credentials'}}`；用坏 PoW → `reason:'bad_pow'`。
8. 带坏 nonce/旧 challenge（>120s）→ `bad_pow` / `expired`。
9. `auth.refresh {refreshToken}` → 拿新对；再用旧 refresh → `refresh_invalid`（已轮换）。
10. 不带 `Authorization` 调 `verify.challenge` / `auth.login` → 因 crud 匿名 fallback 命中 `anon` 角色可达（验证 D4）。
11. 业务请求带 `Authorization: Bearer <accessToken>` → `ctx.uid` 被填（可用临时探针或日志确认）。
12. `auth.logout {refreshToken}` → 再 refresh → `refresh_invalid`。

---

## 11. 待审查的默认决策（可推翻）

- **`verify` 前缀命名**：challenge 归到 `verify.*`（通用敏感接口验证因子命名空间，未来 `verify.imageCaptcha` / `verify.dragCaptcha`）。是否用 `verify`？或换 `captcha` / `sec` / `guard`？
- **D3 PoW 难度=16**：是否同意默认值？是否需要 env 可调？
- **refresh 轮换**：默认开启轮换（删旧建新，refresh 有效期 1 年）；如需"非轮换、refresh 静态有效至过期"请说明。
- **`anon` 角色名**：crud-api 入口 fallback 用 `anon` 作为匿名角色名；是否保留此名？
- **roles 查询性能**：本期 `loadUserRoles` 每请求查一次 DB（按 `_id` 主键）；未来加缓存层是否需要在本期就预留接口位（如 env 开关、TTL 配置常量）？默认不在本期引入。
