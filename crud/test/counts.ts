// counts 接口的简单冒烟测试
// 运行：npm run test:counts
// 前置：本地 MongoDB 已启动（默认 mongodb://127.0.0.1:27017）

import mongoose from 'mongoose';
import { Cradle } from '../src/cruds';

const MONGO_URI = 'mongodb://127.0.0.1:27017/test';
const DB_NAME   = 'test';
const COLL_NAME = 'testCounts';

// schema 声明两个 countable 字段（字段内部 countable: true）
const schema = new mongoose.Schema({
  name  : { type: String },
  status: { type: String, enum: ['draft', 'published', 'archived'], countable: true },
  role  : { type: String, enum: ['admin', 'user'], countable: true },
  age   : { type: Number },
}, {
  collection: COLL_NAME,
} as any);

const crud = new Cradle(schema as any);

// 调用工具：counts 实际返回 Promise，类型签名是同步，这里统一 await
async function callCounts(params: any): Promise<any> {
  return await (crud.counts(params, { uid: 'tester' }) as unknown as Promise<any>);
}

// 深度相等比较（不关心对象 key 顺序，只比较内容）
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
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log(`Connected to ${MONGO_URI}/${DB_NAME}`);

  // 清空集合
  await crud.getModel().deleteMany({});
  console.log(`Cleared collection: ${COLL_NAME}`);

  // 准备测试数据（共 6 条）
  //  status    role    age
  //  draft     admin   20
  //  draft     user    25
  //  draft     user    30
  //  published admin   22
  //  published user    28
  //  archived  admin   35
  await crud.getModel().insertMany([
    { name: 'a1', status: 'draft'    , role: 'admin', age: 20 },
    { name: 'a2', status: 'draft'    , role: 'user' , age: 25 },
    { name: 'a3', status: 'draft'    , role: 'user' , age: 30 },
    { name: 'a4', status: 'published', role: 'admin', age: 22 },
    { name: 'a5', status: 'published', role: 'user' , age: 28 },
    { name: 'a6', status: 'archived' , role: 'admin', age: 35 },
  ]);
  console.log('Inserted 6 test docs\n');

  // ---------- 1) 基础统计 ----------
  console.log('--- 1) 基础统计：全部 countable 字段 ---');
  const r1 = await callCounts({});
  assert('total = 6', r1.count, 6);
  assert('counts.status', r1.counts.status, { draft: 3, published: 2, archived: 1 });
  assert('counts.role'  , r1.counts.role  , { admin: 3, user: 3 });

  // ---------- 2) cols 白名单 ----------
  console.log('\n--- 2) cols 白名单：只统计 status ---');
  const r2 = await callCounts({ cols: { status: 1 } });
  assert('total = 6', r2.count, 6);
  assert('counts 只含 status', Object.keys(r2.counts).sort(), ['status']);
  assert('counts.status', r2.counts.status, { draft: 3, published: 2, archived: 1 });

  // ---------- 3) sels 联动（status 已选 draft） ----------
  //   status: 排除自身条件，返回全量分布（draft/published/archived）
  //   role  : 应用 status=draft 条件，只看 draft 文档的 role 分布
  console.log('\n--- 3) sels 联动：sels.status = [draft] ---');
  const r3 = await callCounts({ sels: { status: ['draft'] } });
  assert('total = 3（draft 的 3 条）', r3.count, 3);
  assert('counts.status（不应用自身 sels，全量）', r3.counts.status, { draft: 3, published: 2, archived: 1 });
  assert('counts.role（应用 status=draft 过滤）', r3.counts.role, { admin: 1, user: 2 });

  // ---------- 4) sels 空数组（等同没传） ----------
  console.log('\n--- 4) sels 空数组：sels.status = [] ---');
  const r4 = await callCounts({ sels: { status: [] } });
  assert('total = 6（空 sels 不影响）', r4.count, 6);
  assert('counts.status', r4.counts.status, { draft: 3, published: 2, archived: 1 });
  assert('counts.role'  , r4.counts.role  , { admin: 3, user: 3 });

  // ---------- 5) top 限制 ----------
  console.log('\n--- 5) top = 1：每个字段只取 count 最高的 1 个 ---');
  const r5 = await callCounts({ top: 1 });
  // status: draft(3) > published(2) > archived(1) → 只剩 draft:3
  // role  : admin(3) === user(3)，$sort 后顺序不稳定，只会剩 1 个
  assert('counts.status 只剩 1 项', Object.keys(r5.counts.status), ['draft']);
  assert('counts.status.draft = 3', r5.counts.status.draft, 3);
  assert('counts.role 只剩 1 项', r5.counts.role.length ?? Object.keys(r5.counts.role).length, 1);

  // ---------- 6) find 过滤 ----------
  console.log('\n--- 6) find: age >= 28 ---');
  const r6 = await callCounts({ find: { age: { $gte: 28 } } });
  // age >= 28 的文档：
  //   a3 draft    user  30
  //   a5 published user  28
  //   a6 archived  admin 35
  assert('total = 3', r6.count, 3);
  assert('counts.status', r6.counts.status, { draft: 1, published: 1, archived: 1 });
  assert('counts.role'  , r6.counts.role  , { user: 2, admin: 1 });

  // 清理（可选：保留便于查看数据）
  // await crud.getModel().deleteMany({});
  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
