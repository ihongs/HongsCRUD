import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GLOBAL, TemplateError, compile, compileFile } from '../src/index';

let passed = 0;

function eq(actual: any, expected: any, label: string): void {
  assert.strictEqual(actual, expected, label);
  passed++;
}

function ok(value: any, label: string): void {
  assert.ok(value, label);
  passed++;
}

function throws(fn: () => any, label: string, check?: (err: any) => boolean): void {
  let error: any;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  assert.ok(error, `${label} (no error thrown)`);
  if (check) {
    assert.ok(check(error), `${label} (error mismatch: ${error && error.message})`);
  }
  passed++;
}

function render(source: string, data?: Record<string, any>, options?: any): string {
  return compile(source, options).render(data);
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hongs-template-'));
}

/* ---------- 表达式 ---------- */

eq(
  render('{{ title }} / {{ user?.name ?? "-" }} / {{ items[0] }}', {
    title: 'Hi',
    user: null,
    items: ['a'],
  }),
  'Hi / - / a',
  'variable, optional chain, index',
);

eq(render('{{  title  }}|{# note #}', { title: 'T' }), 'T|', 'whitespace inside tags');

eq(render('{{a?.b?.c}}'), '', 'missing root optional chain');
eq(render('{{items.map(x => x * 2).join(",")}}', { items: [1, 2, 3] }), '2,4,6', 'arrow + map');
eq(
  render('{{this.user.name}} {{this["x-y"]}} {{items.map(x => x + this.suffix).join("|")}}', {
    user: { name: 'N' },
    'x-y': 'Z',
    items: ['a', 'b'],
    suffix: '!',
  }),
  'N Z a!|b!',
  'this access',
);
eq(render('{{`Hi ${name}`}}', { name: 'A' }), 'Hi A', 'template literal');
eq(render('{{/^\\d+$/.test(code)}}', { code: '123' }), 'true', 'regex');
eq(render('{{/a}}b/.test(x)}}', { x: 'a}}b' }), 'true', 'regex containing terminator');
eq(render('{%if /%}/.test(x)%}T{%else%}F{%endif%}', { x: '%}' }), 'T', 'regex in directive');
eq(render('{{items}}/{{obj}}', { items: [1, 2], obj: {} }), '1,2/[object Object]', 'output stringify');

/* ---------- 作用域隔离 ---------- */

eq(
  render('{{typeof process}}/{{typeof require}}/{{typeof globalThis}}/{{typeof global}}'),
  'undefined/undefined/undefined/undefined',
  'host globals hidden',
);
eq(
  render('{{Object.keys(obj).join(",")}} {{Array.isArray(items)}} {{JSON.stringify(obj)}} {{Math.max(1,2)}}', {
    obj: { a: 1, b: 2 },
    items: [],
  }),
  'a,b true {"a":1,"b":2} 2',
  'builtins available',
);
eq(render('{{missing}}'), '', 'unknown identifier is undefined');

/* ---------- 条件 ---------- */

eq(render('{% if n > 2 %}A{% elif n > 1 %}B{% else %}C{% endif %}', { n: 2 }), 'B', 'if/elif/else');
eq(render('{%if []%}T{%else%}F{%endif%}'), 'T', 'JS truthiness: [] is true');
eq(render('{%if {}%}T{%else%}F{%endif%}'), 'T', 'JS truthiness: {} is true');
eq(render('{%if $isValid([])%}T{%else%}F{%endif%}'), 'F', '$isValid empty array');
eq(render('{%if $isValid({})%}T{%else%}F{%endif%}'), 'F', '$isValid empty object');
eq(render('{%if $isValid(0)%}T{%else%}F{%endif%}'), 'F', '$isValid zero');
eq(render('{%if "0"%}T{%else%}F{%endif%}'), 'T', 'string zero is truthy');

/* ---------- 循环 ---------- */

