# 基于 Elasticsearch 的搜索与统计规范

- 20260820：新的基于 Elasticsearch 的 `search` 和 `counts` 组件。
- 20260822：对齐现行代码并清理已完成项（`types.ts` 的 `wd`、`Cradle.add` / `set` 的元组返回）；`setAll` 已改为逐个调 `set`、另有 `putAll` 走 `updateMany`，Chaser 的覆盖面相应调整为 `add` / `set` / `putAll` / `delAll`；ES 查询不加软删除条件等口径统一；第 6 节改为分阶段任务表。
- 20260823：initIndex(force) 拆分为 initIndex() 和 makeIndex()，initIndex 先删后建，makeIndex 缺失才建。canSync 改名 syncable，canText 改名 textable。

## 0. 总体设计

新增 `crud/src/search/` 目录：`search/index.ts` 导出 `Chaser` 类及相关方法，`search/types.ts` 放本组件的类型声明。`Chaser` **继承 `Cradle`**，职责：把 mongoose Schema 的字段（默认全部，`canSync: false` 的除外）纳入 ES 索引，用 ES 提供 `search` / `counts`，并在写入时把变更同步进 ES。

文件划分：

| 文件 | 内容 |
|---|---|
| `crud/src/search/index.ts` | `Chaser` 类、`setEsClient` / `getEsClient`、mapping 推导与 find→DSL 翻译等内部函数 |
| `crud/src/search/types.ts` | `SyncOpts` / `SyncFindOpts` / `SyncCullOpts` / `SyncStat` 等本组件类型，以及 Schema 扩展选项与字段扩展项的类型声明 |
| `crud/src/types.ts` | 不放 ES 相关类型；`wd?: string` 已加（`SearchParams` / `CountsParams`），仅余扩展点文档注释的补充 |
| `crud/src/index.ts` | **不导出 `search`**，保持现状；`search` 走 subpath 单独导出，见下「依赖隔离」 |

定位与边界：

- `Chaser extends Cradle`，只覆盖两类方法：
  - **读**：`search` / `counts` 改走 Elasticsearch。
  - **写**：`add` / `set` / `putAll` / `delAll` 仍走 super（MongoDB 为权威数据源），成功后同步 ES；`setAll` 内部逐个调 `set`，随 `set` 的覆盖自动同步，无需覆盖。
  - `create` / `update` / `delete` / `upsert` / `schema` / `chkIds` 等一概继承不动，因其内部只调 `add` / `set`（`setAll` 亦只逐个调 `set`）与 `delAll`。
- 不新增接口类型：`Chaser` 天然满足 `Crud`，`callable`、json-rpc、前端与 MCP 调用方式完全不变。
- 入参 / 返回沿用现有 `SearchParams` / `SearchResult` / `CountsParams` / `CountsResult`；`wd`（全文关键词）已在类型中，`Cradle` 现以 mongo `$text` 实现，`Chaser` 改查 ES 合并字段。
- 用法即「把 `new Cradle(...)` 换成 `new Chaser(...)`」，检索与统计自动转为 ES 实现。
- 本期实现 `search`、`counts` 与数据同步（同步不做则无法测试）；索引按需惰性建立，也可显式 `initIndex`。

依赖：

- `@elastic/elasticsearch` 列为 `peerDependencies`（`^8.0.0`）+ `devDependencies`，与 mongoose 的处理方式一致，不进 `dependencies`。
- 同时配 `peerDependenciesMeta: { "@elastic/elasticsearch": { "optional": true } }`：`search` 是**可选组件**，用不着 ES 的开发者无需安装，包管理器也不会告警。
- 客户端由使用方创建后注入，`search/index.ts` 不读环境变量、不自己 `new Client`。
- `search` 目录下只 `import type { Client } from '@elastic/elasticsearch'`（仅类型，编译后无 require），运行时不做任何值导入。

依赖隔离（保证「不用 `search` 就完全不依赖 ES」）：

主入口**不导出** `search`，改由 subpath 单独导出，`package.json`：

```json
"exports": {
  ".":       { "types": "./dist/index.d.ts",        "default": "./dist/index.js" },
  "./search":{ "types": "./dist/search/index.d.ts", "default": "./dist/search/index.js" }
},
"typesVersions": { "*": { "search": [ "dist/search/index.d.ts" ] } }
```

理由：若主入口 `export * from './search'`，`dist/index.d.ts` 会连带加载 `dist/search/index.d.ts`，其顶部的 `import type { Client } from '@elastic/elasticsearch'` 在使用方未装 ES 且 `skipLibCheck: false`（tsc 默认值）时会报 `Cannot find module`。拆成 subpath 后，不 `import 'hongs-crud/search'` 的项目连这个 `.d.ts` 都不会加载，与使用方的 tsconfig 无关。

三个环节的结果：

| 环节 | 未装 ES 且不用 `search` | 说明 |
|---|---|---|
| 安装 | 不装 ES，包管理器不告警 | `peerDependenciesMeta.optional: true` |
| 类型检查 | 不报错，无需 `skipLibCheck` | subpath 隔离，`search` 的 `.d.ts` 不被加载 |
| 打包 | 不报 `module not found`、无 warning | 全程 `import type`，产物里没有对 ES 的任何引用 |

`typesVersions` 是给使用方仍用 `moduleResolution: node10`（旧解析）时兜底的；`node16` / `bundler` 直接认 `exports`。

```ts
import { Client } from '@elastic/elasticsearch';
import { Chaser, setEsClient } from 'hongs-crud/search';  // 注意：从 subpath 引入

const es = new Client({ node: process.env.ES_NODE });

// 方式一：构造时注入（第二参 model 沿用 Cradle，第三参为 es）
const userCrud = new Chaser(userSchema, undefined, es);

// 方式二：注册全局默认客户端，构造时可省略
setEsClient(es);
const userCrud = new Chaser(userSchema);
```

其余可调项（索引名、合并字段名、是否自动同步等）一律放在 Schema 的扩展选项里，构造方法不再增加参数，见 1.1。

## 1. Schema 扩展与索引映射

### 1.1 字段扩展项 `canSync` / `canText` / `analyzer`

**默认全同步**：Schema 中所有可映射的字段一律纳入 ES 索引；只有显式声明 `canSync: false` 的字段不进索引。

```ts
const userSchema = new Schema({
  username: { type: String, title: '用户名' },
  intro   : { type: String, analyzer: 'ik_smart' },  // 可选，字段级分词器，覆盖 esAnalyzer
  status  : { type: String, countable: true, refData: { list: 'userStatus' } },
  roles   : { type: [String], countable: true },
  age     : { type: Number },
  orgId   : { type: Schema.Types.ObjectId, countable: true },
  passwd  : { type: String, select: false, canSync: false },  // 不参与检索的字段显式关闭
  remark  : { type: String, canText: false },       // 进 ES 可单独精确查，但不并入全文
  notes   : { type: String, canSync: false },       // 显式关闭，不进 ES，find/wd/sort 均不可用
  works   : { type: [workSchema], nested: true },   // 数组子文档，声明 nested 才保留元素关联，见 1.3
}, {
  collection : 'users',
  timestamps : true,
  softDelete : true,
  esIndex    : 'crud_users',       // 可选，索引名，默认取 collection
  esFullText : 'fullText',         // 可选，合并搜索字段名，默认 fullText
  esSyncTime : 'syncTime',         // 可选，同步戳字段名，默认 syncTime
  esAnalyzer : 'ik_max_word',      // 可选，text 字段的分词器，默认不设（用 ES 的 standard）
  esAutoSync : true,               // 可选，写入后是否自动同步 ES，默认 true；false 则只靠定时同步
});
```

规则：

- **纳入索引**：默认全部纳入。以下情况不纳入：
  1. 字段声明 `canSync: false`；
  2. 类型无法映射（如 `Map`，见 1.2）。
