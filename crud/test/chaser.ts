// Chaser 集成测试（docs/plan-crud-search.md 6 节任务 12 - 14：基础 / 查询与 mapping 进阶 / 同步进阶）
// 运行：npm run test:chaser
// 前置：本地 MongoDB（mongodb://127.0.0.1:27017）与 ES（http://127.0.0.1:9200，未开 security）已启动
// 说明：add / set / delAll 的自动同步不带 refresh（见 5.1），用例里对索引显式 refresh 保证即刻可查；
//       syncDocs / syncFind 显式调用时直接传 refresh: 'wait_for'

import mongoose from 'mongoose';
import { Client } from '@elastic/elasticsearch';
import { Chaser } from '../src/search';

const MONGO_URI = 'mongodb://127.0.0.1:27017/test';
const ES_NODE   = 'http://127.0.0.1:9200';
const CTX       = { uid: 'tester' };

/* ---------- Schema：F 扁平组 / N nested 组 / S 伪删除 / Z 关自动同步 ---------- */
/* ----------        P 查询进阶 / L 全文覆盖 / M 加字段 / T 增量水位 ---------- */

const schemaF = new mongoose.Schema({
  name  : { type: String },
  status: { type: String, enum: ['draft', 'published'], countable: true },
  role  : { type: String, enum: ['admin', 'user']     , countable: true },
  age   : { type: Number, countable: true },
  tags  : { type: [String] },                                          // 标量数组
  extras: { type: [new mongoose.Schema({ k: String, v: Number })] },   // 扁平数组子文档（默认扁平模式）
}, { collection: 'testChaserF', esIndex: 'hongs-test-chaser-f' } as any);

const schemaN = new mongoose.Schema({
  name  : { type: String },
  status: { type: String, enum: ['a', 'b'], countable: true },
  works : { type: [new mongoose.Schema({
    tag: { type: String, enum: ['x', 'y'], countable: true },
    qty : { type: Number },
  })], nested: true },                                                 // nested 数组子文档（保留元素关联）
}, { collection: 'testChaserN', esIndex: 'hongs-test-chaser-n' } as any);

const schemaS = new mongoose.Schema({
  name  : { type: String },
  status: { type: String, enum: ['on', 'off'], countable: true },
}, { collection: 'testChaserS', esIndex: 'hongs-test-chaser-s', softDelete: true } as any);

const schemaZ = new mongoose.Schema({
  name  : { type: String },
  status: { type: String, enum: ['on', 'off'], countable: true },
}, { collection: 'testChaserZ', esIndex: 'hongs-test-chaser-z', esAutoSync: false, softDelete: true } as any);

// 任务 13：canSync / canText / select:false / 字段级 analyzer / nested 内文本，Schema 级 esAnalyzer
const schemaP = new mongoose.Schema({
  name  : { type: String },                                     // text，入全文
  note  : { type: String, canText: false },                     // text，入索引但不并入全文
  secret: { type: String, canSync: false },                     // 不入索引，find / sort / wd 均不可用
  hidden: { type: String, select: false },                      // 入索引可查，默认不随文档返回
  status: { type: String, enum: ['draft', 'published'], countable: true },
  body  : { type: String, analyzer: 'whitespace' },             // 字段级分词器，覆盖 esAnalyzer
  arts  : { type: [new mongoose.Schema({ title: String, qty: Number })], nested: true },   // nested 内 text 入全文
}, { collection: 'testChaserP', esIndex: 'hongs-test-chaser-p', esAnalyzer: 'simple' } as any);
// simple / whitespace 均为 ES 内建分词器，无需安装插件

// 任务 13：getFullText 覆盖组（status 为码值，默认不参与全文）
const schemaL = new mongoose.Schema({
  name  : { type: String },
  status: { type: String, enum: ['draft', 'published'] },
}, { collection: 'testChaserL', esIndex: 'hongs-test-chaser-l' } as any);

