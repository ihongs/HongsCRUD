# HongsCRUD

**Homogeneous Operational Rule Data Ensemble** · Hong's Operational Rule Data Ensemble

一套基于 **TypeScript** 与 **Mongoose** 构建的规则数据集成与管理平台。围绕三条主线展开：

1. **简化 CRUD** —— 通过 `Cradle` 类与统一注册器，一行注册即获得标准化的 `search` / `create` / `update` / `delete` / `statis` / `upsert` / `schema` 能力；同一套 MongoDB 查询语法可无缝衔接 ElasticSearch。
2. **权限细分可控** —— `callFunc` 调度入口配合 `Role` 角色映射、`callable` 白名单、`isPermitted` 权限校验，三层防线把控外部调用。
3. **暴露数据结构** —— `schema` 方法自省 Mongoose Schema，输出结构化的字段、枚举、关联描述，供前端表单、文档生成，亦可供 AI Agent 消费。

> 核心机制详见 [crud/README.md](./crud/README.md)，ElasticSearch 支持详见第 4 节。

## 技术栈

- **基础语言**：[TypeScript](https://www.typescriptlang.org/)
- **数据建模**：[Mongoose](https://mongoosejs.com/) `^8.0.0`
- **服务框架**：[Koa](https://koajs.com/) `^2.15.0`（含 `koa-bodyparser`）
- **接口协议**：JSON-RPC 2.0（MCP 适配规划中）

## 目录结构

```
HongsCRUD/
├── crud/                        核心库 hongs-crud（独立 npm 包）
│   ├── src/
│   │   ├── index.ts             Cradle（CRUD 基类）+ 注册器（Crud/Func/Role/Hook）+ callFunc
│   │   ├── types.ts             共享类型（SearchParams / Context / Crud 等）
│   │   ├── cs/                  CS 检索组件：MongoDB text 索引 + 分词
│   │   ├── es/                  ES 检索组件：ElasticSearch 查询 + 自动同步
│   │   └── kv/                  键值组件：接口 + mongo / redis 实现
│   ├── test/                    测试（crud / cs / es / kv）
│   ├── dist/                    构建产物
│   └── README.md                核心机制详细文档
├── crud-api/                    服务端 API（Koa + JSON-RPC 2.0）
│   ├── src/
│   │   ├── index.ts             启动入口：连接 Mongo、注册、路由、监听
│   │   ├── roles.ts             角色 → 动作集合
│   │   ├── api/
│   │   │   ├── rest/            REST 扩展预留
│   │   │   ├── sses/            SSE  场景注册
│   │   │   ├── rpc.ts           POST /api/rpc
│   │   │   ├── sse.ts           GET  /api/sse（SSE 流）
│   │   │   ├── upload.ts        PUT  /api/upload（裸流上传）
│   │   │   └── static.ts        静态资源 + SPA 兜底
│   │   ├── cruds/               Crud 实例
│   │   ├── funcs/               RPC  方法
│   │   ├── hooks/               RPC  钩子
│   │   ├── schemas/             Mongoose Schema 等
│   │   ├── types/               共享类型
│   │   ├── utils/               challenge、upload（local / oss / s3）
│   │   └── scripts/             初始化脚本
│   └── .env.example             环境变量示例
├── crud-admin/                  管理端 Web（Vue 3 + Vite + Pinia）
│   ├── src/
│   │   ├── api/                 RPC 封装（rpc / users / apiKeys / profile / upload / pow）
│   │   ├── views/               页面（Login / Overview / Users / ApiKeys / Profile）
│   │   ├── stores/              Pinia 状态（session）
│   │   ├── config/              功能点与角色配置
│   │   ├── router/              路由
│   │   ├── styles/              样式
│   │   ├── layouts/             布局
│   │   ├── components/          通用组件
│   │   ├── composables/         组合式函数
│   │   └── workers/             Web Worker（PoW）
│   └── vite.config.ts
├── docs/                        设计文档与开发计划
└── README.md
```

- `crud/` —— 核心组件库，封装 `Cradle` 类、注册器（`Crud` / `Func` / `Hook` / `Role`）、`callFunc` 调度入口与共享类型，并内置 `cs` / `es` / `kv` 三个可选子组件；作为独立 npm 包发布（`hongs-crud`），供 `crud-api` 及其他端复用。
- `crud-api/` —— 服务端 API，启动 Koa 服务提供 `/api/rpc`、`/api/sse`、`/api/upload` 与静态资源；Schema 在 `src/schemas/` 定义，Crud 实例在 `src/cruds/` 创建，RPC 方法和钩子分别在 `src/funcs/` 和 `src/hooks/` 定义。
- `crud-admin/` —— 管理端 Web，基于 Vue 3 + Vite + Pinia，覆盖登录、概览、用户管理、API Key 与个人资料。仅作为示例。
- `docs/` —— 设计文档与开发计划。

## 快速开始

### 1. 启动 MongoDB

本地启动 `mongodb://localhost:27017`，或通过 `MONGO_URI` 环境变量指定。

### 2. 启动 API 服务

```bash
cd crud-api
npm install
npm run dev
```

服务默认监听 `http://localhost:3000`，入口为 `POST /api/rpc`。首次使用需在 `npm run dev` 前执行 `npm run init-admin` 初始化数据库。

## License

MIT