- `select: false` 的字段**照常同步**：`select` 只管「能否显示」，不管「能否查询」；不希望入索引就再加 `canSync: false`（如密码不作检索用，应显式关闭）。
- 不在索引内的字段被 `find` / `sort` / `wd` 引用时抛 `CrudErrno.PARAMS_INVALID`；但 `canSync: false` 不影响返回，因文档一律回 mongo 取（见 2.2），只是不能查、不能排序。
- **标记位置**：`canSync: false` 可标在**叶子字段**上（只排除该字段），也可标在**容器字段**（子文档 / 数组子文档）上，此时整棵子树都不进索引。
- **可统计** 仍由 `countable: true` 单独决定，但字段须先在索引内；`countable: true` 又 `canSync: false` 视为配置矛盾，构造时抛 `CrudErrno.INTERNEL_ERROR`。
- 字段扩展项 `analyzer` 指定该字段的分词器，覆盖 Schema 级 `esAnalyzer`；只对映射为 `text` 的字段有效，见 1.2。
- 字段扩展项 `canText: false` 表示该字段**不并入全文**（仍进索引、仍可单独 `find` / `sort`），供备注、日志这类长文本使用；`getFullText()` 的默认实现会跳过它，见 1.2。`canSync: false` 的字段自然也不并入全文，无需再标 `canText: false`。
- 启用 `softDelete` 时，`isDeleted` / `deletedAt` **不入索引**：ES 里只有有效文档，无需再存删除标记、也无需在查询里排除。故 `Chaser.search` / `Chaser.counts` 不调用 `Cradle.getSoftDeleteCond()`，`getMapping` 把这两个字段视同 `canSync: false`。
- `timestamps` 的 `createdAt` / `updatedAt` 自动纳入索引，可直接排序与范围过滤。

Schema 扩展选项（`Chaser` 的特殊选项一律放在 Schema 上，不再另设构造参数）：

| 选项 | 默认 | 说明 |
|---|---|---|
| `esIndex` | `collection` | ES 索引名 |
| `esFullText` | `'fullText'` | 合并搜索字段名，`wd` 的查询目标 |
| `esSyncTime` | `'syncTime'` | 同步戳字段名，每次写入 ES 时置为当前时间，见 1.4 |
| `esAnalyzer` | 无（ES 默认 `standard`） | 索引内所有 `text` 字段（含合并字段）的默认分词器，可被字段级 `analyzer` 覆盖，见 1.2 |
| `esAutoSync` | `true` | 写入（`add` / `set` / `putAll` / `delAll`）后是否自动同步 ES；`false` 则完全交给定时 `syncFind` |
| `esSyncError` | `console.error` | 同步失败回调 `(err, info) => void` |

### 1.2 类型推导（mongoose → ES mapping）

| Mongoose | ES mapping |
|---|---|
| `String` | `{ type: 'text', analyzer?, fields: { keyword: { type: 'keyword', ignore_above: 256 } } }` |
| `String` + `enum` | `{ type: 'keyword' }`（枚举值不做分词） |
| `Number` | `{ type: 'double' }` |
| `Schema.Types.Decimal128` | `{ type: 'double' }` |
| `Boolean` | `{ type: 'boolean' }` |
| `Date` | `{ type: 'date' }` |
| `Schema.Types.ObjectId` | `{ type: 'keyword' }` |
| `[X]` | 按元素类型推导（ES 数组与标量同 mapping） |
| `SubDocument`（非数组） | `{ type: 'object', properties: {...} }`，递归推导 |
| `[SubSchema]` | 默认同 `object` 扁平；标 `nested: true` 则 `{ type: 'nested', properties: {...} }`，见 1.3 |
| `Map` | **不支持**，一律跳过（键不可枚举，无法预生成 mapping），无需标 `canSync: false` |

不索引的字段一律不进 ES：本组件只为查询与统计服务，不承担存储职责，`_source` 里不会出现「只存不索引」的字段。

合并字段（全文字段）：

- mapping 中显式定义合并字段 `{ type: 'text' }`（有 `esAnalyzer` 则带上），字段名默认 `fullText`，可由 Schema 选项 `esFullText` 覆盖（与业务字段撞名时改掉即可）。
- **不用 ES 的 `copy_to`，一律由 `getFullText(doc)` 自行拼装**后作为普通字段随文档写入，见下。
- mapping 加 `_source: { excludes: [ esFullText ] }`：倒排照建（能搜），但不占 `_source` 空间。查询本就 `_source: false` 且文档回 mongo 取（见 2.2），排除它无副作用。
- 不用 `_all`：ES 7+ 已移除内置 `_all`，且下划线前缀是 ES 元字段的保留惯例。
- `wd` 只查这一个合并字段，不做 `multi_match`，查询更快、行为可预期。

`getFullText(doc)`：

```ts
/** 拼装全文内容，写入 esFullText 字段；子类可覆盖以追加标签等派生文本 */
protected getFullText(doc: any): string;
```

- 默认实现的效果与 `copy_to` 等价：按**文本字段清单**（mapping 推导阶段一并挑出：映射为 `text` 的字段，含 `String` / `[String]` 以及 object / nested 下递归的文本字段）逐个取值，扁平化数组、去空、去重后 `join(' ')`。
- 清单排除两类字段：`canSync: false`（不进索引）与 `canText: false`（进索引但不并入全文，见 1.1）。
- 由 `syncDocs` 在写入时调用，与同步戳 `esSyncTime` 一起构成组件写入的两个内部字段。
- 子类覆盖以加入派生文本，典型场景是把码值转成可搜的标签：

```ts
class UserChaser extends Chaser {
  protected getFullText(doc: any): string {
    return [
      super.getFullText(doc),            // 默认的文本字段拼接
      USER_STATUS[doc.status] || '',     // 码值 → 标签，如 1 → '已发布'
      doc.orgName || '',                 // 关联名称等派生文本
    ].filter(Boolean).join(' ');
  }
}
```

为什么不用 `copy_to`、也不做「二选一」的开关：

- `copy_to` 拷的是字段**原始值**，`status: 1` 拷进去就是 `"1"`，永远搜不到「已发布」。凡是码值转标签、关联 id 转名称、日期转可读串，都只能在写入前拼，这条路必须存在，`copy_to` 只是它的真子集。
- 改动代价差一档：改 `copy_to`（增删参与全文的字段）属于改已有字段定义，按 1.4 只能 `initIndex(true)` + `syncFind()` 重建（有空窗）；改 `getFullText` 只是改写入内容，一趟 `syncFind()` 覆盖即可，无空窗。而「全文放哪些内容」恰是最常反复调整的。
- `copy_to` 与 nested 组合有硬约束（只能拷向当前 nested 文档或其祖先），扁平 / nested 两套结构还要分情况；自行拼装时 nested 子文档的文本直接扁平化进根级全文，一致且好解释。
- 可调试：全文内容是一个能打印出来的字符串；`copy_to` 是索引内部行为，`_source` 里看不见，只能 `_analyze` 猜。
- 不省空间：两者倒排开销相同，多出的 `_source` 那份已由 `_source.excludes` 排掉。
- 不做开关：两条路会渗透到 mapping 推导、`pushMapping` 的 diff 判定、「何时必须重建索引」的规则与测试用例，全部要写两遍且行为不同；而默认实现本就复用已挑好的文本字段清单，成本很低。

同步戳字段：

- mapping 中显式定义 `{ [esSyncTime]: { type: 'date' } }`，默认字段名 `syncTime`，不并入合并字段。
- 由 `syncDocs` 在每次写入时置为当前时间，与业务字段无关，`find` / `sort` / `counts` 均不开放引用（引用时同不可映射字段一样抛 `PARAMS_INVALID`），只供同步机制内部使用，见 1.4。

`dynamic` 策略：

- mapping 根级与所有 `object` / `nested` 一律声明 `dynamic: 'strict'`，未在 mapping 中声明的字段写入时直接报错。
- 理由：默认的 `dynamic: true` 会让漏推的 mapping **静默生效**——ES 自动推导出的字段类型可能推歪（如 `'2024-01-01'` 推成 `date`），而字段类型一旦定型就只能重建索引才能改。`strict` 把这类错误从「上线后查不对」提前到「写入即失败」。
- `syncDocs` 本就按 mapping 裁剪字段，正常路径不会触发 `strict`，它是防止 mapping 与代码脱节的安全网。

分词器：

- 两级配置，就近覆盖：
  - Schema 选项 `esAnalyzer`：索引内**所有** `text` 字段（含合并字段）的默认分词器；
  - 字段扩展项 `analyzer`：只作用于该字段，覆盖 `esAnalyzer`；
  - 两者都不设时不写 `analyzer`，由 ES 用 `standard`（中文按字切分，可满足基本包含式检索）。
- 只对 `text` 生效：`keyword`（含 `String` + `enum`、`ObjectId`）与数值 / 日期 / 布尔字段不分词，标了 `analyzer` 视为配置矛盾，构造时抛 `CrudErrno.INTERNEL_ERROR`。
- 合并字段的分词器取 `esAnalyzer`；`getFullText()` 拼进去的是**原始文本**，源字段各自的 `analyzer` 不影响 `wd`，`wd` 的分词行为只由合并字段这一处决定。
- `search_analyzer` 不单独开放：索引与检索用同一分词器（`ik_max_word` 这类需要 `ik_smart` 检索的场景，本期用字段级 `analyzer` 统一即可），需要时再作兼容性扩展。
- **改分词器等于改 mapping 且不能在线改**：已建索引的字段换 `analyzer` 会被 ES 拒绝，只能 `initIndex(true)` + `syncFind()` 重建，见 1.4。
- 组件不负责安装分词插件：配了 ES 未安装的分词器，建索引时由 ES 直接报错。