// 任务 13：pushMapping 增量组（构造后 schema.add 加字段）
const schemaM = new mongoose.Schema({
  name: { type: String },
  age : { type: Number },
}, { collection: 'testChaserM', esIndex: 'hongs-test-chaser-m' } as any);

// 任务 14：增量水位组（updatedAt 由 timestamps 维护）
const schemaT = new mongoose.Schema({
  name  : { type: String },
  status: { type: String, enum: ['on', 'off'], countable: true },
}, { collection: 'testChaserT', esIndex: 'hongs-test-chaser-t', timestamps: true } as any);

const MF = mongoose.model('TestChaserF', schemaF);
const MN = mongoose.model('TestChaserN', schemaN);
const MS = mongoose.model('TestChaserS', schemaS);
const MZ = mongoose.model('TestChaserZ', schemaZ);
const MP = mongoose.model('TestChaserP', schemaP);
const ML = mongoose.model('TestChaserL', schemaL);
const MM = mongoose.model('TestChaserM', schemaM);
const MT = mongoose.model('TestChaserT', schemaT);

/** 覆盖 getFullText 追加码值标签的子类（任务 13：派生文本示例） */
class LabeledChaser extends Chaser {
  protected getFullText(doc: any): string {
    return super.getFullText(doc) + ' TAG' + String(doc.status ?? '').toUpperCase();
  }
}