eq(render('{% for x in items %}{{ x }}{% endfor %}', { items: [1, 2] }), '12', 'for array');
eq(render('{%for c in "ab"%}{{c}}{%endfor%}'), 'ab', 'for string');
eq(
  render('{% for k, v in map %}{{ k }}={{ v }};{% endfor %}', { map: new Map([['a', 1], ['b', 2]]) }),
  'a=1;b=2;',
  'for map entries',
);
eq(render('{% for k in obj %}{{ k }},{% endfor %}', { obj: { x: 1, y: 2 } }), 'x,y,', 'for object keys');
eq(
  render('{% for k, v in obj %}{{ k }}:{{ v }};{% endfor %}', { obj: { x: 1, y: 2 } }),
  'x:1;y:2;',
  'for object entries',
);
eq(render('{% for k in map %}{{ k }},{% endfor %}', { map: new Map([['a', 1], ['b', 2]]) }), 'a,b,', 'for map keys');
throws(
  () => render('{% for k, v in items %}{{ k }}{% endfor %}', { items: [[1, 2]] }),
  'for pair on array',
  (err) => err instanceof TemplateError,
);
throws(
  () => render('{% for k, v in set %}{{ k }}{% endfor %}', { set: new Set([1]) }),
  'for pair on set',
  (err) => err instanceof TemplateError,
);
eq(render('{%for e in set%}{{e}}{%endfor%}', { set: new Set(['a', 'b']) }), 'ab', 'for set');
eq(render('{%for x in []%}A{%else%}E{%endfor%}'), 'E', 'for-else empty');
eq(render('{%for x in none%}A{%else%}E{%endfor%}', { none: null }), 'E', 'for-else null');
eq(render('{%for i in $range(0,5,2)%}{{i}}{%endfor%}'), '024', '$range positive');
eq(render('{%for i in $range(3,0,-1)%}{{i}}{%endfor%}'), '321', '$range negative');
throws(
  () => render('{%for x in n%}A{%endfor%}', { n: 1 }),
  'for non-iterable',
  (err) => err instanceof TemplateError,
);

/* ---------- set 与作用域 ---------- */

eq(
  render('{%set i = 0%}{%for x in items%}{%set i = i + 1%}{{i}}{%endfor%}-{{i}}', { items: ['a', 'b'] }),
  '12-2',
  'set counter',
);
eq(render('{%for x in items%}{%set y = 1%}{%endfor%}{{y}}', { items: ['a'] }), '', 'loop local set');
eq(render('{% set a = 1 + 2 * 3 %}{{ a }}'), '7', 'set expression');

/* ---------- 独立行裁剪 ---------- */

eq(render('A\n{%set x = 1%}\nB'), 'A\nB', 'standalone directive line');
eq(render('{%set x = 1%}\nB'), 'B', 'standalone first line');
eq(render('A\n\n{%set x = 1%}\nB'), 'A\n\nB', 'blank paragraph kept');
eq(render('A\n  {%set x = 1%}  \nB'), 'A\nB', 'indented standalone directive');
eq(render('A\n{%set a = 1%}\n{%set b = 2%}\nB'), 'A\nB', 'consecutive directive lines');
eq(render('A\n{# one\ntwo #}\nB'), 'A\nB', 'multiline standalone comment');
eq(render('A\n{{v}}\nB', { v: 'V' }), 'A\nV\nB', 'variable line kept');
eq(render('A\n {%if true%}\n B\n {%endif%}\n C'), 'A\n B\n C', 'if/endif lines removed');
eq(render('A\n{%set x = 1%}\ntail'), 'A\ntail', 'text after directive line');

/* ---------- include ---------- */

const rootDir = tempDir();