索引建立：

- `Chaser` 首次查询或同步前惰性检查索引是否存在（结果内存缓存），不存在则按推导出的 mapping 创建；已存在则不改动、不校验，避免误改线上索引。
- 也可显式调用 `initIndex()` / `initIndex(true)`（见 5.2）。
- **`initIndex()` 不做 mapping 差异校验**：已存在的索引原样保留，因此改过 Schema 之后必须显式走 1.4 的变更流程，否则新字段查不到却没有任何报错。

### 1.3 多层级数据：object 扁平与 nested

ES 对 `object` 类型是**扁平化**索引的，数组子文档会丢失元素间的关联：

```json
// 原始文档
{ "works": [ { "tag": "a", "qty": 1 }, { "tag": "b", "qty": 9 } ] }

// ES 默认（object）实际索引为两个并列数组
{ "works.tag": ["a", "b"], "works.qty": [1, 9] }
```

于是 `find: { 'works.tag': 'a', 'works.qty': 9 }` 会误命中该文档（`a` 与 `9` 并不在同一元素中）。

采用**默认扁平、显式声明才 nested** 的策略：

- 单个子文档（非数组）：路径唯一，扁平无歧义，直接 `object`。
- 标量数组（`[String]` 等）：ES 原生支持，无歧义。
- 数组子文档（`[SubSchema]`）：**默认 `object` 扁平**。单字段条件（`works.tag: 'a'`）与单字段统计在扁平下语义正确，走快路径、零额外开销；跨字段联合条件不保证落在同一元素，此限制需在 README 中明确写出。
- 数组子文档标 `nested: true`：映射为 `nested`，每个元素作独立隐藏子文档索引，关联得以保留。

#### nested 的查询翻译

同一 `path` 下的多个条件必须**归组合并进同一个 nested query**：

```json
// 正确：存在某个元素同时满足 tag=a 且 qty=9
{ "nested": { "path": "works", "query": { "bool": { "filter": [
  { "term": { "works.tag.keyword": "a" } },
  { "term": { "works.qty": 9 } }
] } } } }

// 错误：存在元素 tag=a，且存在元素 qty=9（可以是两个不同元素）
{ "bool": { "filter": [
  { "nested": { "path": "works", "query": { "term": { "works.tag.keyword": "a" } } } },
  { "nested": { "path": "works", "query": { "term": { "works.qty": 9 } } } }
] } }
```

翻译器规则：

- `$and`（含隐式 and）内，同一 nested path 的子条件先按 path 归组，再合并为一个 `nested` 子句。
- `$or` / `$not` 下各分支独立包裹，不跨分支归组。
- 嵌套多层 nested 时逐层包裹，内层 path 用全路径（`a.b`）。

#### nested 的聚合与排序

- `counts` 统计 nested 字段时，`terms` 桶的 `doc_count` 是**子元素数**，需内嵌 `reverse_nested` 回到父文档取数：

```json
{
  "aggs": { "works.tag": {
    "filter": { "bool": { "filter": [ /* 除自身外的 sels，父文档上下文部分 */ ] } },
    "aggs": { "n": { "nested": { "path": "works" },
      "aggs": { "t": { "terms": { "field": "works.tag.keyword", "size": 10 },
        "aggs": { "p": { "reverse_nested": {} } }
      } }
    } }
  } }
}
```

  取 `p.doc_count` 作为该值的文档数。若 `sels` 中另有字段与被统计字段处于**同一 nested path**，该条件需下移到 `nested` 内部过滤，而非留在外层 `filter`。

- `sort` 引用 nested 字段时需带 `nested: { path }` 与 `mode`（升序 `min`、降序 `max`）。
- nested 内的文本由 `getFullText()` 一并扁平化拼进根级合并字段（不受 `copy_to` 只能拷向祖先的限制），故 `wd` 仍可命中 nested 内的文本；但命中的是父文档整体，不定位到具体元素。
- ES 限制：`index.mapping.nested_fields.limit` 默认 50、`nested_objects.limit` 默认 10000，超出时由 ES 报错，本组件不额外兜底。

### 1.4 Schema 变更后的索引维护

ES 的硬约束决定了处理方式，几类变更不能一概而论：

| 变更 | ES 能否在线改 | 处理方式 |
|---|---|---|
| 新增字段 | 能，`PUT _mapping` 增量追加 | `pushMapping()` + `syncFind()` 回填 |
| 删除字段 | **不能**，mapping 里的定义无法移除 | 任其残留，`syncFind()` 覆盖掉旧值即可 |
| 改全文内容（`getFullText` 实现、`canText`） | 不涉及 mapping | 只需 `syncFind()` 重写一遍数据 |
| 改已有字段类型 / 分词 | **不能**，直接报 `illegal_argument_exception` | 只能 `initIndex(true)` + `syncFind()` 重建（有空窗） |

新增字段：

- `pushMapping()` 取 `getMapping()` 与索引现有 mapping 做 diff，只对索引中尚不存在的字段调 `indices.putMapping`，已有字段一律不传，故不会触发 ES 的类型冲突报错。
- 必须由本方法推送而非手写：`keyword` 子字段、nested 结构、`dynamic: 'strict'` 等推导规则都在 `getMapping()` 里，手写极易与索引内的既有定义不一致。
- 推完 mapping 还须刷一遍数据：旧文档里没有新字段的值，不重新 index 就查不到。

删除字段（指从 Schema 移除，或改标 `canSync: false`）：

- mapping 里那条定义删不掉，但它不占倒排空间，只占少量 cluster state，**留着无害**。
- 真正要清的是旧文档里该字段的**旧值**：它仍在倒排索引中，且它此前拼进过合并字段，`wd` 会命中已经不该被搜索的内容。
- `syncDocs` 用的是 `index` 动作（整文档覆盖，非 partial update），所以刷一遍数据后旧值自然消失，无需重建。
- 仅两种情况才值得为删字段重建索引：反复增删逼近 `index.mapping.total_fields.limit`（默认 1000）；或有合规要求连字段定义都不能留痕。

标准操作序列（全程无空窗、可重复执行、中断重跑即可）：

```ts
// 1. 推增量 mapping：只补新增字段，不动既有定义
await userCrud.pushMapping();

// 2. 全量刷新：既回填新字段，又覆盖掉已删字段的旧值，同时清掉孤立记录
await userCrud.syncFind();
```

只有「改了已有字段的类型或分词」才退回有空窗的重建：`initIndex(true)` + `syncFind()`。而改 `getFullText()` 的实现或某字段的 `canText` 不动 mapping，只需第 2 步的 `syncFind()`。

## 2. Chaser 类

```ts
export class Chaser extends Cradle {
  constructor(schema: Schema, model?: Model<any>, es?: Client);

  /* ---------- ES 基础 ---------- */

  getClient(): Client;                      // 未注入则取全局默认，缺失抛 INTERNEL_ERROR
  getIndex (): string;                      // esIndex || collection

  /** 入索引字段 → ES mapping，含合并字段 */
  getMapping(): Record<string, any>;
  /** 入索引字段名集合（含子文档点号路径），即排除 canSync: false 后的可映射字段 */
  getSyncable(): Set<string>;
  /** 参与全文的文本字段名集合，即入索引的 text 字段再排除 canText: false */
  getTextable(): Set<string>;
  /** 入索引 + countable 字段名集合 */
  getCountable(): Set<string>;
  /** 声明了 nested 的字段路径集合，用于查询归组与聚合包裹 */
  getNestedPaths(): Set<string>;
  /** 拼装全文内容，写入 esFullText 字段；默认按 getTextable() 取值拼接，子类可覆盖，见 1.2 */
  protected getFullText(doc: any): string;

  /* ---------- 覆盖：读走 ES ---------- */

  search(params: SearchParams, ctx: Context): Promise<SearchResult>;
  counts(params: CountsParams, ctx: Context): Promise<CountsResult>;

  /* ---------- 覆盖：写后同步 ---------- */
  // add / set 沿用 Cradle 的元组返回 [ doc, id ] / [ doc, count ]（已实现），直接取 doc 同步；
  // setAll 内部逐个调 set，随 set 的覆盖自动同步，无需覆盖；详见第 5 节

  add   (data: Record<string, any>): [ any, string ];
  set   (id : string, data: Record<string, any>): [ any, number ];
  putAll(ids: string[], data: Record<string, any>): number;
  delAll(ids: string[], data?: Record<string, any>): number;

  /* ---------- 索引与同步 ---------- */
  // 详见第 5 节
}

/** 注册 / 读取全局默认 ES 客户端 */
export function setEsClient(client: Client): void;
export function getEsClient(): Client | undefined;
```