/* ---------- 断言工具（与 test/counts.ts 一致） ---------- */

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    if (!ka.every((k, i) => k === kb[i])) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function assert(name: string, actual: any, expected: any): void {
  const ok = deepEqual(actual, expected);
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual  : ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await mongoose.connect(MONGO_URI, { dbName: 'test' });
  console.log(`Connected to ${MONGO_URI}/test`);

  const es = new Client({ node: ES_NODE });
  console.log(`ES client ready: ${ES_NODE}\n`);

  const cf = new Chaser(schemaF, MF, es);
  const cn = new Chaser(schemaN, MN, es);
  const cs = new Chaser(schemaS, MS, es);
  const cz = new Chaser(schemaZ, MZ, es);

  // 写入自动同步不带 refresh，这里显式刷新保证后续查询即刻可查
  const refresh = async (c: Chaser): Promise<void> => {
    await es.indices.refresh({ index: c.getIndex() });
  };
  // search 取命中文档的 name 集合（排序后比较，消除顺序依赖）；
  // mongo 版 limitDef 默认 1（不传 limit 只取一条），这里默认注入 10，与多命中断言相配
  const names = async (c: Chaser, params: any): Promise<string[]> => {
    const r = await c.search({ limit: 10, ...params }, CTX as any);
    return (r.items ?? []).map((d: any) => String(d.name)).sort();
  };
  // counts 实际返回 Promise，类型签名是同步，统一 await
  const counts = async (c: Chaser, params: any): Promise<any> => {
    return await (c.counts(params, CTX as any) as unknown as Promise<any>);
  };
  // 增量水位用：隔开相邻时间戳，避开毫秒取整的临界
  const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
  // 取被拒调用的错误码（CrudError.code），未抛错返回 undefined
  const errnoOf = async (fn: () => unknown): Promise<number | undefined> => {
    try { await fn(); return undefined; }
    catch (e: any) { return e?.code; }
  };

  /* ---------- 1) 扁平组：initIndex -> add -> search / counts ---------- */
  console.log('--- 1) 扁平组：initIndex -> add -> search / counts ---');
  await MF.deleteMany({});
  await cf.initIndex();   // 删后建，保证 ES 干净

  const [ f1 ] = await (cf.add({ name: 'alpha first' , status: 'draft'    , role: 'admin', age: 20, tags: ['red', 'blue'], extras: [{ k: 'p', v: 1 }] }) as unknown as Promise<[any, string]>);
  const [ f2 ] = await (cf.add({ name: 'beta second' , status: 'draft'    , role: 'user' , age: 30, tags: ['red']        , extras: [{ k: 'q', v: 2 }] }) as unknown as Promise<[any, string]>);
  const [ f3 ] = await (cf.add({ name: 'gamma third' , status: 'published', role: 'user' , age: 40, tags: []            , extras: [{ k: 'p', v: 3 }, { k: 'q', v: 4 }] }) as unknown as Promise<[any, string]>);
  await refresh(cf);

  assert('search 全量 total = 3', (await cf.search({ }, CTX as any)).total, 3);
  assert('search find status = draft', await names(cf, { find: { status: 'draft' } }), ['alpha first', 'beta second']);
  assert('search find 标量数组元素 tags = red', await names(cf, { find: { tags: 'red' } }), ['alpha first', 'beta second']);
  assert('search find 扁平子文档 extras.k = q', await names(cf, { find: { 'extras.k': 'q' } }), ['beta second', 'gamma third']);
  assert('search find age >= 30', await names(cf, { find: { age: { $gte: 30 } } }), ['beta second', 'gamma third']);
  assert('search wd 命中全文合并字段', await names(cf, { wd: 'alpha' }), ['alpha first']);

  const c1 = await counts(cf, { });
  assert('counts total = 3', c1.total, 3);
  assert('counts.status', c1.counts.status, { draft: 2, published: 1 });
  assert('counts.role', c1.counts.role, { admin: 1, user: 2 });
  assert('counts.age', c1.counts.age, { 20: 1, 30: 1, 40: 1 });

  const c2 = await counts(cf, { sels: { status: ['draft'] } });
  assert('counts sels 联动 total = 2', c2.total, 2);
  assert('counts sels 已选字段自身不套用（全量分布）', c2.counts.status, { draft: 2, published: 1 });
  assert('counts sels 其他字段套用（draft 内的 role）', c2.counts.role, { admin: 1, user: 1 });

  /* ---------- 2) 扁平组：set / delAll ---------- */
  console.log('\n--- 2) 扁平组：set / delAll ---');
  await (cf.set(String(f1._id), { age: 25 }) as unknown as Promise<[any, number]>);
  await refresh(cf);
  assert('set 后新值可查', await names(cf, { find: { age: 25 } }), ['alpha first']);
  assert('set 后旧值查不到', await names(cf, { find: { age: 20 } }), [ ]);

  const del1 = await (cf.delAll([ String(f3._id) ]) as unknown as Promise<number>);
  assert('delAll 返回删除数', del1, 1);
  await refresh(cf);
  assert('delAll 后 total = 2', (await cf.search({ }, CTX as any)).total, 2);

  const c3 = await counts(cf, { });
  assert('counts total = 2', c3.total, 2);
  assert('counts.status', c3.counts.status, { draft: 2 });
  assert('counts.age', c3.counts.age, { 25: 1, 30: 1 });

  /* ---------- 3) nested 组：initIndex -> add -> search / counts ---------- */
  console.log('\n--- 3) nested 组：initIndex -> add -> search / counts ---');
  await MN.deleteMany({});
  await cn.initIndex();

  await (cn.add({ name: 'job one'  , status: 'a', works: [{ tag: 'x', qty: 5 }, { tag: 'y', qty: 6 }] }) as unknown as Promise<[any, string]>);
  await (cn.add({ name: 'job two'  , status: 'b', works: [{ tag: 'x', qty: 7 }] }) as unknown as Promise<[any, string]>);
  await (cn.add({ name: 'job three', status: 'a', works: [ ] }) as unknown as Promise<[any, string]>);
  await refresh(cn);

  assert('search 全量 total = 3', (await cn.search({ }, CTX as any)).total, 3);
  assert('search nested 单字段 works.tag = y', await names(cn, { find: { 'works.tag': 'y' } }), ['job one']);
  assert('search nested 范围 works.qty >= 6', await names(cn, { find: { 'works.qty': { $gte: 6 } } }), ['job one', 'job two']);
  // nested 归组是元素级联动：同一 work 元素须同时满足两条件
  assert('search 同元素 tag = x 且 qty = 5 -> job one', await names(cn, { find: { 'works.tag': 'x', 'works.qty': 5 } }), ['job one']);
  assert('search 无同元素满足 tag = y 且 qty = 5 -> 空', await names(cn, { find: { 'works.tag': 'y', 'works.qty': 5 } }), [ ]);
  assert('search wd 命中', await names(cn, { wd: 'three' }), ['job three']);

  const c4 = await counts(cn, { });
  assert('counts total = 3', c4.total, 3);
  assert('counts.status', c4.counts.status, { a: 2, b: 1 });
  // works.tag 走 reverse_nested 取父文档数；job three 无 works 记缺失空串键
  assert('counts works.tag（父文档数 + 缺失）', c4.counts['works.tag'], { x: 2, y: 1, '': 1 });

  const c5 = await counts(cn, { sels: { status: ['a'] } });
  assert('counts sels total = 2', c5.total, 2);
  assert('counts sels works.tag', c5.counts['works.tag'], { x: 1, y: 1, '': 1 });

  /* ---------- 4) syncDocs 直接文档同步 ---------- */
  console.log('\n--- 4) syncDocs 直接文档同步 ---');
  await MF.deleteMany({});
  await cf.initIndex();

  const docs4 = await MF.insertMany([
    { name: 'sync one', status: 'draft', role: 'admin', age: 20 },
    { name: 'sync two', status: 'published', role: 'user', age: 30 },
  ]);
  assert('未同步前 search 查不到', (await cf.search({ }, CTX as any)).total, 0);

  const st4 = await cf.syncDocs(docs4, { refresh: 'wait_for' });
  assert('syncDocs 统计', { total: st4.total, indexed: st4.indexed, deleted: st4.deleted, failed: st4.failed },
    { total: 2, indexed: 2, deleted: 0, failed: 0 });
  assert('syncDocs 后 search 命中', await names(cf, { }), ['sync one', 'sync two']);

  /* ---------- 5) syncFind 条件同步与全量补齐 ---------- */
  console.log('\n--- 5) syncFind 条件同步与全量补齐 ---');
  await MF.insertMany([
    { name: 'find one', status: 'draft', role: 'user', age: 40 },
    { name: 'find two', status: 'published', role: 'admin', age: 50 },
  ]);
  assert('新插入未同步（ES 仍只有 2 条）', (await cf.search({ }, CTX as any)).total, 2);

  const st5 = await cf.syncFind({ status: 'draft' }, { refresh: 'wait_for' });
  assert('syncFind 条件统计（mongo 命中 draft 2 条）', { total: st5.total, indexed: st5.indexed, deleted: st5.deleted, failed: st5.failed },
    { total: 2, indexed: 2, deleted: 0, failed: 0 });
  assert('条件同步后 total = 3（find two 仍未同步）', (await cf.search({ }, CTX as any)).total, 3);

  const st6 = await cf.syncFind(undefined, { refresh: 'wait_for' });   // 不传 find 即全量
  assert('syncFind 全量统计（mongo 4 条全部覆写）', { total: st6.total, indexed: st6.indexed, deleted: st6.deleted, failed: st6.failed },
    { total: 4, indexed: 4, deleted: 0, failed: 0 });
  assert('全量补齐后 total = 4', (await cf.search({ }, CTX as any)).total, 4);

  /* ---------- 6) 伪删除：mongo 留档，ES 物理删除 ---------- */
  console.log('\n--- 6) 伪删除：mongo 留档，ES 物理删除 ---');
  await MS.deleteMany({});
  await cs.initIndex();

  const [ p1 ] = await (cs.add({ name: 'keep one', status: 'on' }) as unknown as Promise<[any, string]>);
  await (cs.add({ name: 'keep two', status: 'off' }) as unknown as Promise<[any, string]>);
  await refresh(cs);
  assert('add 后 total = 2', (await cs.search({ }, CTX as any)).total, 2);

  const del2 = await (cs.delAll([ String(p1._id) ]) as unknown as Promise<number>);   // softDelete：mongo 置标记
  assert('delAll 返回伪删数', del2, 1);
  await refresh(cs);
  assert('伪删除后 ES total = 1', (await cs.search({ }, CTX as any)).total, 1);
  assert('伪删除后 ES 查不到该文档', await names(cs, { find: { status: 'on' } }), [ ]);
  assert('mongo 留档（伪删记录还在）', await MS.countDocuments({ }), 2);
  const p1Doc = await MS.findById(String(p1._id)).select('+isDeleted');
  assert('mongo 伪删标记为真', (p1Doc as any)?.isDeleted, true);

  /* ---------- 7) esAutoSync: false：写入不自动同步，由 syncFind 补齐 ---------- */
  console.log('\n--- 7) esAutoSync: false -> syncFind() 补齐（含伪删记录清掉）---');
  await MZ.deleteMany({});
  await cz.initIndex();

  const [ z1 ] = await (cz.add({ name: 'lazy one', status: 'on' }) as unknown as Promise<[any, string]>);
  await (cz.add({ name: 'lazy two', status: 'off' }) as unknown as Promise<[any, string]>);
  assert('写入不自动同步：search 查不到', (await cz.search({ }, CTX as any)).total, 0);
  assert('mongo 已写入', await MZ.countDocuments({ }), 2);

  await cz.syncFind(undefined, { refresh: 'wait_for' });   // 全量补齐
  assert('syncFind 补齐后 total = 2', (await cz.search({ }, CTX as any)).total, 2);

  await (cz.delAll([ String(z1._id) ]) as unknown as Promise<number>);   // 伪删 mongo，不触 ES
  assert('删除也不自动同步：ES 滞后仍 total = 2', (await cz.search({ }, CTX as any)).total, 2);

  const st7 = await cz.syncFind(undefined, { refresh: 'wait_for' });   // 全量：伪删转 delete + purge
  assert('syncFind 统计（z1 转 delete，z2 覆写）', { total: st7.total, indexed: st7.indexed, deleted: st7.deleted, failed: st7.failed },
    { total: 2, indexed: 1, deleted: 1, failed: 0 });
  assert('伪删记录被清掉：total = 1', (await cz.search({ }, CTX as any)).total, 1);
  assert('counts total = 1', (await counts(cz, { })).total, 1);
  assert('mongo 伪删记录保留', await MZ.countDocuments({ }), 2);

  /* ---------- 8) 任务 13：canSync / select:false / canText / 分词器 ---------- */
  console.log('\n--- 8) 进阶组 P：canSync / select:false / canText / 分词器 ---');

  // 非 text 字段标 analyzer：配置矛盾，构造期即报
  const schemaBad1 = new mongoose.Schema(
    { n: { type: Number, analyzer: 'standard' } }, { collection: 'testChaserBad1' } as any);
  assert('非 text 字段标 analyzer 构造抛 INTERNEL_ERROR', await errnoOf(() => new Chaser(schemaBad1, undefined, es)), -32603);
  // countable 却 canSync: false：同为配置矛盾
  const schemaBad2 = new mongoose.Schema(
    { s: { type: String, countable: true, canSync: false } }, { collection: 'testChaserBad2' } as any);
  assert('countable 且 canSync:false 构造抛 INTERNEL_ERROR', await errnoOf(() => new Chaser(schemaBad2, undefined, es)), -32603);

  const cp = new Chaser(schemaP, MP, es);
  await MP.deleteMany({});
  await cp.initIndex();

  const mapP = cp.getMapping().properties as Record<string, any>;
  assert('mapping：Schema 级 esAnalyzer 落到 text 字段', mapP.name,
    { type: 'text', analyzer: 'simple', fields: { keyword: { type: 'keyword', ignore_above: 256 } } });
  assert('mapping：字段级 analyzer 覆盖 esAnalyzer', mapP.body.analyzer, 'whitespace');
  assert('mapping：合并字段取 esAnalyzer', mapP.fullText, { type: 'text', analyzer: 'simple' });
  assert('mapping：同步戳为 date', mapP.syntTime, { type: 'date' });
  assert('mapping：canSync:false 字段不出现', 'secret' in mapP, false);
  assert('mapping：select:false 字段照常入索引', mapP.hidden.type, 'text');
  assert('mapping：nested 容器声明 strict 与子字段', mapP.arts,
    { type: 'nested', dynamic: 'strict', properties: {
      title: { type: 'text', analyzer: 'simple', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
      qty  : { type: 'double' },
    } });

  assert('getSyncable：点号路径齐全、排除 canSync:false', [ ...cp.getSyncable() ].sort(),
    ['arts.qty', 'arts.title', 'body', 'hidden', 'name', 'note', 'status']);
  assert('getTextable：排除 canText:false 与非 text', [ ...cp.getTextable() ].sort(),
    ['arts.title', 'body', 'hidden', 'name']);
  assert('getCountable', [ ...cp.getCountable() ].sort(), ['status']);

  const esMapP = (await es.indices.getMapping({ index: cp.getIndex() })) as any;
  assert('ES 侧 mapping：analyzer 已落地', esMapP[cp.getIndex()].mappings.properties.body.analyzer, 'whitespace');

  const [ p8 ] = await (cp.add({
    name: 'paper one', note: 'zebra coffee', secret: 'topsecret', hidden: 'hid-one',
    status: 'draft', body: 'BodyText', arts: [{ title: 'deep art', qty: 2 }],
  }) as unknown as Promise<[any, string]>);
  await refresh(cp);

  assert('find canSync:false 字段抛 PARAMS_INVALID', await errnoOf(() => cp.search({ find: { secret: 'x' } }, CTX as any)), -32602);
  assert('sort canSync:false 字段抛 PARAMS_INVALID', await errnoOf(() => cp.search({ sort: { secret: 1 } }, CTX as any)), -32602);
  assert('wd 搜不到 canSync:false 的内容', await names(cp, { wd: 'topsecret' }), [ ]);
  assert('wd 搜不到 canText:false 的内容', await names(cp, { wd: 'zebra' }), [ ]);
  assert('canText:false 仍可 find 精确查', await names(cp, { find: { note: 'zebra coffee' } }), ['paper one']);
  assert('wd 命中 nested 子文档内文本', await names(cp, { wd: 'deep' }), ['paper one']);
  assert('wd 命中普通 text 字段', await names(cp, { wd: 'paper' }), ['paper one']);

  const hidHit = await cp.search({ find: { hidden: 'hid-one' }, limit: 10 }, CTX as any);
  assert('select:false 字段可查', hidHit.total, 1);
  assert('items 默认不含 select:false 字段', (hidHit.items?.[0] as any)?.hidden, undefined);
  const hidCol = await cp.search({ find: { hidden: 'hid-one' }, cols: { hidden: 1 }, limit: 10 }, CTX as any);
  assert('cols 指定可取出 select:false 字段', (hidCol.items?.[0] as any)?.hidden, 'hid-one');

  const c8 = await counts(cp, { });
  assert('counts.status', c8.counts.status, { draft: 1 });

  // 有 select:false 可同步字段时 set 降级 syncFind 回查（含 +field 补偿），改后新值可查
  await (cp.set(String(p8._id), { note: 'zebra tea' }) as unknown as Promise<[any, number]>);
  await refresh(cp);
  assert('set 降级回查后新值可查', await names(cp, { find: { note: 'zebra tea' } }), ['paper one']);

  /* ---------- 9) 任务 13：getFullText 覆盖，只跑 syncFind() 即生效 ---------- */
  console.log('\n--- 9) getFullText 覆盖：追加标签，只跑 syncFind() 即生效 ---');
  await ML.deleteMany({});
  const cplain = new Chaser(schemaL, ML, es);
  await cplain.initIndex();

  await (cplain.add({ name: 'labeled one', status: 'draft' }) as unknown as Promise<[any, string]>);
  await refresh(cplain);
  assert('默认全文无标签：wd TAGDRAFT 不命中', await names(cplain, { wd: 'TAGDRAFT' }), [ ]);

  const cl = new LabeledChaser(schemaL, ML, es);
  await cl.syncFind(undefined, { refresh: 'wait_for' });   // 只重同步文档，不重建索引
  assert('覆盖后 wd 命中追加的标签', await names(cl, { wd: 'TAGDRAFT' }), ['labeled one']);
  assert('覆盖后原文照常命中', await names(cl, { wd: 'labeled' }), ['labeled one']);

  /* ---------- 10) 任务 13：pushMapping 增量推送与 dynamic:'strict' ---------- */
  console.log('\n--- 10) pushMapping 增量推送与 dynamic:strict ---');
  await MM.deleteMany({});
  const cm = new Chaser(schemaM, MM, es);
  await cm.initIndex();
  await (cm.add({ name: 'm one', age: 10 }) as unknown as Promise<[any, string]>);
  await refresh(cm);
  assert('初始 1 条', (await cm.search({ }, CTX as any)).total, 1);

  schemaM.add({ nick: { type: String } });                 // Schema 加字段
  assert('旧实例 mapping 不含新字段（构造期缓存）', 'nick' in cm.getMapping().properties, false);
  const cm2 = new Chaser(schemaM, MM, es);                 // 须重新构造才有新 mapping
  assert('新实例 mapping 含新字段', 'nick' in cm2.getMapping().properties, true);

  assert('pushMapping 返回新增字段', await cm2.pushMapping(), ['nick']);
  assert('再推无新增', await cm2.pushMapping(), [ ]);
  const esMapM = (await es.indices.getMapping({ index: cm2.getIndex() })) as any;
  const esPropsM = esMapM[cm2.getIndex()].mappings.properties;
  assert('ES 侧旧字段定义不变', esPropsM.name, cm2.getMapping().properties.name);
  assert('ES 侧新字段已入 mapping', esPropsM.nick,
    { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } });

  await MM.updateOne({ name: 'm one' }, { $set: { nick: 'nicky' } });   // 绕过 Chaser，ES 滞后
  assert('回填前新字段查不到', await names(cm2, { find: { nick: 'nicky' } }), [ ]);
  const st10 = await cm2.syncFind(undefined, { refresh: 'wait_for' });
  assert('syncFind 回填统计', { total: st10.total, indexed: st10.indexed, deleted: st10.deleted, failed: st10.failed },
    { total: 1, indexed: 1, deleted: 0, failed: 0 });
  assert('回填后新字段可查', await names(cm2, { find: { nick: 'nicky' } }), ['m one']);

  let strictErr: any;
  try {
    await es.index({ index: cm2.getIndex(), id: 'bogus-1', document: { name: 'bogus doc', bogus: true } });
  } catch (e) { strictErr = e; }
  assert('dynamic strict：未声明字段直接写 ES 被拒', /strict/i.test(String(strictErr?.message ?? '')), true);
  await refresh(cm2);
  assert('被拒写入未入库', (await cm2.search({ }, CTX as any)).total, 1);

  /* ---------- 11) 任务 14：同步进阶 ---------- */
  console.log('\n--- 11) 同步进阶：增量水位 / 孤立清理 / syncPurge / 全量重建 ---');
  await MT.deleteMany({});
  const ct = new Chaser(schemaT, MT, es);
  await ct.initIndex();

  await MT.insertMany([ { name: 'inc one', status: 'on' }, { name: 'inc two', status: 'off' } ]);
  const st11a = await ct.syncFind(undefined, { refresh: 'wait_for' });
  assert('全量同步统计', { total: st11a.total, indexed: st11a.indexed, deleted: st11a.deleted, failed: st11a.failed },
    { total: 2, indexed: 2, deleted: 0, failed: 0 });

  await sleep(30);
  const t1 = new Date();   // 增量水位 1
  await sleep(30);
  await MT.insertMany([ { name: 'inc three', status: 'on' } ]);
  await sleep(30);
  const t2 = new Date();   // 增量水位 2
  await sleep(30);
  await MT.insertMany([ { name: 'inc four', status: 'off' } ]);

  const st11b = await ct.syncFind({ updatedAt: { $gte: t1 } }, { refresh: 'wait_for' });
  assert('增量同步只碰水位后的文档', { total: st11b.total, indexed: st11b.indexed, deleted: st11b.deleted, failed: st11b.failed },
    { total: 2, indexed: 2, deleted: 0, failed: 0 });
  assert('增量后 total = 4', (await ct.search({ }, CTX as any)).total, 4);
  const st11c = await ct.syncFind({ updatedAt: { $gte: t2 } }, { refresh: 'wait_for' });
  assert('更晚水位只碰最后一条', st11c.total, 1);

  // 孤立记录：mongo 不存在、直接塞进 ES 且同步戳已旧的文档（id 用合法 ObjectId 形态，
  // 现实中的孤立记录来自 mongo 侧硬删 / 索引滞后，id 本就由 mongo 产生）
  await es.index({
    index: ct.getIndex(), id: '0123456789abcdef01234567',
    document: { name: 'orphan one', status: 'on', fullText: 'orphan one', syntTime: new Date(Date.now() - 60000) },
  });
  await refresh(ct);
  const orphanHit = await ct.search({ find: { name: 'orphan one' }, limit: 10 }, CTX as any);
  assert('孤立记录 ES 命中但回 mongo 丢弃', { total: orphanHit.total, items: orphanHit.items }, { total: 1, items: [ ] });

  const st11d = await ct.syncFind(undefined, { refresh: 'wait_for' });   // 全量：补齐 + 收尾 purge
  assert('全量同步清掉孤立记录', { total: st11d.total, indexed: st11d.indexed, deleted: st11d.deleted, failed: st11d.failed },
    { total: 4, indexed: 4, deleted: 1, failed: 0 });
  assert('孤立记录已清', (await ct.search({ }, CTX as any)).total, 4);

  // 单独 syncPurge：把某条 ES 文档的同步戳改旧，按水位删除（since 早于最近一次全量同步）
  const staleDoc = await MT.findOne({ name: 'inc one' });
  await es.index({
    index: ct.getIndex(), id: String((staleDoc as any)?._id),
    document: { name: 'inc one', status: 'on', syntTime: new Date(Date.now() - 120000) },
  });
  await refresh(ct);
  assert('旧同步戳文档仍在索引', (await ct.search({ }, CTX as any)).total, 4);
  const purge = await ct.syncPurge({ since: new Date(Date.now() - 60000), refresh: true });
  assert('syncPurge 按水位删除', { total: purge.total, indexed: purge.indexed, deleted: purge.deleted, failed: purge.failed },
    { total: 1, indexed: 0, deleted: 1, failed: 0 });
  assert('删除后 total = 3', (await ct.search({ }, CTX as any)).total, 3);
  await ct.syncFind({ name: 'inc one' }, { refresh: 'wait_for' });   // 条件同步补回
  assert('补回后 total = 4', (await ct.search({ }, CTX as any)).total, 4);

  assert('syncPurge 不传 since 抛 PARAMS_INVALID', await errnoOf(() => ct.syncPurge({ refresh: true } as any)), -32602);

  // 全量重建：改字段类型 / 分词只能走这条（有空窗）
  await ct.initIndex();
  assert('重建后索引为空', (await ct.search({ }, CTX as any)).total, 0);
  const st11e = await ct.syncFind(undefined, { refresh: 'wait_for' });
  assert('重建后全量回填', { total: st11e.total, indexed: st11e.indexed, deleted: st11e.deleted, failed: st11e.failed },
    { total: 4, indexed: 4, deleted: 0, failed: 0 });
  const c11 = await counts(ct, { });
  assert('重建后 counts.total', c11.total, 4);
  assert('重建后 counts.status', c11.counts.status, { on: 2, off: 2 });

  /* ---------- 收尾 ---------- */
  await Promise.all([ cf, cn, cs, cz, cp, cplain, cm2, ct ].map(c => c.dropIndex()));
  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
