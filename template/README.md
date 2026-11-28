# hongs-template

极简 Jinja 风格模板引擎，表达式直接使用 JavaScript 语法。

> **注意：模板、数据以及数据里的函数均需由开发者维护，视为安全可信。**
>
> 本引擎不做沙箱：表达式通过 `new Function` 执行，模板作者可以执行任意 JS。用于**LLM prompt 模板渲染**、**报告生成**等内部可信场景，不要用于渲染终端用户提交的模板。

- `{{ expr }}` 输出、`{% if / for / set / include %}` 指令、`{# 注释 #}`
- 表达式在编译期用 `new Function` 预编译，`render` 只执行不再解析
- 函数与数据同池：标识符先查 render 数据，未命中回退全局 `GLOBAL`（顶层遮蔽，不深合并）
- `include` 编译期解析，支持 `baseDir` / `rootDir` / `globalData`
- 独占一行的指令/注释整行移除，不影响 markdown 段落

## 安装

```bash
npm install hongs-template
```

## 快速开始

```ts
import { compile } from 'hongs-template';

const tpl = compile(`
# {{ title }}
{% for item in items %}
- {{ item.name }}：{{ $format('%.2f', item.price) }}
{% else %}
无数据
{% endfor %}
`);

console.log(tpl.render({
  title: 'Hello',
  items: [{ name: 'A', price: 1.5 }],
}));
```

从文件编译（`baseDir` 默认取文件所在目录）：

```ts
import { compileFile } from 'hongs-template';

const tpl = compileFile('/path/to/page.html');
tpl.render({ title: 'Hi' });
```

## 语法

### 输出

```jinja
{{ title }}
{{ user?.name ?? '-' }}
{{ items[0].tags[1] }}
{{ items.map(x => x.name).join(', ') }}
{{ `Hi ${name}` }}
{{ /^\d+$/.test(code) }}
```

表达式是标准 JS，可选链、`??`、模板字面量、正则、箭头函数都可用。
强烈建议用 `?.` 处理可能缺失的路径；未声明的顶层标识符返回 `undefined`，不会抛 `ReferenceError`。

### 条件

```jinja
{% if count > 10 %}
多
{% elif count > 5 %}
中
{% else %}
少
{% endif %}
```

条件使用 JS 真值：`[]`、`{}` 为真；判断“有效值”用 `$isValid()`。

### 循环

```jinja
{% for item in items %}
{{ item }}
{% else %}
无数据
{% endfor %}
```

对象/映射解包：

```jinja
{% for key in obj %}{{ key }}={{ obj[key] }}{% endfor %}
{% for key, val in obj %}{{ key }}={{ val }}{% endfor %}
```

- `Set` / 数组 / 迭代对象 / 字符串 ：`for item in value` 逐项遍历
- `Map` / 普通对象 ：`for k in obj` 取键，`for k,v in obj` 取键值
- `null` / `undefined` 转入 else, 无则忽略
- 非可迭代值抛 `TemplateError`

### 设置变量

```jinja
{% set total = count * price %}
{% set items = ['A', 'B'] %}
```

循环内 `set` 已存在的变量会写回外层（可用于计数）：

```jinja
{% set i = 0 %}
{% for item in items %}
{% set i = i + 1 %}
{{ i }}
{% endfor %}
```

循环变量只在循环内可见。

### 包含

```jinja
{% include "header.html" %}
{% include "row.html" with {"item": item} %}
```

- `include` 在编译期读取并编译，`render` 时不再读文件
- 相对路径基于 `baseDir`，`../` 不能越出 `rootDir`
- 带 `with` 时只使用 `globalData` + 子上下文，不继承调用方变量

## 表达式作用域

- 标识符先查 render 数据（含循环子作用域），未命中再查 `globalData`
- 仅顶层遮蔽：`data.abc` 存在时，`globalData.abc` 整体不可见，不做深合并
- `{% set %}` 只写 render 数据，不修改 `globalData` / `GLOBAL`
- `process` / `require` / `globalThis` 等宿主全局不可见
- `this` 也是该作用域，可写 `this.user.name`、`this['x-y']`
- 模板与数据应视为可信，这是标识符级隔离，不是沙箱

## GLOBAL

`GLOBAL` 是可写的全局对象。render 时先查 render 数据，未命中再回退 `GLOBAL`；`GLOBAL` 的修改对已编译模板实时生效。

| 名称 | 说明 |
|---|---|
| `$isObject(v)` | 纯对象判断 |
| `$isValid(v)` | `null/undefined/false/0/NaN/''`、空数组/对象/Map/Set 为 `false` |
| `$count(v)` | 字符串/数组/`Set`/`Map`/普通对象/`$range` 的长度，其余 `0` |
| `$range(start, end, step = 1)` | 可重复迭代的区间对象：含 `length`、`toArray()`，每次 `for` 都重新迭代，不预分配数组 |
| `$indent(text, ind = '\t')` | 每行行首加缩进（不 trim） |
| `$format(fmt, ...args)` | printf 子集：`%s %d %i %f %.Nf %j %x %X %%`；纯 JS 实现，`%j` 用 `JSON.stringify` |
| `$formatDate(fmt, time, timeZone?)` | dayjs 风格 `YYYY YY MM M DD D HH H mm m ss s SSS`，方括号为字面量；`time` 接受 `Date` / 毫秒时间戳 / 可解析日期字符串；`timeZone` 省略时用本机时区 |

另外 `Math`、`Intl`、`JSON`、`Date`、`Object`、`Array`、`Number`、`String`、`Boolean`、`RegExp`、`parseInt`、`parseFloat`、`isNaN`、`isFinite`、URI 编解码函数可直接使用。

扩展或裁剪全局数据：

```ts
import { GLOBAL, compile } from 'hongs-template';

GLOBAL.$upper = (s: unknown) => String(s ?? '').toUpperCase();

// 或只给某个模板单独配置
const tpl = compile(source, {
  globalData: { ...GLOBAL, $upper: (s: string) => s.toUpperCase() },
});
```

## 编译选项

```ts
compile(source, {
  baseDir: '/templates',   // include 相对目录，可选
  rootDir: '/templates',   // include 安全根，默认同 baseDir
  globalData: GLOBAL,      // 全局数据，默认 GLOBAL
});

compileFile('/templates/page.html', {
  // baseDir 默认取文件目录；这里可覆盖
});
```

## 独占行规则

独占一行的指令与注释不产生空行：

```md
A
{% set x = 1 %}
{# 注释 #}
B
```

渲染为 `A\nB`；原有空行段落保留。`{% include %}` 独占一行时不裁剪，保留换行。

## 错误

统一抛 `TemplateError`：

```ts
import { TemplateError } from 'hongs-template';

try {
  compile('{% if x %}');
} catch (err) {
  if (err instanceof TemplateError) {
    console.log(err.line, err.file, err.message);
  }
}
```

## 非 Node 环境

核心的 `compile` / `render`（含 JS 表达式、`$format` 等）不依赖 Node 内置模块，可用于浏览器 / Edge Runtime（经打包器处理 CommonJS）。

- `fs` / `path` 是**惰性加载**：`import` 本库不会失败
- `compileFile`、`include` 在调用/编译到时才提示需要 Node.js `fs` / `path`
- `$format` 全部为纯 JS 实现，浏览器与 Node 行为一致

## License

MIT