构造方法只在 `Cradle` 的 `model` 之后加一个 `es`，不再有第四参：所有可调项（`esIndex` / `esFullText` / `esSyncTime` / `esAnalyzer` / `esAutoSync` / `esSyncError`）都从 Schema 的扩展选项读取，见 1.1。

`crud/src/types.ts` 无需改动：`wd?: string` 已在 `SearchParams` / `CountsParams` 中。不新增 `Crud` 相关接口（`Chaser` 继承自 `Cradle`，已满足 `Crud`）；ES 相关类型一律放 `search/types.ts`。

导出：`crud/src/index.ts` **不导出** `search`；`search/index.ts` 内 `export * from './types'`，由 `package.json` 的 `exports["./search"]` 作为独立入口对外，见 0 节「依赖隔离」。

### 2.1 find 到 ES query 的翻译

`find` 保持 mongo 风格，内部翻译为 ES DSL，全部进 `filter` 上下文（不参与打分）：

| find 写法 | ES 子句 |
|---|---|
| `{ f: 'v' }` | `{ term: { 'f.keyword': 'v' } }`（text 字段取 `.keyword`，keyword 型直接用本名） |
| `{ f: { $eq: v } }` | 同上 |
| `{ f: { $ne: v } }` | `must_not` + `term` |
| `{ f: { $gt/$gte/$lt/$lte: v } }` | `{ range: { f: { gt/gte/lt/lte: v } } }` |
| `{ f: { $in : [...] } }` | `{ terms: { 'f.keyword': [...] } }` |
| `{ f: { $nin: [...] } }` | `must_not` + `terms` |
| `{ f: { $regex: 'x' } }` | `{ regexp: { 'f.keyword': 'x' } }` |
| `{ f: { $exists: true } }` | `{ exists: { field: 'f' } }` |
| `{ f: null }` | `must_not` + `exists` |
| `{ $and: [...] }` | `bool.filter` 数组 |
| `{ $or : [...] }` | `bool.should` + `minimum_should_match: 1` |
| `{ $not: {...} }` | `bool.must_not` |

- 不在上表的操作符、不在索引内的字段（`canSync: false` 或类型不可映射）：抛 `CrudErrno.PARAMS_INVALID`，附 `{ field }` / `{ operator }`。
- 字段位于 `nested` 路径下时，上表子句照常生成，再按 1.3 的规则按 path 归组并包裹 `nested`。
- `id` 参数（单个或数组）翻译为 `{ ids: { values: [...] } }`。
- 不加软删除条件：ES 里只有有效文档（见 1.1）；「已伪删但 ES 尚未同步」的滞后命中由回表 mongo 查询的软删除条件兜底（见 2.2）。
- `wd` 非空时追加 `{ match: { [fullText]: wd } }` 到 `must`（参与打分）；`wd` 为空则整个查询在 filter 上下文，不计分。

### 2.2 文档结构与返回

- ES 文档 `_id` 取 mongo `_id` 的字符串形式，`_source` 只含入索引字段（不含 `isDeleted` / `deletedAt`，合并字段已由 `_source.excludes` 排除，见 1.2）。
- **ES 只负责命中，文档一律回 mongo 取**：ES 查询设 `_source: false` 只取 `_id` 与 `_score`，再按这批 id 回 mongo 查完整文档，返回结构与 `Cradle.search` 完全一致。
  - 顺序以 ES 为准：mongo 用 `$in` 查回（不带 sort）后按 ES 命中顺序重排。
  - `cols` 直接作用于 mongo 查询，沿用 `Cradle` 的投影与 `select: false` 规则，不再做 `_source` 过滤。因此 `select: false` 的字段同步进 ES 可查、可排序，但不会出现在返回中。
  - ES 命中但 mongo 已无（索引滞后 / 已硬删）的 id 直接跳过，不补位、不影响 `count`。
  - 回 mongo 的这次查询照常带 `Cradle.getSoftDeleteCond()`，因此「已伪删但 ES 尚未同步」的滞后命中会被自然过滤掉，等同上一条的跳过。
  - `wd` 非空时把 `_score` 并入结果。
- 不提供来源开关：ES 索引里没有「只存不索引」的字段，本就不足以拼出完整文档，返回统一走 mongo 可避免两套返回形态；条件、排序、分页、计数一概仍由 ES 完成。

## 3. search 方法

### 请求

```json
{
    "method": "xxx.search",
    "params": {
        "wd"   : "关键词",                    // 可选，全文检索，只查合并字段 fullText
        "id"   : ["66b...a01"],              // 可选，单个或数组
        "find" : { "status": "active" },     // 可选，mongo 风格条件，翻译为 ES filter
        "cols" : { "username": 1 },          // 可选，投影，转交 mongo 查询
        "sort" : { "createdAt": -1 },        // 可选，排序；不传且有 wd 时按 _score 降序
        "start": 0,                          // 可选，from
        "limit": 20,                         // 可选，size；缺省 limitDef，超 limitMax 抛异常
        "mode" : "",                         // 可选，only-items,only-total,has-more
        "totalHits": 10000                   // 可选，true 或数字，对应 track_total_hits
    }
}
```

### 返回

```json
{
    "items": [
        { "_id": "66b...a01", "username": "alice", "status": "active", "_score": 3.2 }
    ],
    "total": 32,
    "totalRel": "eq"
}
```

### 规则

- `limitDef`（默认 1）、`limitMax`（默认 1000）沿用 `Cradle.search` 的既有语义与报错。
- `start + limit` 超过 ES `max_result_window`（默认 10000）时抛 `CrudErrno.PARAMS_INVALID`，附 `{ start, limit, window }`；深翻页留待后续（`search_after`）。
- `mode` 模式继续沿用既有语义。
- `totalHits`（仅对 `mode` 非 `'has-more'` 生效）：

| 值 | 含义 | 开销 |
|---|---|---|
| 未传 | 估算 | ES 默认方式 |
| `true` | 精确总数 | ES `total_hits: true` |
| 数字 `n` | 数到 `n` 即可提前终止 | ES `total_hits: n` 时显著更快 |

- `totalRel` 是 ES `hits.total.relation` 的原样透出：
  - `'eq'`：为精确值；
  - `'gte'`：命中数超过 `totalHits` 的上限，`total` 等于该上限，真实总数「至少这么多」。
  - `mode: 'has-more'` 的 `more: true | false` 表示有无更多，不带 `totalRel`。
- 调用方按 `totalRel` 决定展示：`'gte'` 时显示「10000+」之类，不可用于精确分页总页数。
- `totalHits` / `totalRel` / `_score` 均依托 `SearchParams` / `SearchResult` 既有的索引签名，`types.ts` 无需改动。

- `cols` 完全交由 mongo 处理（`Cradle` 的既有投影逻辑），ES 侧一律 `_source: false`。
- `sort` 中 text 字段自动改用 `.keyword` 子字段；字段不可排序（如 `text` 无 `keyword`）时抛 `PARAMS_INVALID`；nested 路径下的字段自动补 `nested: { path }` 与 `mode`（升 `min` / 降 `max`）。
- 回表只影响文档内容，条件 / 排序 / 分页 / 计数一概由 ES 完成；`mode: 'only-total'` 时无 items，不回表。

## 4. counts 方法

### 请求

```json
{
    "method": "xxx.counts",
    "params": {
        "wd"  : "关键词",                     // 可选，与 search 一致
        "find": { "status": "active" },       // 可选，基础过滤
        "cols": { "status": 1 },              // 可选，限定统计哪些字段
        "sels": { "status": ["active"] },     // 可选，已选值联动
        "top" : 10                            // 可选，每字段取前 N，默认 10；也可 { "status": 5 }
    }
}
```

### 返回

```json
{
    "counts": {
        "status": { "active": 28, "frozen": 5, "closed": 2 },
        "roles" : { "user": 32, "admin": 3 }
    },
    "total": 35
}
```

### 规则

- 统计目标 = 入索引且 `countable: true` 的字段，再经 `cols` 白/黑名单过滤（判定方式与 `Cradle.counts` 相同）。
- `sels` 联动语义与 `Cradle.counts` 完全一致：
  - 非空数组转为 `terms` 条件；空数组视为没选，不生成条件。
  - 已选字段统计自身时**不套用自己的** `sels` 条件（否则无法继续勾选该字段其他值）。
  - 其他字段套用全部 `sels` 条件，结果相互联动。
  - `total` = 应用 `find` + `wd` + **全部** `sels` 后的文档数（ES 里只有有效文档，无软删除条件，见 1.1）。
