// Roster 集成测试（src/kv 注册器 + src/kv/mongo 的 MongoRoster）
// 运行：npm run test:kv:mongo
// 前置：本地 MongoDB（mongodb://127.0.0.1:27017）已启动

import mongoose from 'mongoose';
import kv, { regRoster, getRoster } from '../src/kv';
import { MongoRoster } from '../src/kv/mongo';

const MONGO_URI  = 'mongodb://127.0.0.1:27017/test';
const COLLECTION = 'testRoster';

/* ---------- 断言工具（与 test/crud.ts 一致） ---------- */

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
  await mongoose.connection.dropCollection(COLLECTION).catch(() => {});   // 清场

  const sleep  = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
  const roster = new MongoRoster(COLLECTION);

  /* ---------- 0) 注册器：regRoster / getRoster / 默认导出 ---------- */
  console.log('--- 0) 注册器：regRoster / getRoster / 默认导出 ---');
  let errCode: number | undefined;
  try { getRoster(); } catch (e: any) { errCode = e?.code; }
  assert('getRoster 未注册抛 INTERNEL_ERROR', errCode, -32603);
  regRoster(roster);
  assert('regRoster 后 getRoster 返回同一实例', getRoster() === roster, true);
  const viaGet = getRoster();
  await viaGet.set('kv:reg', 'ok', 60);
  assert('getRoster 单例可直接存取', await roster.get('kv:reg'), 'ok');
  await kv.set('kv:def', 'ok', 60);   // 默认导出惰性取 getRoster，可直接使用
  assert('默认导出 kv 可直接存取', await kv.get('kv:def'), 'ok');
  assert('默认导出 kv 与注册器为同一单例', await kv.get('kv:reg'), 'ok');

  /* ---------- 1) set / get ---------- */
  console.log('\n--- 1) set / get：number 与 Date 有效期、覆盖、值类型 ---');
  await roster.set('kv:str' , 'hello', 60);
  await roster.set('kv:date', 'world', new Date(Date.now() + 60000));
  assert('get 取到 number 秒数有效期', await roster.get('kv:str'), 'hello');
  assert('get 取到 Date 到期时间', await roster.get('kv:date'), 'world');

  await roster.set('kv:over', 'first' , 60);
  await roster.set('kv:over', 'second', 60);
  assert('同 key 覆盖', await roster.get('kv:over'), 'second');

  await roster.set('kv:arr', [1, 2, 3], 60);
  assert('数组值原样存取', await roster.get('kv:arr'), [1, 2, 3]);
  await roster.set('kv:obj', { a: 1, b: [2] }, 60);
  assert('对象值原样存取', await roster.get('kv:obj'), { a: 1, b: [2] });

  assert('不存在的键返回 null', await roster.get('kv:none'), null);

  /* ---------- 2) getAll：完整记录 ---------- */
  console.log('\n--- 2) getAll：完整记录 ---');
  await roster.set('kv:rec', 'v1', 60);
  const rec = await roster.getAll('kv:rec');
  assert('getAll 返回键', rec?.key, 'kv:rec');
  assert('getAll 返回值', rec?.value, 'v1');
  assert('getAll 的 expiresAt 在未来', rec!.expiresAt instanceof Date && rec!.expiresAt.getTime() > Date.now(), true);
  assert('getAll 的 createdAt 为时间戳', rec!.createdAt instanceof Date && ! isNaN(rec!.createdAt.getTime()), true);
  assert('getAll 的 updatedAt 为时间戳', rec!.updatedAt instanceof Date && ! isNaN(rec!.updatedAt.getTime()), true);
  assert('getAll 不存在的键返回 null', await roster.getAll('kv:none'), null);

  /* ---------- 3) getAndDel / getAllAndDel ---------- */
  console.log('\n--- 3) getAndDel / getAllAndDel ---');
  await roster.set('kv:gone', 'once', 60);
  assert('getAndDel 首次取到值', await roster.getAndDel('kv:gone'), 'once');
  assert('getAndDel 二次为 null', await roster.getAndDel('kv:gone'), null);

  await roster.set('kv:gone2', { a: 1 }, 60);
  const rec2 = await roster.getAllAndDel('kv:gone2');
  assert('getAllAndDel 返回记录的键与值', { key: rec2?.key, value: rec2?.value }, { key: 'kv:gone2', value: { a: 1 } });
  assert('getAllAndDel 后记录已删', await roster.get('kv:gone2'), null);

  /* ---------- 4) 过期视同不存在 ---------- */
  console.log('\n--- 4) 过期视同不存在 ---');
  await roster.set('kv:old', 'x', new Date(Date.now() - 1000));
  assert('set 过去时间后 get 为 null', await roster.get('kv:old'), null);
  assert('set 过去时间后 getAll 为 null', await roster.getAll('kv:old'), null);

  await roster.set('kv:c1s', 'y', 1);
  assert('未过期前可取到', await roster.get('kv:c1s'), 'y');
  await sleep(1100);
  assert('到期后 get 为 null', await roster.get('kv:c1s'), null);

  /* ---------- 5) del ---------- */
  console.log('\n--- 5) del：删除与幂等 ---');
  await roster.set('kv:del', 'z', 60);
  await roster.del('kv:del');
  assert('del 后取不到', await roster.get('kv:del'), null);
  await roster.del('kv:del');   // 不存在时无效果
  assert('del 幂等：不存在的键不抛错', await roster.get('kv:del'), null);

  /* ---------- 6) 实例间共享（model 缓存） ---------- */
  console.log('\n--- 6) 实例间共享：同集合另一实例读到同一数据 ---');
  await roster.set('kv:shared', 'shared', 60);
  const roster2 = new MongoRoster(COLLECTION);
  assert('另一实例取到同一数据', await roster2.get('kv:shared'), 'shared');

  /* ---------- 7) cleanup ---------- */
  console.log('\n--- 7) cleanup：默认 7 天前与显式 cutoff ---');
  await roster.set('kv:expired', 'e', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
  assert('cleanup 默认只清 7 天前', await roster.cleanup(), 1);
  assert('未过期的不受影响', await roster.get('kv:str'), 'hello');
  assert('cleanup 显式传当前时间清掉其余过期记录', await roster.cleanup(new Date()), 2);
  assert('未过期的仍在', await roster.get('kv:shared'), 'shared');

  /* ---------- 收尾 ---------- */
  await mongoose.connection.dropCollection(COLLECTION).catch(() => {});
  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
