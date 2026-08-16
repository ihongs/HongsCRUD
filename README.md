# HongsCRUD

**Homogeneous Operational Rule Data Ensemble** · Hong's Operational Rule Data Ensemble

一套基于 **TypeScript** 与 **Mongoose** 构建的规则数据集成与管理平台。围绕三条主线展开：

1. **简化 CRUD** —— 通过 `Crud` 类与统一注册器，一行注册即获得标准化的 `search` / `create` / `update` / `delete` / `counts` / `upsert` / `schema` 能力。
2. **权限细分可控** —— `callFunc` 调度入口配合 `Role` 角色映射、`callable` 白名单、`isPermitted` 权限校验，三层防线把控外部调用。
3. **暴露数据结构** —— `schema` 方法自省 Mongoose Schema，输出结构化的字段、枚举、关联描述，供前端表单、文档生成与 AI Agent 消费。

> 核心机制详见 [crud/README.md](./crud/README.md)。

## 技术栈

- **基础语言**：[TypeScript](https://www.typescriptlang.org/)
- **数据建模**：[Mongoose](https://mongoosejs.com/) `^8.0.0`
- **服务框架**：[Koa](https://koajs.com/) `^2.15.0`（含 `koa-bodyparser`）
- **接口协议**：JSON-RPC 2.0（MCP 适配规划中）

## 目录结构

```
HongsCRUD/
├── crud/                    核心库 hongs-crud
│   ├── src/
│   │   ├── index.ts         Crud 类 + 三套注册器（Role/Func/Crud）+ callFunc 调度入口
│   │   └── types.ts         共享类型（SearchParams / Context / Crud 等）
│   ├── dist/                构建产物
│   ├── package.json
│   └── README.md
├── crud-api/                服务端 API（Koa + JSON-RPC）
│   └── src/
│       ├── api/
│       │   └── rpc.ts       /api/rpc JSON-RPC 适配（mcp/ 规划中）
│       ├── cruds/         Mongoose Schema 定义 + Crud 注册
│       │   ├── index.ts     委托 crud 注册器统一登记
│       │   ├── mine.ts      示例：当前用户账户模型
│       │   └── user.ts      示例：用户模型
│       └── index.ts         启动入口（连接 Mongo + 注册 schema + 监听端口）
├── crud-web/                Web 客户端（规划中）
├── docker/                  容器化配置（规划中）
├── plans/                   开发计划与设计文档
└── README.md
```

- `crud/` —— 核心组件库，封装 `Crud` 类、三套注册器（`Role` / `Func` / `Crud`）、`callFunc` 调度入口与共享类型，作为独立 npm 包发布（`hongs-crud`），供 `crud-api` 及其他端复用。
- `crud-api/` —— 服务端 API，启动 Koa 服务监听 `/api/rpc`，通过 `callFunc` 转发到已注册的 `Crud` 实例；业务 schema 在 `src/schemas/` 中定义并委托 crud 注册器登记。
- `crud-web/` —— Web 客户端（规划中）。
- `docker/` —— 容器部署配置（规划中）。
- `docs/` —— 设计文档与开发计划。

## 快速开始

### 1. 启动 MongoDB

本地启动 `mongodb://localhost:27017`，或通过 `MONGO_URI` 环境变量指定。

### 2. 启动 API 服务

```bash
cd api
npm install
npm run dev
```

服务默认监听 `http://localhost:3000`，入口为 `POST /api/rpc`。

### 3. 调用示例

```bash
curl -X POST http://localhost:3000/api/rpc \
  -H "Content-Type: application/json" \
  -d '{ "jsonrpc":"2.0", "method":"user.search", "params":{}, "id":1 }'
```

> 默认未注入任何角色，调用需 `crud-api/src/index.ts` 中补充 `ctx.roles` 或注册对应 `Role`，否则会被 `UNPERMITTED` 拦截。详见 [crud/README.md](./crud/README.md#权限模型)。

## License

MIT