- 实现上**一次请求**完成（优于 mongo 版的多次 aggregate）：
  - `query` = `find` + `wd`（不含 `sels`）。
  - 每个统计字段一个 `filter` 聚合，其条件为「除自身外的所有 `sels`」，内嵌 `terms` 子聚合（`size` 取该字段的 `top`，`0` 表示不限则取 ES 上限约定值）。
  - 总数用一个额外的 `filter` 聚合（条件为全部 `sels`）的 `doc_count`。
- `terms` 聚合字段：text 用 `.keyword`，其余用本名；数组字段天然按元素分组。
- 统计 nested 路径下的字段时，`filter` 聚合内再套 `nested` + `terms` + `reverse_nested`，取 `reverse_nested` 的 `doc_count`；`sels` 中与被统计字段同 path 的条件下移到 `nested` 内部（详见 1.3）。
- 桶键统一 `String()` 化，与现有 `CountsResult` 的 `Record<string, number>` 对齐；`null`/缺失走 `missing` 桶时键为 `''`。

## 5. 同步

本期实现，否则无法测试。

### 5.1 方案选择：覆盖写入方法，而非 mongoose 钩子

不采用 mongoose 中间件（钩子）方案，原因：

- **注册时机脆弱**：中间件须在 model 编译前注册，而 `Cradle` 构造时即 `mongoose.model()`，顺序错了静默失效。
- **拿不到受影响文档**：`putAll` / `delAll` 走 `updateMany` / `deleteMany`，query 中间件的 post 只有 `modifiedCount`；硬删除时 post 阶段文档已不存在，只能 pre 先查 id 暂存到 this 再取出。
- **覆盖面无法穷尽**：需给 `save` / `updateMany` / `deleteMany` / `insertMany` / `findOneAndUpdate` / `bulkWrite` 逐个补钩子，漏一个即数据不一致。

而 `Cradle` 的写入方法里，受影响的文档是明确的：`add` 内部有新建的 doc、`set` 内部有查出的 doc、`putAll` / `delAll` 入参即 ids。故由 `Chaser` 覆盖 `add` / `set` / `putAll` / `delAll` 四个方法，同步本身分两层（见 5.2）：**文档同步**（拿到 doc 直接写 ES）与**查询同步**（按条件查出文档后转交文档同步）。

`create` / `update` / `delete` / `upsert` 内部只调 `add` / `set` / `delAll`，覆盖后自动获得同步能力；`setAll` 内部逐个调 `set`，亦随 `set` 的覆盖自动同步。

`Cradle.add` / `Cradle.set` 已返回元组（**已实现，无需改动**）：`add` 返回 `[ doc, id ]`，`set` 返回 `[ doc, count ]`（未命中时 doc 为 `null`），把内部已持有的 doc 一并交出，`Chaser` 免得复制一遍实现或多查一次 mongo；内部 `create` / `update` / `upsert` 调用点均已解构适配，对外的 `Crud` 接口返回结构不变。

- `add` / `set`：`super` 成功后 `syncDocs([ doc ])`，不再按 id 回查。
- `putAll`：`updateMany` 拿不到文档，`super` 后走 `syncFind({ _id: { $in: ids } })`。
- `delAll`：无论软删硬删，ES 侧的结果都是「没有这条」，故不必查 mongo，直接 `syncDels(ids)`。

```ts
// Chaser：四个写入方法均 super 后同步，esAutoSync 为 false 则跳过；setAll 逐个调 this.set，自动同步无需覆盖
async add(data) {
  const [ doc, id ] = await super.add(data);
  if (this.getAutoSync()) await this.syncDocs([ doc ]);
  return [ doc, id ];
}

async set(id, data) {
  const [ doc, count ] = await super.set(id, data);
  if (count && this.getAutoSync()) await this.syncDocs([ doc ]);
  return [ doc, count ];
}

async putAll(ids, data) {         // 无 doc，按 id 查询同步
  const count = await super.putAll(ids, data);
  if (count && this.getAutoSync()) await this.syncFind({ _id: { $in: ids } });
  return count;
}

async delAll(ids, data) {         // 删除无视 softDelete，ES 直接删
  const count = await super.delAll(ids, data);
  if (count && this.getAutoSync()) await this.syncDels(ids);
  return count;
}
```

- `delAll`：**无视 `softDelete`，ES 侧一律物理删除**（`syncDels(ids)`），不在 ES 里留 `isDeleted: true` 的文档。理由：ES 只服务于搜索与统计，已删文档留着只会白占索引、拖慢查询，还要在每个查询与聚合里叠 `isDeleted` 条件。
- 与之配套，**同步须判断 `isDeleted`**：判断放在唯一写入出口 `syncDocs` 里——按 `Cradle.getSoftDelete()` 给出的字段名读取 doc 上的删除标记，为真的转为 `delete` 动作，其余才 `index`（该字段本身不入索引，只用于分流）。查询同步（`syncFind`）遍历 mongo 时**不加** `getSoftDeleteCond()` 过滤（要能看到已删文档）、但要 `+isDeleted` 把这个 `select: false` 字段取回来，两类文档一并交给 `syncDocs` 即可。这样定时同步既补齐新增修改，也清掉期间被伪删除的记录；`set` 把删除标记改为真时也同样会从 ES 删除。
- 例外：Schema 中若存在既 `select: false` 又可同步的字段，`Cradle.set` 的 `findById` 拿不到该字段，此时 `Chaser.syncDocs` 检出 doc 不完整（`$__.selected` 有投影）便降级为 `syncFind({ _id: { $in: ids } })` 回查（回查时对这些字段补 `+field`）；`add` 的 doc 总是完整的，不受影响。

同步一律采用「**以 mongo 的最终文档为准 → ES `bulk index`**」，不把 `data` 增量 patch 进 ES：这样合并字段、nested 结构、默认值都由 mapping 自然重算，无需在两处维护字段变换逻辑。

`esAutoSync: false` 时上述自动同步全部跳过（四个覆盖方法都只调 `super`），改由定时任务分批 `syncFind` 补齐，适合批量导入、写多读少、或不愿在写入链路上挂 ES 依赖的场景；显式调用 `syncDocs` / `syncDels` / `syncFind` 不受该开关影响。

局限：绕过 `Chaser` 直接用 Model 写入的不会同步，由定时 `syncFind` 兜底。

### 5.2 索引与同步方法

同步分两层，上层查询、下层写入，避免「查到文档还要再按 id 查一遍」；每层只留一个方法，不做多余的入参变形封装：

```ts
class Chaser extends Cradle {
  /** 按 getMapping() 建索引；force 时先删后建 */
  initIndex(force?: boolean): Promise<void>;
  /** 删除索引 */
  dropIndex(): Promise<void>;
  /** 与索引现有 mapping 做 diff，增量 put 新增字段（不改既有定义），见 1.4 */
  pushMapping(): Promise<string[]>;

  /* ---------- 文档同步（底层，不查 mongo） ---------- */

  /**
   * 文档 → ES bulk，逐个按 mapping 取入索引字段，拼装合并字段（getFullText），并把同步戳置为当前时间
   * 删除标记为真的转为 delete 动作，与 index 动作拼在同一个 bulk 里
   */
  syncDocs(docs: any[], opts?: SyncOpts): Promise<SyncStat>;
  /** 按 id 从 ES 删除（bulk delete），无视 softDelete，供 delAll 用（无需查 doc） */
  syncDels(ids : string[], opts?: SyncOpts): Promise<SyncStat>;

  /* ---------- 查询同步（上层，查 mongo 后转文档同步） ---------- */

  /**
   * 按条件游标遍历 mongo（不排除伪删除），攒批交给 syncDocs
   * 不传 find 即全量，且默认在结束后按同步戳水位补一次 syncCull（见下）
   */
  syncFind(find?: Record<string, any>, opts?: SyncFindOpts): Promise<SyncStat>;
  /** 删除同步戳早于水位的 ES 文档（一条 delete_by_query），清理 mongo 已不存在的记录 */
  syncCull(opts?: SyncCullOpts): Promise<SyncStat>;
}

interface SyncOpts {
  refresh?: boolean | 'wait_for';   // 默认 false，测试或写后即读时传 'wait_for'
}

interface SyncFindOpts extends SyncOpts {
  batch?: number;                   // 每批文档数，默认 1000
}

interface SyncCullOpts extends SyncOpts {
  since : Date;                     // 水位，删除同步戳早于此时间的文档，必传
}

interface SyncStat {
  total  : number;   // 扫描到的文档数
  indexed: number;   // 成功写入数
  deleted: number;   // 删除数
  failed : number;   // 失败数
  errors : any[];    // 失败明细（截断保留前 N 条）
}
```

