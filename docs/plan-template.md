# hongs-template 模板引擎子项目计划

> 状态：**已实施**（`npm run check` / `npm test` / `npm run build` 通过，139 项测试；`npm pack --dry-run` 校验通过）。
>
> 参考实现：[Template.java](https://github.com/ihongs/HongsCORE/blob/master/hongs-serv/src/main/java/io/github/ihongs/util/Template.java)（配套 [Synt.java](https://github.com/ihongs/HongsCORE/blob/master/hongs-core/src/main/java/io/github/ihongs/util/Synt.java)、[Syno.java](https://github.com/ihongs/HongsCORE/blob/master/hongs-core/src/main/java/io/github/ihongs/util/Syno.java)）。
>
> 位置：`template/`，独立 npm 包；本期**不接入** `crud` / `crud-api` / `crud-admin`，仅作为可复用库与测试。

---

## 1. 目标与非目标

### 目标

1. TypeScript 实现 Jinja 风格极简模板：`{{}}` 输出、`{%if/for/set/include%}` 指令、`{#..#}` 注释。
2. **表达式直接使用 JavaScript 语法**，编译期用 `new Function` 预编译，不再自实现表达式解析器。
3. **函数与数据同池**：全局对象 `GLOBAL` 预置基础函数（也可放默认变量），`render(data)` 时先查 data，未命中再回退 `globalData`（默认 `GLOBAL`）。
4. 基础目录 `baseDir` 可选，安全的 `rootDir` 可选；`include` 在编译期解析并递归编译。
5. 独占一行的指令/注释整行移除，不产生空行，不影响 markdown 段落。
6. **表达式只能访问 render 数据与 `globalData`**，不穿透到宿主全局。

### 设计原则

- **极简**：不自研表达式解析器，能直接用 JS 就交给 JS；结构解析与渲染路径尽量短，行为可预期。
- **易排错**：`TemplateError` 带 `line` / `file`；语法错误尽量在 `compile` 期暴露。
- **安全交给开发者**：表达式只暴露 render 数据与 `globalData`（D4），但这不是完整沙箱；需要渲染用户自定义模板时，可选用 §10 的预检（低优先级）。

### 非目标

- ❌ 沙箱：只做表达式标识符级隔离（见 D4），不做深层对象沙箱；模板与数据仍应视为可信，用户自定义模板见 §10。
- ❌ 自研表达式语法（运算符优先级、转义、JSON 字面量等全部交给 JS）。
- ❌ 移植 `compileByName`、`"!/"` classpath 资源、`SERVER_PATH` / `SERVER_HREF` 等 Java Web 概念。
- ❌ 异步渲染 / 异步 IO：`include` 编译期同步读文件，`render` 为同步执行。
- ❌ 模板继承 / 宏 / filter 管道（参考实现也没有）。

---

## 2. 关键设计

### D1 `GLOBAL`：函数与变量同池

```ts
/** 模板全局对象：预置基础函数；进程内共享、可写 */
export const GLOBAL: Record<string, any> = {
  $format, $formatDate, $indent, $range, $count, $isValid, $isObject,
};
```

- `render(data)` 时不做 globalData 合并，采用**双层查找**：

```ts
// 只浅拷贝 render 数据（避免 set 改动调用方对象），不拷贝 globalData
const renderData = { ...(data || {}) };
// 标识符：先查 renderData（含循环子作用域链），未命中再查 globalData
```

- `compile(source, { globalData })` 可指定该模板使用的全局数据，默认 `GLOBAL`；便于开发者封装/裁剪自己的全局对象。
- `globalData` 是普通对象引用，编译后再改也会实时生效；`{%set%}` 只写 render 数据，不修改 `globalData` / `GLOBAL`。
- 只做**顶层遮蔽**、不深合并：`renderData.abc` 存在时 `globalData.abc` 整体不可见。

- 表达式里的 `this` 是 `scope` 的代理视图（`with (this)`，见 D4），可直接写 `this.user.name`。
- 函数内部的 `this` 按 JS 调用规则走，**不保证**指向 render 数据；函数需要数据时用参数，或把函数放进数据后以 `this.fn(...)` 方式调用。函数可以嵌套在对象里（如 `tools.upper`），不做递归绑定。
- 不再有 `FUNCS`、`regist()`、`assign()`、`setTimeZone()`、`CURR_DATA`、`BASE_HREF`、`TIME_ZONE`。
- 调用方可直接往 `GLOBAL` 里加函数或默认变量（进程级），也可在 `render` 数据里临时覆盖同名项。
- 不深合并：只按顶层键遮蔽，嵌套值需要整体提供。

### D2 基础目录与安全根目录

```ts
compile(source)                                       // 无 baseDir：出现 include 即抛错
compile(source, { baseDir: 'dir' })                   // 当前模板目录
compile(source, { baseDir: 'dir', rootDir: 'root' })  // 安全根目录
compileFile('a/b.tpl')                                // baseDir = dirname(file)
compileFile('a/b.tpl', { baseDir: 'c', rootDir: 'd' }) // 可覆盖默认值
```

- `baseDir`：当前模板所在目录，`include` 相对它解析；可选。`compileFile` 默认取文件目录，可通过 options 覆盖。
- `rootDir`：安全根目录，可选，**默认等于（最终的）`baseDir`**；`compileFile` 同样可显式指定。`include` 解析结果越界时抛 `TemplateError`。
- 越界判断用规范化后的 `path.relative`（不用字符串前缀，避免 `/root2` 绕过）；不做 `realpath` / 符号链接处理，由开发者自行保证目录安全。
- 嵌套 `include`：子模板 `baseDir` = 实际文件所在目录，`rootDir` 与 `globalData` 继承自编译入口。
- Node 内置模块（`fs` / `path`）**惰性加载**：非 Node 环境 `import` 本库不会失败，只有 `compileFile` / `include` 真正用到时才报错；`$format` 为纯 JS，多端一致。
- 基础目录缺失 / 文件不存在 / 越界，均在**编译期**抛 `TemplateError`，错误带行号与（子）模板路径。

### D3 render 前预编译

`compile()` 一次性完成：

1. 解析模板结构 → Block AST（文本 / 变量 / set / if / for / include）；**表达式本身不做任何词法/语法解析**。
2. 每个表达式编译为求值函数（等价 eval，但编译期完成一次），`this` 即当前作用域：

```ts
const fn = new Function(
  'with (this) { return (' + expr + '); }'
);

// render 期：view 见 D4
fn.call(view);
```

- 裸标识符 `{{title}}` 由 `with (this)` 解析；`{{this.title}}`、`{{this['x-y']}}` 也可用；
- 表达式内的箭头函数会捕获这个 `this`，如 `items.map(x => x + this.suffix)`；
- 函数内部 `this` 不做绑定，按 JS 调用规则处理；`$formatDate` 的时区由第三个参数显式传入。

不用“把数据键展开成函数参数”的原因：

- 键在 render 期才确定，compile 期拿不到，等于每次 render 重新生成函数，或按“表达式 + 键集合”缓存，键变化即失效；
- 键不一定是合法标识符（如 `foo-bar`），直接拼参数会 SyntaxError；
- 键很多时参数列表膨胀，`with` 没有这个问题。

3. `include` 递归读取并编译子模板。

`render()` 只做：创建作用域视图 → 遍历 AST → 调用预编译函数。无字符串解析、无文件 IO；同一 `Template` 可重复渲染且状态互不共享。

> 安全性说明：`with` + `new Function` 需要非严格模式；表达式标识符与 `this` 的原型访问受 D4 限制，但嵌套对象仍可能被用来构造逃逸，安全最终由开发者负责（参见 §10 的安全预检，低优先级）。

### D4 表达式只访问 render 数据与 globalData

用 `Proxy` 包一层作用域视图 `view`，再作为 `with (this)` 的 `this` 传入：

```ts
const view = new Proxy(data, {
  has: () => true,                 // 所有标识符都走 view，不再落到宿主全局
  get(data, key) {
    if (key === Symbol.unscopables) return undefined;
    const local = findKey(data, key);        // renderData 作用域链
    if (local.found) return local.value;
    const global = findKey(globalData, key); // 未命中再回退 globalData
    return global.found ? global.value : undefined;
  },
  set(data, key, value) {
    data[key] = value;             // 表达式内赋值只写 renderData
    return true;
  },
});
```

- `findKey` 只沿对象原型链查自有属性，到 `Object.prototype` 为止，避免 `toString` / `constructor` 被误取。
- `process`、`require`、`globalThis`、`global` 等宿主标识符一律解析为 `undefined`，不会穿透。
- 未命中的普通变量也返回 `undefined`（不抛 `ReferenceError`），便于模板写可选数据。
- 顶层遮蔽、不深合并：`data.abc` 存在时 `globalData.abc` 整体不可见。
- `GLOBAL` 显式预置常用内建值：`Math`、`Date`、`JSON`、`Object`、`Array`、`Number`、`String`、`Boolean`、`RegExp`、`Intl`、`parseInt`、`parseFloat`、`isNaN`、`isFinite`、`encodeURIComponent`、`decodeURIComponent`、`encodeURI`、`decodeURI`、`undefined`、`NaN`、`Infinity`。需要其他能力就自行加进 `GLOBAL`、`globalData` 或 `render` 数据。
- 循环子作用域与 `include ... with` 新建的作用域使用同一套 `Proxy` 视图（with 上下文作为新的 renderData）。
- 局限：只隔离**标识符**和 `this` 的原型访问；`user.constructor.constructor(...)` 这类经由嵌套对象构造函数的逃逸不拦截，真正的隔离请用 `node:vm` / worker / 独立进程（§10）。

---

## 3. 公开 API

```ts
export class TemplateError extends Error {
  line?: number;   // 模板行号（1 起）
  file?: string;   // include 子模板路径（主模板为 undefined）
}

/** 模板全局对象：预置基础函数；可写 */
export const GLOBAL: Record<string, any>;

export interface CompileOptions {
  /** 当前模板目录，include 相对此目录解析；可选 */
  baseDir?: string;
  /** 安全根目录，include 不得越出；默认等于 baseDir */
  rootDir?: string;
  /** 该模板的全局数据，默认 GLOBAL；作为 render 数据未命中时的回退 */
  globalData?: Record<string, any>;
}

export function compile(source: string, options?: CompileOptions): Template;

/** 读取文件编译；baseDir 默认取文件所在目录，可用 options 覆盖 */
export function compileFile(file: string, options?: CompileOptions): Template;

export class Template {
  /** 使用 data（变量 + 函数）渲染；未命中时回退 globalData */
  render(data?: Record<string, any>): string;
}
```

使用示例：

```ts
import { compile, GLOBAL } from 'hongs-template';

GLOBAL.upper = (s: unknown) => String(s ?? '').toUpperCase();

const tpl = compile(`
# {{title}}
{%for item in items%}
- {{upper(item.name)}} / {{item.tags?.[0] ?? '-'}} / {{$formatDate('YYYY-MM-DD', item.at, timeZone)}}
{%else%}
无数据
{%endfor%}
`, { baseDir: __dirname });

tpl.render({
  title: 'Hello',
  items: [{ name: 'a', tags: ['x'], at: Date.now() }],
  timeZone: 'Asia/Shanghai', // 显式传入，模板中作为第三个参数
  upper: (s: string) => s.toUpperCase(), // 覆盖 GLOBAL 同名项
});
```

---

## 4. 语法与语义

| 能力 | 行为 |
|---|---|
| `{{ expr }}` | **任意 JS 表达式**，例如 `user?.name`、`items[0].tags[1]`、`items.map(x => x.name).join(', ')`、`` `Hi ${name}` ``、`/^\d+$/.test(code)`；标识符先查 render 数据、未命中回退 `globalData`（D4），`this` 也指向该作用域；深层取值建议用 `?.` 容错，不提供额外 `$get` |
| `{#..#}` | 注释，整段丢弃；支持跨行 |
| `{%if expr%}…{%elif expr%}…{%else%}…{%endif%}` | 条件为 **JS 真值**（`Boolean(expr)`）；判断“有效值”（含空集合、`0`、`''`、`NaN`）请用 `$isValid()` |
| `{%for x in expr%}…{%else%}…{%endfor%}` | 数组/字符串/`Set`/可迭代对象 → 元素；`Map`/普通对象 → `[key, value]` 元组（JS 惯例）；`null/undefined` 视为空；非可迭代抛 `TemplateError`；空集合走 `else` |
| `{%set name = expr%}` | 计算 JS 表达式后写入作用域（见 §4.3） |
| `{%include "path" [with expr]%}` | 编译期解析并编译；`with` 的表达式在渲染期求值 |
| 标签扫描 | `}}` / `%}` / `#}` 的结束判断识别 `'` `"` `` ` `` 字符串与简化正则字面量，避免 `{{ "}}" }}` 被截断 |
| 指令关键字 | 允许 `{%if (x)%}` / `{%if(x)%}`；关键字按词边界识别 |
| 错误 | 语法/未闭合/未知指令/表达式编译失败 → 编译期 `TemplateError`；运行时错误包装为 `TemplateError`，带行号 |

### 4.1 输出字符串化

- `null` / `undefined` → 不输出（避免 `{{user?.name}}` 打出 `undefined`）。
- 其他 → `String(value)`（JS 惯例）；集合/对象需要格式化时用 `.join()` / `JSON.stringify()`。

### 4.2 独占一行的指令与注释不空行

解析前先做一次带标签识别的行扫描（不再使用 Java 的 `findTxtEnd` 位置裁剪，避免首尾行残留换行）：

1. 识别每个标签的范围（`{{}}` / `{%%}` / `{##}`，注释可跨行）；
2. 一行去掉空白后若**全部由标签组成**（可多个），且不含 `{%include%}`，整行移除（含行尾换行）；
3. 跨行注释若自身独占若干整行，整体移除；
4. `{%include%}` 独占一行时**不裁剪**，保留换行，避免被包含内容与前后文粘连；
5. 行内有其他文本的标签照常保留，只影响行内空白。

```
A
{%set x = 1%}
{# 注释 #}
B
```

渲染为 `A\nB`；`A\n\n{%set x = 1%}\nB` 渲染为 `A\n\nB`（原有空行段落保留）。

### 4.3 作用域规则

- 根作用域：`{ ...(data || {}) }` 作为 renderData，`globalData` 作为回退；再创建 D4 的代理视图供表达式使用。
- `{%for%}`：每次迭代创建子作用域（`Object.create(当前作用域)`），循环变量为子作用域自有属性，**循环结束不外泄**；`for-else` 在零次迭代时执行。
- `{%set name = expr%}`：若作用域链上已有同名属性，写入**最近的**那一层（因此循环内 `set i = i + 1` 可累加外层计数器）；否则写入当前作用域。
- `{%if%}`：不创建新作用域。
- `{%include%}`：
  - 无 `with`：共用当前作用域（`set` 会影响外层，与 Java 一致）；
  - 有 `with expr`：新建独立作用域，子上下文作为 renderData（`globalData` 仍可回退），不继承调用方变量；自定义函数应放进 `globalData` / `GLOBAL`（`render` 数据里的临时函数不会进入子上下文）。

---

## 5. `GLOBAL` 内容

| 名称 | 类型/签名 | 说明 |
|---|---|---|
| `$format` | `(fmt, ...args)` | printf 子集：`%s %d %i %f %.Nf %j %x %X %%`，支持宽度与左对齐；纯 JS 实现，`%j` 用 `JSON.stringify` |
| `$formatDate` | `(fmt, time, timeZone?)` | dayjs 风格 token：`YYYY YY MM M DD D HH H mm m ss s SSS`，方括号为字面量；`time` 接受 `Date` / 毫秒时间戳 / 可解析日期字符串；`timeZone` 为 IANA，**显式传入**（如 `$formatDate('YYYY-MM', date, timeZone)`），省略时用本机时区 |
| `$isValid` | `(v)` | 有效值判断：`null/undefined`、`false`、`0`、`NaN`、`''`、空数组、空对象、空 `Map`/`Set` 均返回 `false`，其余返回 `true` |
| `$indent` | `(text, ind = '\t')` | 每行行首加缩进，**不再内置 `trim`** |
| `$count` | `(v)` | 字符串/数组/`Set`/`Map`/普通对象长度，其余 `0` |
| `$range` | `(start, end, step = 1)` | 返回**可重复迭代**的区间对象（`Symbol.iterator`、`length`、`toArray()`），每次 `for` 重新生成迭代器；`step === 0` 抛 `TemplateError` |
| `$isObject` | `(v)` | 纯对象判断（isPlainObject）：非 `null`、非数组、原型为 `Object.prototype` 或 `null` |

说明：

- 预置函数统一加 `$` 前缀，避免与调用方数据/函数重名；**前缀不强制**，调用方自定义函数可不用 `$`，也可嵌套在对象里。
- `Object` / `Array` / `JSON` / `Math` / `Date` 等内建可直接使用（D4），不再提供 `$keys` / `$entries` / `$isArray` 之类的薄封装；`$isObject` 因无直接等价写法而保留。
- `GLOBAL` 另含 D4 列出的其余内建值（`Math`、`JSON`、`Date`、`Object`、`Array` 等），它们属于 globalData 的一部分。
- 已去掉 Java 的 `matches`，改用 JS 正则：`{{/^[Tt]ony$/.test(name)}}`。
- 已去掉 `$contains`：数组/字符串用 `.includes()`，对象键用 `in`，`Map`/`Set` 用 `.has()`。
- 已去掉 `$strip`：用 `.trim()`、`.replace()`、正则等自行处理。
- 已去掉 `concat` / `substr`，直接使用 JS：`arr.join(', ')`、`str.slice(n)`。
- 已去掉 `date_format` 旧名，统一 `$formatDate`。
- 辅助函数均为普通 JS 函数，参数不符合预期时按 JS 习惯处理（`undefined` 而非抛数组越界）。

---

## 6. 目录结构

```
template/
├── package.json          name: hongs-template, version: 0.1.0, main/types: dist, exports
├── tsconfig.json         与 crud 一致：commonjs / ES2020 / strict / declaration
├── tsconfig.test.json    与 crud 一致：rootDir "." / outDir dist-test
├── src/
│   ├── index.ts          Template 类 + compile / compileFile + 导出 GLOBAL、TemplateError
│   ├── parser.ts         模板结构解析、独立行裁剪、include 解析与递归编译
│   ├── blocks.ts         Block AST（Txt / Var / Set / If / For / Include）与渲染、作用域
│   ├── expr.ts           JS 表达式预编译（new Function + with (this)）与错误包装
│   └── data.ts           GLOBAL 与基础函数
├── test/template.ts      断言式冒烟测试（与 crud/test 风格一致，无测试框架依赖）
└── README.md             用法、语法、API、GLOBAL 函数与限制说明
```

- 无运行时依赖；`devDependencies` 仅 `typescript`、`@types/node`。
- `scripts`：`build`（tsc）、`check`（tsc --noEmit）、`test`（tsc -p tsconfig.test.json && node dist-test/test/template.js）。
- `README.md` 覆盖：安装与快速开始、标签/指令语法、JS 表达式与 `?.` 约定、`GLOBAL` 函数表、`baseDir`/`rootDir`/`globalData`、独占行裁剪规则、安全边界（D4 非沙箱）。

---

## 7. 实施步骤

1. 创建子项目骨架：`package.json`、`tsconfig.json`、`tsconfig.test.json`。
2. `src/data.ts`：`GLOBAL` 与 `$format` / `$formatDate` / `$indent` / `$range` / `$count` / `$isValid` / `$isObject`。
3. `src/expr.ts`：表达式预编译、`with (this)` + `Proxy` 作用域视图（D4）、`TemplateError`。
4. `src/blocks.ts`：Block AST、渲染、§4.3 作用域与循环/include 语义。
5. `src/parser.ts`：标签扫描、独立行裁剪、指令解析、`include` 预编译与 `baseDir` / `rootDir` 校验。
6. `src/index.ts`：`compile` / `compileFile` / `Template` 组装与导出。
7. `test/template.ts`：覆盖 §8 清单。
8. `README.md`：安装/快速开始、语法、`GLOBAL` 函数、配置项、安全边界。
9. 验证：`npm install` → `npm run check` → `npm test` → `npm run build`。

---

## 8. 测试清单

1. JS 表达式：可选链（含缺失根变量，如 `a?.b?.c`）、`??`、数组 `[n]`、模板字面量、正则 `.test()`、`map/join`、箭头函数；`this` 访问（`this.user.name`、`this['x-y']`、箭头函数内 `this.suffix`）；标签内空白（`{{expr}}` 与 `{{ expr }}`、`{%if%}` 与 `{% if %}` 均支持）。
2. 输出：`null/undefined` 不输出；数字/数组/`String()` 行为。
3. `if / elif / else`、JS 真值边界（`0`、`''`、`[]`、`{}` 均为真），`$isValid()` 对 `false` / `0` / `''` / `NaN` / 空数组 / 空对象 / 空 `Map`/`Set` 返回 `false`。
4. `for` 遍历数组 / 字符串 / `Set` / `Map` / 对象，`[key, value]` 元组写法，`$range()` 迭代，生成器 / 自定义可迭代 / `Map#keys()` 迭代器，null 原型对象，`for-else`，`null` 视为空，非可迭代抛错。
5. `set`：计数器累加、循环变量不外泄、`set` 新变量只在当层可见。
6. 独立行裁剪：首行/尾行、连续指令、多标签同行、跨行注释、CRLF、纯指令/注释文件、行内标签保留、空行段落保留、字符串中的 `}}` / `%}` 不误截断（§4.2 示例逐条断言）。
7. `include`：相对路径、`../`、`with` 子上下文（不继承调用方变量）、嵌套 include、无 `baseDir` 抛错、文件不存在抛错、越出 `rootDir` 抛错、子模板错误带 `file` / `line`；`compileFile` 默认用文件目录、显式 `baseDir` / `rootDir` 可覆盖。
8. `GLOBAL` 全部函数各 1–2 个用例；`$formatDate` 覆盖：显式 `timeZone`、省略时用本机时区、dayjs token、`Date` 输入、非法日期/时区；`$format` 覆盖 `%.2f`、宽度/补零/左对齐、`%x` / `%X`、`%j` 循环引用、缺参；`$isValid` / `$isObject` 覆盖正常值与空值、`Date` / 函数 / 类实例 / null 原型；`$range` 覆盖负步长、`length`、`$count`、重复迭代；`render` 覆盖函数覆盖与追加、嵌套对象函数（`tools.upper`）。
9. `globalData`：默认用 `GLOBAL`；自定义对象未命中时回退；顶层键整体遮蔽、不深合并；`undefined` 值也遮蔽；null 原型全局对象；编译后修改 `globalData` 实时生效；`set` / 表达式赋值只写 render 数据；不修改 `GLOBAL`。
10. 表达式 `this`：`this.user.name`、`this['x-y']`、箭头函数内 `this.suffix`；函数内部 `this` 按 JS 调用规则，不做断言。
11. 作用域隔离（D4）：`process` / `require` / `globalThis` / `global` 在表达式中为 `undefined`；`Object` / `Array` / `Math` / `Date` / `JSON` 可直接使用；未定义标识符不输出/不抛 `ReferenceError`；表达式内赋值不产生全局变量。
12. `TemplateError`：类型、`line`、`file`、`message`；未闭合变量/指令/注释、未知指令、非法 `set` / `for` / `include`、意外 `endif`、`compileFile` 文件不存在、`$range` 步长为 0；编译期 vs 渲染期错误来源；include 子模板运行时错误的 `file` / `line`。
13. 预编译特征：编译后 `render` 不读文件（改文件内容后重复 render 结果不变）。

---

## 9. 已确认事项

- **辅助函数集合**：§5 仅保留 `$format` / `$formatDate` / `$indent` / `$range` / `$count` / `$isValid` / `$isObject`；`Object` / `Array` / `JSON` / `Math` / `Date` 直接使用。
- **包信息**：`hongs-template@0.1.0`、MIT、CommonJS + `exports` 字段（与 `crud` 一致）。
- **作用域规则**：按 §4.3（循环子作用域 + `set` 就近写入）。
- 表达式不解析、用 `new Function('with (this) { ... }')` 在编译期预编译（不采用参数展开）；表达式内 `this` 即 render 作用域，函数内 `this` 按 JS 规则不绑定；标识符先查 render 数据、未命中回退 globalData，宿主全局不可见（D4），`Object` / `Array` / `JSON` / `Math` / `Date` 直接可用；`compile` 支持 `globalData`（默认 `GLOBAL`），双层查找不拷贝；预置函数加 `$` 前缀（非强制）；去掉 `BASE_HREF` / `TIME_ZONE`，`$formatDate` 的时区显式传入；`rootDir` 仅做词法校验；新增 `TemplateError`。

---

## 10. 低优先级：模板安全预检（只入计划，暂不实现）

定位：极简引擎默认不为不可信模板负责。若开发者确实要开放用户自定义模板，可先用此函数做**启发式预检**，提前拦截明显危险写法；它不是沙箱，无法阻止精心构造的绕过（如经由嵌套对象：`user.constructor.constructor('return process')()`）。

```ts
export interface SecurityIssue {
  line: number;
  rule: string;     // 如 'global-access' / 'proto-access'
  message: string;
}

/** 纯静态扫描，返回可疑项；空数组表示未发现明显问题 */
export function checkTemplate(source: string): SecurityIssue[];
```

建议规则（均基于标签内表达式的词法扫描，字符串内容不误报）：

- 宿主/全局对象：`process`、`globalThis`、`global`、`require`、`module`、`exports`、`import(`、`eval`、`Function`；
- 原型链：`__proto__`、`constructor`、`prototype`、`Reflect`、`Object.getPrototypeOf`；
- 危险模块名：`child_process`、`node:fs`、`fs`、`net`、`http`、`https`、`vm`、`os`；
- 表达式副作用：赋值 `=`（非 `==`/`===`/`=>`）、`++`、`--`、`delete`；
- `{%include%}` 的路径越界与绝对路径。

输出只作为提示（不抛错），由开发者决定是否拒绝；后续如需真正隔离，应改用 `node:vm`、worker 或独立进程，而不是继续加强正则扫描。
