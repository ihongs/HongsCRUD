// KV_ROSTER 环境变量自动注册测试（src/kv）
// 运行：npm run test:kv:env
// 前置：本地 MongoDB（mongodb://127.0.0.1:27017）已启动

import mongoose from 'mongoose';
import { getRoster } from '../src/kv';
import { MongoRoster } from '../src/kv/mongo';

const MONGO_URI  = 'mongodb://127.0.0.1:27017/test';
const COLLECTION = 'testRosterEnv';

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

  /* ---------- 1) 未设 KV_ROSTER：getRoster 报错 ---------- */
  console.log('--- 1) 未设 KV_ROSTER：getRoster 报错 ---');
  let errCode: number | undefined;
  try { getRoster(); } catch (e: any) { errCode = e?.code; }
  assert('未设 KV_ROSTER 抛 INTERNEL_ERROR', errCode, -32603);

  /* ---------- 2) KV_ROSTER 自动注册（无参构造读环境变量） ---------- */
  console.log('--- 2) KV_ROSTER 自动注册：默认导出动态加载 ---');
  // './' 开头相对 cwd 解析；dist-test/src 与本测试 import 的 '../src' 编译后指向同一副本，可 instanceof
  process.env.KV_ROSTER            = './dist-test/src/kv/mongo';
  process.env.KV_ROSTER_COLLECTION = COLLECTION;
  const roster = getRoster();
  assert('自动注册得到 MongoRoster', roster instanceof MongoRoster, true);
  assert('二次 getRoster 返回同一单例', getRoster() === roster, true);
  await roster.set('kv:env', 'ok', 60);
  assert('自动注册的 roster 可存取', await roster.get('kv:env'), 'ok');
  const n = await mongoose.connection.db!.collection(COLLECTION).countDocuments({ key: 'kv:env' });
  assert('无参构造读 KV_ROSTER_COLLECTION（记录落在指定集合）', n, 1);

  /* ---------- 收尾 ---------- */
  await mongoose.connection.dropCollection(COLLECTION).catch(() => {});
  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