方法收敛的理由：

- `syncIds(ids)` 就是 `syncFind({ _id: { $in: ids } })`，`syncAll(opts)` 就是 `syncFind()` 或 `syncFind({ updatedAt: { $gte } })`，都只是入参变形，不单独提供；调用处直接写条件更直白，也不必约定「`since` 为数字表示相对毫秒」这类隐含语义。
- `syncCull` 的数据流是反的（以 ES 为准清理，不读 mongo），塞进 `syncFind` 语义混乱，独立成方法，它也是 5.4 遗留问题的兜底工具。
- `syncDocs` / `syncDels` 已是批量，`add` / `set` 传 `[ doc ]` 即可，不再封装单文档的 `syncDoc` / `syncDel`。

分层的必要性：

- `syncDocs` 是唯一的 ES 写入出口，「doc → ES 文档」的字段裁剪、nested 结构、合并字段拼装（`getFullText`）、同步戳以及 `isDeleted` 转删只在这一处实现。
- `add` / `set` 已持有 doc，直接 `syncDocs`，省掉一次 mongo 往返；`putAll` 与定时任务只有条件或 id，走 `syncFind` 查出文档后落到同一出口；`delAll` 结果确定，只需 id，直接走 `syncDels`。
- 查询同步用游标 + `batch` 分批，文档量大时内存可控；`syncDocs` 只管一批，职责单一。

**遍历与提交方式：游标逐个取、攒批提交 bulk**，不用「分页逐页查」也不用「逐个原子写」：

- 用 mongoose `cursor()` 逐个 yield，内存里攒到 `batch` 条 flush 一次 `syncDocs`，结束时 flush 余量。不用 `skip` / `limit` 分页：大偏移量在 mongo 上越翻越慢，且期间数据变动会漏记录。
- 不逐个写 ES：ES 本就没有跨文档事务，逐个 `index` 并不比 `bulk` 更「原子」——`bulk` 的每个 action 独立成败，响应 `items[]` 里逐项返回 error，失败粒度与逐个调用完全一致，但省掉每文档一次 HTTP 往返，万级文档的吞吐差一个数量级。
- `syncDocs` 内部把 `index` 与 `delete` 两种 action 拼进同一个 `bulk` 请求，一次往返完成，不再回调 `syncDels`。

**同步戳（`esSyncTime`，默认 `syncTime`）与孤立记录清理**：

`syncDocs` 每次写入都把该字段置为当前时间，于是全量同步跑完之后，「ES 里同步戳早于水位 T 的文档」等价于「本轮全量同步没碰过的文档」，也就必然是 mongo 里已经不存在的孤立记录。据此：

- **`syncCull({ since: T })` 只需一条 `delete_by_query { range: { [esSyncTime]: { lt: T } } }`**（含该字段不存在的文档），不必拉取 ES 全部 `_id`、不必回 mongo 比对、不必维护分批状态机，也没有「读 ES 与查 mongo 之间的时间窗内数据变动导致误删」的竞态——水位由 T 明确界定，且 T 取全量同步**开始前**的时刻，天然带安全余量。
- **`syncFind()` 不传条件时**：先记 `T = now`，再以 mongo 游标扫全量（与带条件时同一套逻辑），结束后补一次 `syncCull({ since: T })` 收尾。这样一趟同时完成「补齐 / 覆盖」与「清理孤立记录」，且**无空窗**（不需要 `initIndex(true)` 先清空）。
- 全量必须以 **mongo 为遍历源**，不能反过来遍历 ES 的同步戳：ES 里压根没有的文档（新增未同步、`esAutoSync: false` 期间写入、上次同步失败）不在 ES 索引中，从 ES 侧无从发现，只有扫 mongo 才能补齐。同步戳的作用只是「反向标记谁没被碰过」，供 syncCull 用。
- 传了 `find` 的增量同步不做 syncCull：它只覆盖部分文档，水位对未覆盖的部分不成立，跑 syncCull 会删掉正常数据。

`syncFind` 可直接被业务当作补偿工具与定时任务用：

```ts
// 只同步某机构下的数据
await userCrud.syncFind({ orgId: '66b...a01' });

// 每天同步「最近 25 小时」的变更，相邻两天有 1 小时重叠，消除时间误差与临界遗漏
await userCrud.syncFind({ updatedAt: { $gte: new Date(Date.now() - 25 * 3600e3) } });

// 全量刷新：扫 mongo 全量覆盖 ES，收尾按同步戳水位清掉孤立记录，无空窗
await userCrud.syncFind();

// 只清理不刷新（明确知道水位时）
await userCrud.syncCull({ since: lastSyncStartAt });

// 改过字段类型 / 分词，只能重建（有空窗）
await userCrud.initIndex(true);
await userCrud.syncFind();
```

规则：

- 增量同步依赖 `timestamps` 的 `updatedAt` 做水位，由调用方自行拼条件；Schema 未启用 `timestamps` 时只能全量。
- 查询同步的 mongo 查询自动对「`select: false` 但可同步」的字段补 `+field`，保证 ES 侧字段完整。
- 重复同步是幂等的（`bulk index` 按 `_id` 整体覆盖，`bulk delete` 对不存在的 id 也不报错），故重叠区间安全。
- 伪删除的文档从 ES 物理删除，ES 中只留有效文档；查询同步不加 `getSoftDeleteCond()` 过滤而是 `+isDeleted` 取回标记，靠 `syncDocs` 内的判断分流。`isDeleted` / `deletedAt` 都不入索引。
- 全量 `syncFind()` 要扫 mongo 全部文档并全量重写 ES，成本远高于增量，百万级可每天跑、千万级建议低峰期每天一次、亿级建议每周或按段切分；不要与增量同步混在一个定时任务里。收尾的 `syncCull` 只是一条 `delete_by_query`，相比之下可忽略。
- 单独调 `syncCull` 必须传 `since`，且该时刻要早于最近一次覆盖全量的同步的开始时间，否则会删掉正常数据；不提供默认值就是为了避免误用。
- 不引入队列与重试机制：失败明细记入 `SyncStat.errors`，由下一次定时 `syncFind` 自然补偿。注意失败的文档同步戳没被刷新，若紧接着跑 `syncCull` 会被误删，故失败数不为 0 时应跳过 syncCull（`syncFind()` 内部即按此处理）。

### 5.3 refresh 与失败处理

- 写入默认 `refresh: false`，靠 ES 自动刷新（约 1s）；同步方法的 `opts.refresh` 可设为 `'wait_for'` 用于写后即读，测试中使用该选项。
- ES 同步失败**不回滚、不影响 `create` / `update` / `delete` 的返回值**（mongo 是权威数据源），仅告警：走 Schema 选项 `esSyncError`，缺省 `console.error`。

### 5.4 遗留问题（本期只记录，不实现）

**未启用 `softDelete` 且 `esAutoSync: false` 时，ES 中的已删记录无法被定时同步清理。**

原因：硬删除后 mongo 里没有任何痕迹，定时同步只能扫到「还活着的文档」，无从得知哪些 id 已经消失；`esAutoSync: false` 又意味着 `delAll` 当时也没有通知 ES。此时唯一的兜底是「全量 `syncFind()` + 同步戳水位 `syncCull`」，它虽然可靠且无空窗，但要扫 mongo 全量并重写整个索引，不适合频繁执行。

可选的后续方案（留待以后评估）：

- 记录删除日志（另开一个 `deletedIds` 集合或 capped collection），定时任务读日志转 `syncDels` 后清理日志；
- 借 MongoDB Change Stream 订阅 `delete` 事件；
- 约定「要用 `Chaser` 就启用 `softDelete`」，或在未启用 `softDelete` 时强制 `delAll` 同步删除 ES（即让 `esAutoSync: false` 对删除不生效）。

本期的实际约束：**`esAutoSync: false` 适用于启用了 `softDelete` 的 Schema**；未启用时如需关闭自动同步，只能靠低频的全量 `syncFind()` 兜底。

## 6. 实施步骤

已随先前重构完成、不再列入的项：`crud/src/types.ts` 的 `SearchParams` / `CountsParams` 已有 `wd?: string`；`Cradle.add` / `Cradle.set` 已返回元组 `[ doc, id ]` / `[ doc, count ]`，内部 `create` / `update` / `upsert` 调用点均已解构适配，对外 `Crud` 接口不变。下表按依赖顺序分五个阶段：一确立入口与类型，二至四实现本体（二是三、四的地基，三与四相互独立可并行），五收尾；「要点」只记关键约束，细节以所注章节为准。