try {
  fs.writeFileSync(path.join(rootDir, 'inc.tpl'), 'S {{n}}', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'with.tpl'), '{{n}}-{{outer}}', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'main.tpl'), '{%include "inc.tpl"%}', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'deep.tpl'), 'D{%include "sub/parent.tpl"%}', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'bad.tpl'), '{{ ', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'fmt.tpl'), '{{$format("%s!", n)}}', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'set.tpl'), '{%set y = 7%}', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'boom.tpl'), 'x\n{{foo()}}', 'utf8');
  fs.mkdirSync(path.join(rootDir, 'sub'));
  fs.writeFileSync(path.join(rootDir, 'sub', 'parent.tpl'), 'P{%include "../inc.tpl"%}', 'utf8');

  eq(render('{% include "inc.tpl" %}', { n: 1 }, { baseDir: rootDir }), 'S 1', 'include basic');
  eq(render('{%include "sub/parent.tpl"%}', { n: 2 }, { baseDir: rootDir }), 'PS 2', 'include parent dir');
  eq(render('{%include "deep.tpl"%}', { n: 3 }, { baseDir: rootDir }), 'DPS 3', 'include nested');
  eq(
    render('{%include "with.tpl" with ctx%}', { ctx: { n: 5 }, outer: 'X' }, { baseDir: rootDir }),
    '5-',
    'include with context',
  );
  eq(render('A\n{%include "inc.tpl"%}\nB', { n: 4 }, { baseDir: rootDir }), 'A\nS 4\nB', 'include line keeps newlines');
  eq(compileFile(path.join(rootDir, 'main.tpl')).render({ n: 7 }), 'S 7', 'compileFile default baseDir');

  const otherDir = path.join(rootDir, 'other');
  fs.mkdirSync(otherDir);
  fs.writeFileSync(path.join(otherDir, 'inc.tpl'), 'OTHER {{n}}', 'utf8');
  eq(
    compileFile(path.join(rootDir, 'main.tpl'), { baseDir: otherDir }).render({ n: 9 }),
    'OTHER 9',
    'compileFile baseDir override',
  );

  eq(render('{%include "./inc.tpl"%}', { n: 10 }, { baseDir: rootDir }), 'S 10', 'include ./ path');
  eq(
    render('{%include "with.tpl" with {"n": n}%}', { n: 6, outer: 'X' }, { baseDir: rootDir }),
    '6-',
    'include with object literal',
  );
  eq(render('{%include "with.tpl" with 1%}', {}, { baseDir: rootDir }), '-', 'include with non-object');
  eq(
    render('{%include "fmt.tpl" with ctx%}', { ctx: { n: 'a' } }, {
      baseDir: rootDir,
      globalData: { $format: (_fmt: string, value: any) => `${value}!` },
    }),
    'a!',
    'include with uses globalData',
  );
  eq(render('{%include "set.tpl"%}{{y}}', {}, { baseDir: rootDir }), '7', 'include shares scope');
  eq(
    render('{%include "set.tpl" with ctx%}{{typeof y}}', { ctx: {} }, { baseDir: rootDir }),
    'undefined',
    'include with isolates scope',
  );
  {
    const tpl = compile('{%include "boom.tpl"%}', { baseDir: rootDir });
    throws(
      () => tpl.render(),
      'include child runtime error',
      (err) => err instanceof TemplateError && err.file === path.join(rootDir, 'boom.tpl') && err.line === 2,
    );
  }

  throws(
    () => compile('{%include "inc.tpl"%}', { rootDir }),
    'include without baseDir but with rootDir',
    (err) => err instanceof TemplateError && /requires baseDir/.test(err.message),
  );
  throws(
    () => compileFile(path.join(rootDir, 'main.tpl'), { rootDir: path.join(rootDir, 'sub') }),
    'include escapes explicit rootDir',
    (err) => err instanceof TemplateError && /rootDir/.test(err.message),
  );

  throws(
    () => compile('{%include "inc.tpl"%}'),
    'include without baseDir',
    (err) => err instanceof TemplateError && /requires baseDir/.test(err.message),
  );
  throws(
    () => compile('{%include "nope.tpl"%}', { baseDir: rootDir }),
    'include missing file',
    (err) => err instanceof TemplateError && /not found/i.test(err.message),
  );
  throws(
    () => compile('{%include "bad.tpl"%}', { baseDir: rootDir }),
    'include child syntax error',
    (err) => err instanceof TemplateError && err.file === path.join(rootDir, 'bad.tpl') && err.line === 1,
  );

  const parentDir = tempDir();
  try {
    const appDir = path.join(parentDir, 'app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.join(parentDir, 'secret.tpl'), 'SECRET', 'utf8');
    fs.writeFileSync(path.join(appDir, 'main.tpl'), '{%include "../secret.tpl"%}', 'utf8');
    throws(
      () => compileFile(path.join(appDir, 'main.tpl')),
      'include escapes rootDir',
      (err) => err instanceof TemplateError && /rootDir/.test(err.message),
    );
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }

  const precompiled = compileFile(path.join(rootDir, 'main.tpl'));
  eq(precompiled.render({ n: 1 }), 'S 1', 'precompiled include');
  fs.writeFileSync(path.join(rootDir, 'inc.tpl'), 'CHANGED', 'utf8');
  eq(precompiled.render({ n: 1 }), 'S 1', 'render does not re-read include');
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

/* ---------- GLOBAL 函数 ---------- */

eq(render('{{$format("%.2f", 1.5)}}'), '1.50', '$format precision');
eq(render('{{$format("%s-%d", "a", 2)}}'), 'a-2', '$format basic');
eq(
  render('{{$formatDate("YYYY-MM-DD HH:mm:ss", ts, "UTC")}}', { ts: Date.UTC(2024, 0, 2, 3, 4, 5) }),
  '2024-01-02 03:04:05',
  '$formatDate UTC',
);
eq(
  render('{{$formatDate("YYYY/MM/DD", "2024-01-02T03:04:05Z", "Asia/Shanghai")}}'),
  '2024/01/02',
  '$formatDate timezone',
);
eq(render('{{$formatDate("[Day] D", ts, "UTC")}}', { ts: Date.UTC(2024, 0, 2) }), 'Day 2', '$formatDate literal');
{
  const local = new Date(2024, 0, 2, 3, 4, 5);
  eq(render('{{$formatDate("YYYY-MM-DD HH:mm:ss", ts)}}', { ts: local.getTime() }), '2024-01-02 03:04:05', '$formatDate local');
}
eq(render('{{$indent("a\\nb", "  ")}}'), '  a\n  b', '$indent');
eq(
  render('{{$count(items)}}/{{$count(obj)}}/{{$count("abc")}}/{{$count(set)}}', {
    items: [1, 2],
    obj: { a: 1 },
    set: new Set([1, 2, 3]),
  }),
  '2/1/3/3',
  '$count',
);
eq(render('{{[...$range(0,5,2)].join(",")}}'), '0,2,4', '$range values');
eq(render('{{$range(0,5,2).length}}/{{$count($range(0,5,2))}}/{{$isValid($range(0,0))}}'), '3/3/false', '$range length/count');
eq(
  render('{%set r = $range(0,3)%}{%for i in r%}{{i}}{%endfor%}|{%for i in r%}{{i}}{%endfor%}'),
  '012|012',
  '$range re-iterable',
);
eq(
  render('{{$isValid("")}}/{{$isValid([])}}/{{$isValid(0)}}/{{$isValid([1])}}/{{$isValid(NaN)}}'),
  'false/false/false/true/false',
  '$isValid',
);
eq(render('{{$isObject(obj)}}/{{$isObject([])}}/{{$isObject(null)}}', { obj: {} }), 'true/false/false', '$isObject');

/* ---------- globalData ---------- */

{
  const tpl = compile('{{$upper(name)}}|{{typeof $format}}', {
    globalData: { $upper: (value: any) => String(value).toUpperCase() },
  });
  eq(tpl.render({ name: 'abc' }), 'ABC|undefined', 'custom globalData');
  ok(!('$upper' in GLOBAL), 'GLOBAL is not mutated');
  eq(
    compile('{{$format("%s", x)}}', { globalData: { $format: () => 'X' } }).render({ x: 1 }),
    'X',
    'globalData function override',
  );
}

{
  const globalData: Record<string, any> = {
    $upper: (value: any) => String(value).toUpperCase(),
  };
  const tpl = compile('{{$upper(name)}}', { globalData });
  eq(tpl.render({ name: 'a' }), 'A', 'globalData lookup');
  globalData.$upper = (value: any) => `${value}!`;
  eq(tpl.render({ name: 'a' }), 'a!', 'globalData live update');
}

eq(
  render('{{abc.xyz}}/{{abc.def}}', { abc: { xyz: 'X' } }, { globalData: { abc: { def: 'D' } } }),
  'X/',
  'globalData is shadowed by whole top-level key',
);

{
  const globalData: Record<string, any> = { $format: () => 'G' };
  const tpl = compile('{%set $format = "local"%}{{$format}}', { globalData });
  eq(tpl.render(), 'local', 'set writes renderData');
  eq(globalData.$format(), 'G', 'set does not touch globalData');
}

{
  const data: Record<string, any> = {};
  compile('{%set a = 1%}').render(data);
  ok(!('a' in data), 'render does not mutate input data');
}

/* ---------- 错误 ---------- */

throws(
  () => compile('{{ '),
  'unclosed variable',
  (err) => err instanceof TemplateError && err.line === 1,
);
throws(
  () => compile('a\n{%if x%}b'),
  'unclosed if',
  (err) => err instanceof TemplateError && err.line === 2,
);
throws(
  () => render('{{foo()}}'),
  'runtime error wrapped',
  (err) => err instanceof TemplateError,
);

/* ---------- 格式化细节 ---------- */

eq(render('{{$format("%05d", 42)}}'), '00042', '$format width/zero pad');
eq(render('{{$format("%-4s|", "a")}}'), 'a   |', '$format left align');
eq(render('{{$format("%x/%X/%%", 255, 255)}}'), 'ff/FF/%', '$format hex/percent');
eq(render('{{$format("%j", obj)}}', { obj: { a: 1 } }), '{"a":1}', '$format json');
eq(render('{{$format("%s-%s", "a")}}'), 'a-%s', '$format missing arg');
eq(render('{{$format("%f", 1.5)}}'), '1.500000', '$format default precision');
{
  const circular: any = {};
  circular.self = circular;
  eq(render('{{$format("%j", obj)}}', { obj: circular }), '[Circular]', '$format circular json');
}

/* ---------- 日期格式化 ---------- */

eq(render('{{$formatDate("YYYY", null)}}'), '', '$formatDate null');
eq(
  render('{{$formatDate("YY/M/D H:m:s.SSS", ts, "UTC")}}', { ts: Date.UTC(2001, 8, 9, 1, 2, 3, 4) }),
  '01/9/9 1:2:3.004',
  '$formatDate tokens',
);
{
  const date = new Date(Date.UTC(2020, 11, 31, 23, 59, 58));
  eq(render('{{$formatDate("YYYY-MM-DD", d, "UTC")}}', { d: date }), '2020-12-31', '$formatDate Date input');
}
throws(
  () => render('{{$formatDate("YYYY", "not-a-date")}}'),
  '$formatDate invalid date',
  (err) => err instanceof TemplateError && /Invalid date/.test(err.message),
);
throws(
  () => render('{{$formatDate("YYYY", 0, "No/Zone")}}'),
  '$formatDate invalid timezone',
  (err) => err instanceof TemplateError && /Invalid timeZone/.test(err.message),
);

/* ---------- 其他 GLOBAL ---------- */

eq(render('{{$indent("", "  ")}}'), '', '$indent empty');
eq(render('{{$indent("a", "  ")}}'), '  a', '$indent single line');
eq(
  render('{{$count(m)}}/{{$count(s)}}/{{$count(none)}}', {
    m: new Map([['a', 1]]),
    s: new Set([1, 2]),
    none: null,
  }),
  '1/2/0',
  '$count map/set/null',
);
eq(
  render('{{$isValid(m)}}/{{$isValid(s)}}/{{$isValid(d)}}/{{$isValid(fn)}}/{{$isValid("0")}}', {
    m: new Map(),
    s: new Set(),
    d: new Date(),
    fn: () => 1,
  }),
  'false/false/true/true/true',
  '$isValid more',
);
{
  class Foo {}
  eq(
    render('{{$isObject(o)}}/{{$isObject(n)}}/{{$isObject(i)}}', {
      o: {},
      n: Object.create(null),
      i: new Foo(),
    }),
    'true/true/false',
    '$isObject plain/null-proto/class',
  );
}
eq(render('{{$range(5,0,-2).toArray().join(",")}}'), '5,3,1', '$range negative values');
eq(render('{{$range(0,0).length}}'), '0', '$range empty length');

/* ---------- 裁剪补充 ---------- */

eq(render('A\r\n{%set x = 1%}\r\nB'), 'A\r\nB', 'standalone CRLF');
eq(render('A{# note #}B'), 'AB', 'inline comment');
eq(render('{%set x = 1%}\n'), '', 'directive-only file');
eq(render('{# a\nb #}\n'), '', 'comment-only file');
eq(
  render('# {{title}}\n{%if show%}\ntext\n{%endif%}\n', { title: 'T', show: true }),
  '# T\ntext\n',
  'markdown layout',
);
eq(render('A{%set x = 1%}\nB'), 'A\nB', 'inline tag line kept');
eq(render('{{"}}" + "ok"}}'), '}}ok', 'string containing tag terminator');
eq(render('{%if "%}" == x%}T{%else%}F{%endif%}', { x: '%}' }), 'T', 'string containing directive terminator');

/* ---------- for 补充 ---------- */

function* nums(): Generator<number> {
  yield 1;
  yield 2;
}
eq(render('{%for x in g%}{{x}}{%endfor%}', { g: nums() }), '12', 'for generator');
{
  const iterable = {
    *[Symbol.iterator]() {
      yield 'a';
      yield 'b';
    },
  };
  eq(render('{%for x in it%}{{x}}{%endfor%}', { it: iterable }), 'ab', 'for custom iterable');
}
eq(
  render('{%for k in m.keys()%}{{k}}{%endfor%}', { m: new Map([['x', 1], ['y', 2]]) }),
  'xy',
  'for map keys iterator',
);
eq(render('{%for x in g%}A{%else%}E{%endfor%}', { g: (function* empty() {})() }), 'E', 'for-else empty generator');
{
  const np: any = Object.create(null);
  np.a = 1;
  np.b = 2;
  eq(render('{% for k, v in o %}{{ k }}{{ v }}{% endfor %}', { o: np }), 'a1b2', 'for null-proto object');
}
throws(
  () => render('a\n{%for x in d%}A{%endfor%}', { d: new Date() }),
  'for non-iterable line',
  (err) => err instanceof TemplateError && err.line === 2,
);

/* ---------- set 补充 ---------- */

eq(render('{%if true%}{%set z = 3%}{%endif%}{{z}}'), '3', 'set inside if');
eq(render('{{(x = 5)}}|{{x}}'), '5|5', 'expression assignment writes scope');
{
  const tpl = compile('{{(x = 5)}}');
  eq(tpl.render(), '5', 'assignment first render');
  eq(tpl.render(), '5', 'assignment second render resets');
}
eq(compile('{{typeof x}}').render(), 'undefined', 'no global leak');

/* ---------- 更多错误 ---------- */

throws(
  () => compile('{%foo%}'),
  'unknown directive',
  (err) => err instanceof TemplateError && err.line === 1,
);
throws(
  () => compile('a\n{%set x%}'),
  'invalid set',
  (err) => err instanceof TemplateError && err.line === 2,
);
throws(
  () => compile('{%for x items%}A{%endfor%}'),
  'invalid for',
  (err) => err instanceof TemplateError,
);
throws(
  () => compile('{%endif%}'),
  'unexpected endif',
  (err) => err instanceof TemplateError,
);
throws(
  () => compile('{#'),
  'unclosed comment',
  (err) => err instanceof TemplateError,
);
throws(
  () => compile('{%include x%}', { baseDir: '.' }),
  'invalid include',
  (err) => err instanceof TemplateError,
);
throws(
  () => compileFile(path.join(os.tmpdir(), 'hongs-template-missing-file.tpl')),
  'compileFile missing file',
  (err) => err instanceof TemplateError && /not found/i.test(err.message),
);
throws(
  () => render('{{$range(0,5,0)}}'),
  '$range zero step',
  (err) => err instanceof TemplateError && /Range step/.test(err.message),
);

/* ---------- globalData 补充 ---------- */

eq(
  render('{{foo}}', { foo: undefined }, { globalData: { foo: 'G' } }),
  '',
  'undefined data key shadows global',
);
{
  const globalData: any = Object.create(null);
  globalData.$x = () => 'X';
  eq(render('{{$x()}}', {}, { globalData }), 'X', 'globalData null prototype');
}

/* ---------- 预编译 ---------- */

{
  const tpl = compile('{{1 + 2}}');
  eq(tpl.render(), '3', 'precompiled expression');
  eq(tpl.render({ '1 + 2': 'x' }), '3', 'precompiled ignores data keys');
}

console.log(`hongs-template tests passed: ${passed}`);
