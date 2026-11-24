// cs/Chaser 冒烟测试：分词写入 _text、wd 分词检索、打分排序、statis
// 运行：npm run test:cs
// 前置：本地 MongoDB 已启动（默认 mongodb://127.0.0.1:27017）

import mongoose from 'mongoose';
import { Chaser } from '../src/cs';

const MONGO_URI = 'mongodb://127.0.0.1:27017/test';
const DB_NAME   = 'test';
const COLL_NAME = 'testChaserCs';
const CTX       = { uid: 'tester', roles: ['tester'] };

// _text / _score 由组件自动补；secret 为 select: false 的 textable 字段
const schema = new mongoose.Schema({
  username: { type: String, textable: true, countable: true },
  name    : { type: String, textable: true },
  email   : { type: String, textable: true },
  phone   : { type: String, textable: true },
  secret  : { type: String, textable: true, select: false },
  status  : { type: String, countable: true },
}, { collection: COLL_NAME, csAutoIndex: true } as any);

const chaser = new Chaser(schema as any);
const Model  = chaser.getModel();

async function add(data: Record<string, any>): Promise<any> {
  const [ doc ] = await (chaser.add(data) as unknown as Promise<[ any, string ]>);
  return doc;
}
async function search(params: Record<string, any>): Promise<any> {
  return await (chaser.search({ limit: 20, ...params }, CTX) as unknown as Promise<any>);
}
async function statis(params: Record<string, any>): Promise<any> {
  return await (chaser.statis(params, CTX) as unknown as Promise<any>);
}

// 深度相等比较（不关心对象 key 顺序）
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

let pass = 0;
let fail = 0;
function assert(name: string, actual: any, expected: any): void {
  const ok = deepEqual(actual, expected);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual  : ${JSON.stringify(actual)}`);
  }
}
function assertOk(name: string, cond: boolean, info?: string): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else      { fail++; console.log(`  ✗ ${name}${info ? '  ' + info : ''}`); }
}

// 结果转「名称/用户名」便于断言
function names(list: any[]): string[] {
  return list.map(d => `${d.name}/${d.username}`);
}
function hitMap(list: any[]): Record<string, number> {
  return Object.fromEntries((list || []).map(h => [h.value, h.count]));
}

async function main(): Promise<void> {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log(`Connected to ${MONGO_URI}/${DB_NAME}`);
  await Model.collection.drop().catch(() => {});
  await Model.createCollection().catch(() => {});
  await Model.createIndexes();   // 集合被删后重建索引，确保 _text text 索引存在
  console.log(`Cleared collection: ${COLL_NAME}\n`);

  // ---------- 1) 索引与字段 ----------
  console.log('--- 1) 索引与自动字段 ---');
  const idx = await Model.collection.indexes();
  assertOk('存在 _text text 索引', idx.some(i => i.name === '_text_text'));
  assertOk('schema 自动补 _text 字段', !!schema.path('_text'));
  assertOk('schema 自动补 _score 字段', !!schema.path('_score'));
  assert('参与全文的字段', [...chaser.getTextable()], ['username', 'name', 'email', 'phone', 'secret']);

  // ---------- 2) 写入 _text ----------
  console.log('\n--- 2) add 写入 _text ---');
  const d1 = await add({ username: 'b', name: '管理员', email: 'abc@def.cn', phone: '13800138000', secret: '机密内容', status: 'on' });
  const d2 = await add({ username: 'a', name: '张三丰', status: 'on' });
  const d3 = await add({ username: 'z', name: '测试', status: 'off' });
  const d4 = await add({ username: '测试', name: '测试', status: 'off' });
  const raw1 = await Model.collection.findOne({ _id: d1._id });
  assert('_text 落库（含 select:false 的 secret）',
    raw1!._text, 'b 管理 员 abc def.cn 13800138000 机密 内容');

  // ---------- 3) wd 分词检索 ----------
  console.log('\n--- 3) wd 分词检索 ---');
  assert('wd=管理 命中 管理员', names((await search({ wd: '管理' })).list), ['管理员/b']);
  assert('wd=abc 命中邮箱', names((await search({ wd: 'abc' })).list), ['管理员/b']);
  assert('wd=张三 命中 张三丰', names((await search({ wd: '张三' })).list), ['张三丰/a']);
  assert('wd=机密 命中 secret 字段', names((await search({ wd: '机密' })).list), ['管理员/b']);
  assert('only-total 总数', (await search({ wd: '测试', mode: 'only-total' })).total, 2);

  // ---------- 4) 打分与排序 ----------
  console.log('\n--- 4) 打分与排序 ---');
  const byScore = (await search({ wd: '测试' })).list;
  assert('默认按 _score 降序', names(byScore), ['测试/测试', '测试/z']);
  assertOk('结果带 _score', typeof byScore[0].toObject()._score === 'number');
  const bySort = (await search({ wd: '测试', sort: { username: 1 } })).list;
  assert('外部 sort 优先，_score 仅透出', names(bySort), ['测试/z', '测试/测试']);
  assertOk('外部 sort 下 _score 仍在', typeof bySort[0].toObject()._score === 'number');
  const white = (await search({ wd: '测试', cols: { username: 1 } })).list;
  assert('cols 白名单附带 _score', Object.keys(white[0].toObject()), ['_id', 'username', '_score']);

  // ---------- 5) set 重算 _text ----------
  console.log('\n--- 5) set 重算 _text ---');
  await (chaser.set(String(d1._id), { name: '李四' }) as unknown as Promise<[ any, number ]>);
  assert('旧词 管理 不再命中', names((await search({ wd: '管理' })).list), []);
  assert('新词 李四 命中', names((await search({ wd: '李四' })).list), ['李四/b']);
  assert('secret 内容保留', names((await search({ wd: '机密' })).list), ['李四/b']);
  const raw1b = await Model.collection.findOne({ _id: d1._id });
  assert('_text 已更新', raw1b!._text, 'b 李 四 abc def.cn 13800138000 机密 内容');

  // ---------- 6) statis 同样处理 wd ----------
  console.log('\n--- 6) statis ---');
  const st1 = await statis({ wd: '管理' });
  assert('statis wd 分词后 total',  st1.total, 0);   // d1 已改名，无命中
  const st2 = await statis({ wd: '李四' });
  assert('statis wd=李四 total', st2.total, 1);
  assert('statis username 桶', hitMap(st2.hits.username), { b: 1 });
  assert('statis status 桶', hitMap(st2.hits.status), { on: 1 });
  const st3 = await statis({});
  assert('statis 无 wd total', st3.total, 4);
  assert('statis 无 wd status 桶', hitMap(st3.hits.status), { on: 2, off: 2 });

  /* ---------- 收尾 ---------- */
  await Model.collection.drop().catch(() => {});
  await mongoose.disconnect();
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