| 阶段 | # | 任务 | 要点 | 文件 | 验收 |
|---|---|---|---|---|---|
| 一 骨架与依赖 | 1 | 依赖与入口隔离 | `package.json`：`exports` 由字符串改为对象，拆 `.` 与 `./search` 两入口并各带 `types`，加 `typesVersions` 兜底 `node10`；`@elastic/elasticsearch` 进 peer（`peerDependenciesMeta.optional: true`）与 dev 依赖，加 `test:chaser` 脚本。`crud/src/index.ts` 不导出 `search`（`search/index.ts` 内 `export * from './types'`，自成入口）；`tsconfig.json` 无需改动（`rootDir: ./src` 自动把 `src/search/**` 编译进 `dist/search/`）。见 0 节。 | `crud/package.json` | 不装 ES 客户端且不用 `search` 的使用方，安装 / 类型检查 / 打包三环节均不受影响；`hongs-crud/search` 可正常解析。 |
| 一 骨架与依赖 | 2 | 类型与扩展点声明 | `search/types.ts`：`SyncOpts` / `SyncFindOpts` / `SyncCullOpts` / `SyncStat`，及 Schema 扩展选项、字段扩展项的类型声明。`crud/src/types.ts`：仅在扩展点文档注释补字段级 `canSync` / `canText` / `nested` / `analyzer` 与 Schema 级 `esIndex` / `esFullText` / `esSyncTime` / `esAnalyzer` / `esAutoSync` / `esSyncError`；`wd` 已在位，类型定义不动。见 1.1。 | `crud/src/search/types.ts`、`crud/src/types.ts` | `tsc` 通过；主类型文件无 ES 具体类型外溢。 |
| 二 Chaser 与 mapping | 3 | Chaser 骨架与客户端 | `Chaser extends Cradle`：构造 `(schema, model?, es?)`，特殊选项一律读 Schema 扩展选项；`getClient` / `getIndex`（`esIndex || collection`）；全局客户端注册 `setEsClient` / `getEsClient`。见 2 节。 | `crud/src/search/index.ts` | 构造期不触达 ES；未注入 `es` 时取全局注册，缺失抛 `INTERNEL_ERROR`。 |
| 二 Chaser 与 mapping | 4 | mapping 推导与字段清单 | 默认全字段，仅排除 `canSync: false` 与不可映射类型（如 `Map`）；object / nested 递归（见 1.3）；根级与所有 object / nested 一律 `dynamic: 'strict'`；`text` 分词器按「字段级 `analyzer` > Schema 级 `esAnalyzer` > 不设」；合并字段 `esFullText`（`{ type: 'text' }`，不用 `copy_to`，并加 `_source: { excludes: [ esFullText ] }`）与同步戳字段 `esSyncTime`（`type: 'date'`）入 mapping。推导阶段一并产出 `getSyncable()` / `getTextable()`（入索引的 `text` 字段再排除 `canText: false`）/ `getCountable()` / `getNestedPaths()` 与 `getFullText(doc)` 默认实现（按 `getTextable()` 取值、扁平化数组、去空去重后 `join(' ')`，`protected` 供子类覆盖追加标签等派生文本）。见 1.2。 | `crud/src/search/index.ts` | 对含 nested / 扁平数组 / `select: false` 字段的典型 Schema，mapping 与字段清单符合 1.2 / 1.3 的约定。 |
| 二 Chaser 与 mapping | 5 | 索引管理 | `initIndex`（按 `getMapping()` 建索引，`force` 先删后建；索引按需惰性建立，见 0 节）/ `dropIndex` / `pushMapping`（与索引现有 mapping 做 diff，只 `putMapping` 新增字段，返回新增字段名数组）。见 1.4。 | `crud/src/search/index.ts` | `initIndex` 幂等；`pushMapping` 不改既有字段定义。 |
| 三 查询 | 6 | find -> DSL 翻译器 | `find` 条件翻译与 `wd` 处理（`wd` 追加 `match` 到 `must` 参与打分），含 nested 同 path 归组合并；覆盖 2.1 对照表全部写法。 | `crud/src/search/index.ts` | 2.1 对照表各写法翻出的 DSL 语义等价；不支持的操作符 / 字段抛 `PARAMS_INVALID`。 |
| 三 查询 | 7 | search 覆盖 | `sort`（含 nested 排序）/ 分页 / 四种 `mode` 模式；ES 侧 `_source: false` 只取 id 与 `_score`，命中 id 一律回 mongo 取文档并按 ES 顺序重排，`cols` 交 mongo 处理。见 3 节、2.2。 | `crud/src/search/index.ts` | 四种 `mode`、排序、分页、`total` / `more` 行为与 mongo 版一致；`wd` 命中合并字段。 |
| 三 查询 | 8 | counts 覆盖 | 单请求 filter + terms 聚合，nested 走 `reverse_nested`。见 4 节。 | `crud/src/search/index.ts` | 结果与 mongo 版一致；一次请求完成全部字段统计。 |
| 四 同步 | 9 | 文档同步 | `syncDocs`：唯一 ES 写入出口，逐个读删除标记分流（为真转 delete 动作），`index` 与 `delete` 两种动作拼进同一个 bulk；`index` 时调 `getFullText(doc)` 填合并字段、把同步戳置为当前时间。`syncDels`：按 id 的 bulk delete，无需查 doc。refresh 与失败处理见 5.3。 | `crud/src/search/index.ts` | 伪删文档写入即转 delete；bulk 失败逐项计入 `SyncStat` 并按 `esSyncError` 处理。 |
| 四 同步 | 10 | 查询同步与清理 | `syncFind`：mongo 游标逐个取、攒够 `batch` 条 flush 一次 `syncDocs`；不排除伪删除（`+isDeleted` 取回标记）；不传 `find` 即全量，先记水位 `T = now`，结束后若无失败则补一次 `syncCull({ since: T })`。`syncCull`：一条 `delete_by_query { range: { [esSyncTime]: { lt: since } } }`，删除同步戳早于水位的孤立记录，`since` 必传。见 5.2。 | `crud/src/search/index.ts` | 全量 `syncFind()` 一趟完成补齐与清理且无空窗；`syncCull` 不传 `since` 报错；游标攒批内存平稳。 |
| 四 同步 | 11 | 写入覆盖 | 覆盖 `add` / `set` / `putAll` / `delAll`（`setAll` 内部逐个调 `set`，随 `set` 自动同步，无需覆盖；`create` / `update` / `delete` / `upsert` 内部只调被覆盖方法，亦自动获得同步）：`add` / `set` super 后 `syncDocs([ doc ])`，doc 不完整（`select: false` 投影）则降级 `syncFind` 回查；`putAll` super 后 `syncFind({ _id: { $in: ids } })`；`delAll` super 后 `syncDels(ids)`，无视 `softDelete`。四者的自动同步均受 `esAutoSync` 控制。见 5.1。 | `crud/src/search/index.ts` | `esAutoSync: false` 时四方法只调 `super` 不触 ES；`setAll` / `create` / `update` / `upsert` 无需单独处理即同步。 |
| 五 测试与文档 | 12 | 基础测试 | 前置本地 MongoDB 与 ES；`initIndex` -> 经 `Chaser` 增改删（`refresh: 'wait_for'`）-> `search` / `counts` 校验；含扁平数组子文档与 nested 两组对照用例、`syncDocs` 直接文档同步与 `syncFind` 条件同步用例、伪删除后 ES 查不到的用例、`esAutoSync: false` 时写入不自动同步（`search` 查不到）再由 `syncFind()` 补齐（含伪删除记录被清掉）的用例。 | `crud/test/chaser.ts` | 本组用例全过（`npm run test:chaser`）。 |
| 五 测试与文档 | 13 | 查询与 mapping 进阶测试 | `canSync: false` 字段不可查用例、`select: false` 字段可查且照常返回用例、全文用例（默认 `getFullText` 拼接后 `wd` 能命中各文本字段含 nested 子文档内的文本；`canText: false` 的字段 `wd` 查不到但仍可 `find` 精确查；子类覆盖 `getFullText` 追加码值标签后 `wd` 用标签能命中；改完 `getFullText` 只跑 `syncFind()` 即生效，不重建索引）、`pushMapping()` 增量推送用例（Schema 加字段后返回新增字段名、旧字段定义不变、`syncFind()` 回填后新字段可查）、`dynamic: 'strict'` 用例（未在 mapping 中声明的字段直接写 ES 报错）、分词器用例（`esAnalyzer` 与字段级 `analyzer` 落到 mapping 上，非 `text` 字段标 `analyzer` 构造报错；分词插件视环境可选跳过）。 | `crud/test/chaser.ts` | 本组用例全过。 |
| 五 测试与文档 | 14 | 同步进阶测试 | `syncFind` 增量区间（`updatedAt` 水位）用例、同步戳水位用例（直接往 ES 塞一条 mongo 不存在的孤立记录，`syncFind()` 后被清掉；单独 `syncCull({ since })` 按水位删除；`syncCull` 不传 `since` 报错）、`initIndex(true) + syncFind()` 全量重建用例。 | `crud/test/chaser.ts` | 本组用例全过。 |
| 五 测试与文档 | 15 | README 增补 | 字段级 `canSync` / `canText` / `nested` / `analyzer` 与 Schema 级 `es*` 扩展选项（含 `esFullText` / `esSyncTime` 及其「仅供组件内部使用、不可在 `find` / `sort` / `counts` 中引用」的说明，以及 `esAnalyzer` 与字段级 `analyzer` 的覆盖关系、需自行安装分词插件、改分词器要重建索引）；`getFullText(doc)` 的说明（默认按文本字段清单拼接、不用 `copy_to`；`canText: false` 排除某字段；子类覆盖以追加码值标签 / 关联名称等派生文本的示例；改实现后只需 `syncFind()`）；`Chaser` 用法（**从 subpath 引入**：`import { Chaser } from 'hongs-crud/search'`，`new Chaser(schema, model?, es?)`；主入口 `hongs-crud` 不含 `search`，用不到搜索的项目无需安装 `@elastic/elasticsearch`，安装 / 类型检查 / 打包三环节均不受影响）；`esAutoSync` 与定时同步示例；1.4 的 Schema 变更流程（加字段走 `pushMapping()` + `syncFind()`，删字段只需 `syncFind()` 覆盖旧值，改类型 / 分词才 `initIndex(true) + syncFind()`）；返回文档一律来自 mongo、删除无视 `softDelete`（ES 只留有效文档）、扁平模式下跨字段条件的限制、`select: false` 默认同步的说明。 | `crud/README.md` | 文档与实现一致，无过期描述。 |

## 7. 已确认的取舍

- 代码放 `crud/src/search/` 目录：`search/index.ts` 写 `Chaser` 及相关方法，`search/types.ts` 放本组件类型；`crud/src/types.ts` 不放 ES 相关类型（`wd?: string` 已在 `SearchParams` / `CountsParams` 中）。
- `search` 走 subpath 独立导出（`hongs-crud/search`），主入口 `crud/src/index.ts` 不 `export * from './search'`：这样「不用 `search` 就完全不依赖 ES」在三个环节都成立——安装（`peerDependenciesMeta.optional: true`，不装不报错）、类型检查（不 `import 'hongs-crud/search'` 就不会加载 `dist/search/index.d.ts`，与使用方是否 `skipLibCheck` 无关）、打包（`search` 内对客户端只用 `import type`，产物零引用，无 `module not found` 与告警）。代价仅是引入路径要写 `hongs-crud/search`。见 0 节「依赖隔离」。
- 索引范围默认全同步，只有 `canSync: false` 的字段不同步。
- `select: false` 的字段默认照常同步进 ES（可查、不可显示）；确实不该入索引的（如密码）显式加 `canSync: false`。
- 合并搜索字段名默认 `fullText`，由 Schema 选项 `esFullText` 可覆盖。
- 合并字段的内容一律由 `getFullText(doc)` 自行拼装后随文档写入，**不用 ES 的 `copy_to`**，也不提供二选一开关：`copy_to` 只能拷字段原始值（`status: 1` 拷进去就是 `"1"`，搜不到「已发布」），而码值转标签 / 关联 id 转名称这类派生文本是必需能力，`copy_to` 只是它的真子集；改全文内容只需 `syncFind()` 覆盖一遍（改 `copy_to` 属改已有字段定义，得 `initIndex(true)` 重建、有空窗）；nested 内文本可直接扁平化进根级全文，不受 `copy_to` 只能拷向祖先的约束；全文内容是可打印的字符串，便于排查。默认实现按「入索引的 `text` 字段再排除 `canText: false`」取值拼接，`protected` 供子类覆盖；合并字段加 `_source: { excludes: [ esFullText ] }`，不占 `_source` 空间。见 1.2。
- 分词器两级可配：Schema 选项 `esAnalyzer` 定索引默认，字段扩展项 `analyzer` 就近覆盖，都不设则用 ES 的 `standard`；只对 `text` 生效，标在非 `text` 字段上视为配置矛盾。`wd` 的分词只由合并字段（取 `esAnalyzer`）决定，因为 `getFullText()` 拼进去的是原始文本，源字段各自的 `analyzer` 不影响 `wd`。不开放 `search_analyzer`，组件也不负责安装分词插件（未安装则建索引时由 ES 报错）。
- `search` / `counts` 的 ES 侧一律 `_source: false`，返回文档统一回 mongo 取，不提供来源开关。
- 同步分两层：文档同步（`syncDocs` / `syncDels`）是唯一 ES 写入出口，查询同步（`syncFind` / `syncCull`）查到文档后转文档同步。`syncDocs` 传数组即可，不额外封装单文档方法；`syncDels` 只需 id，供 `delAll` 直接使用；不再提供 `syncIds` / `syncAll`（分别就是 `syncFind({ _id: { $in: ids } })` 与 `syncFind({})`）。
- `syncFind` 用 mongo 游标逐个取、攒批提交 bulk，不用 skip/limit 分页（大偏移越翻越慢、期间数据变动会漏），也不逐个原子写 ES（ES 无跨文档事务，bulk 的失败粒度与逐个写一致，却省掉每文档一次往返）。
- `Cradle.add` 返回 `[ doc, id ]`、`Cradle.set` 返回 `[ doc, count ]`（**已实现**）：`Chaser` 覆盖 `add` / `set` / `putAll` / `delAll` 四个写入方法（`setAll` 内部逐个调 `set`，随 `set` 的覆盖自动同步，无需覆盖），super 后解构即得 doc，既不用复制 `Cradle` 的实现，也不用为拿 doc 再查一次 mongo；内部调用点已解构适配，对外 `Crud` 接口返回结构不变。
- 索引里额外写一个同步戳字段（Schema 选项 `esSyncTime`，默认 `syncTime`，`type: 'date'`）：由 `syncDocs` 每次写入时置为当前时间，不并入合并字段，也不开放给 `find` / `sort` / `counts` 引用，只服务于同步机制。
- mapping 根级与所有 object / nested 一律 `dynamic: 'strict'`：宁可「写入即失败」，也不让漏推的 mapping 被 ES 自动推导静默兜住（类型一旦推歪只能重建索引）。
- Schema 加字段用 `pushMapping()` 增量推送（diff 后只 `putMapping` 新增字段，不动既有定义），再 `syncFind()` 回填数据；删字段无需动 mapping（ES 也删不掉字段定义），`syncFind()` 的整文档覆盖即可清掉旧值；改 `getFullText()` 的实现或某字段的 `canText` 不动 mapping，同样只需 `syncFind()`；只有改已有字段的类型 / 分词才退回有空窗的 `initIndex(true) + syncFind()`。见 1.4。
- `syncCull({ since })` 用同步戳水位实现：一条 `delete_by_query { range: { [esSyncTime]: { lt: since } } }` 删掉「本轮全量同步没碰过」的孤立记录，不必拉 ES 全部 `_id` 与 mongo 比对，也没有读 ES 与查 mongo 之间的竞态。`since` 必传，不给默认值以免误用。
- 全量同步仍以 mongo 游标为遍历源（不用「从 ES 查同步戳落后的 id」驱动）：ES 里压根不存在的文档从 ES 侧无从发现。`syncFind()` 不传条件时先记水位 `T = now`，扫完全量后补 `syncCull({ since: T })`，一趟完成补齐与清理且无空窗。
- `esAutoSync` 默认 `true`；设为 `false` 时增改删不触发自动同步，改由定时 `syncFind` 分批补齐。
- 删除无视 `softDelete`：ES 侧一律物理删除，索引中只保留有效文档，`isDeleted` / `deletedAt` 不入索引、查询不带排除条件；同步时由 `syncDocs` 读删除标记分流，为真的转成 bulk 的 `delete` 动作。
- 遗留问题（见 5.4，本期不实现）：未启用 `softDelete` 又 `esAutoSync: false` 时，硬删除的记录只能靠低频的全量 `syncFind()`（含收尾的水位 `syncCull`）兜底。
- 构造签名为 `new Chaser(schema, model?, es?)`：只在 `Cradle` 的 `model` 后加 `es`，其余特殊选项一律走 Schema 扩展选项（`esIndex` / `esFullText` / `esSyncTime` / `esAnalyzer` / `esAutoSync` / `esSyncError`）。
- 深翻页（`search_after`）不在本期范围，`start + limit` 超 `max_result_window` 直接报错。
