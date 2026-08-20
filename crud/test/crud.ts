// CRUD 基础功能冒烟测试
// 运行：npm run test:crud
// 前置：本地 MongoDB 已启动（默认 mongodb://127.0.0.1:27017）

import mongoose from 'mongoose';
import { Cradle, CrudError, CrudErrno } from '../src/cruds';

const MONGO_URI = 'mongodb://127.0.0.1:27017/test';
const DB_NAME   = 'test';
const COLL_NAME = 'testCrud';

// schema：含 required/enum/自定义 validator，用于验证 update 路径走 doc.save 后 validator 是否生效
const schema = new mongoose.Schema({
  name  : { type: String, required: true, maxlength: 20 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', refData: { list: 'status' } },
  age   : { type: Number, min: 0, max: 150 },
  tags  : { type: [String] },
  secret: { type: String, select: false },
}, {
  collection: COLL_NAME,
  softDelete: true,   // 启用软删除
  dataList  : {
    status: [
      { value: 'draft'    , title: '草稿'   },
      { value: 'published', title: '已发布' },
      { value: 'archived' , title: '已归档' },
    ],
  },
} as any);

const crud = new Cradle(schema as any);

// 调用包装：Cradle 接口方法返回类型签名是同步，实际是 Promise
async function callCreate(data: any): Promise<any> {
  return await (crud.create({ data }, { uid: 'tester' }) as unknown as Promise<any>);
}
async function callSearch(params: any): Promise<any> {
  return await (crud.search(params, { uid: 'tester' }) as unknown as Promise<any>);
}
async function callUpdate(params: any): Promise<any> {
  return await (crud.update(params, { uid: 'tester' }) as unknown as Promise<any>);
}
async function callDelete(params: any): Promise<any> {
  return await (crud.delete(params, { uid: 'tester' }) as unknown as Promise<any>);
}
async function callSchema(params?: any): Promise<any> {
  return await (crud.schema(params || {}, { uid: 'tester' }) as unknown as Promise<any>);
}
async function callUpsert(params: any): Promise<any> {
  return await (crud.upsert(params, { uid: 'tester' }) as unknown as Promise<any>);
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

async function main(): Promise<void> {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log(`Connected to ${MONGO_URI}/${DB_NAME}`);
  await crud.getModel().deleteMany({});
  console.log(`Cleared collection: ${COLL_NAME}\n`);

  // ---------- 1) schema ----------
  console.log('--- 1) schema() ---');
  const s = await callSchema();
  assertOk('schema $schema 声明', s.$schema === 'https://json-schema.org/draft/2020-12/schema');
  assertOk('schema type = object', s.type === 'object');
  assertOk('schema 含 name 字段', !!s.properties.name);
  assertOk('schema 含 status 字段', !!s.properties.status);
  assertOk('schema.required 含 name', Array.isArray(s.required) && s.required.includes('name'));
  assertOk('schema.name.maxLength = 20', s.properties.name.maxLength === 20);
  assertOk('schema.age minimum/maximum', s.properties.age.minimum === 0 && s.properties.age.maximum === 150);
  assertOk('schema.tags 为 array of string', s.properties.tags.type === 'array' && s.properties.tags.items.type === 'string');
  assertOk('schema.secret 为 writeOnly', s.properties.secret.writeOnly === true);
  assertOk('schema.status 含 x-ref', !!s.properties.status['x-ref']);
  assertOk('schema 含 x-datalist.status', !!s['x-datalist'] && !!s['x-datalist'].status);
  const sCols = await callSchema({ cols: { name: 1 } });
  assertOk('schema cols 只输出 name', Object.keys(sCols.properties).join(',') === 'name');

  // ---------- 2) create ----------
  console.log('\n--- 2) create() ---');
  const c1 = await callCreate({ name: 'alice', status: 'draft'   , age: 20, tags: ['a', 'b'], secret: 's1' });
  const c2 = await callCreate({ name: 'bob'  , status: 'published', age: 25, tags: ['b'] });
  const c3 = await callCreate({ name: 'carol', status: 'archived' , age: 30, tags: [] });
  assertOk('c1 返回 id', typeof c1.id === 'string' && c1.id.length > 0);
  assertOk('c2 返回 id', typeof c2.id === 'string' && c2.id.length > 0);
  assertOk('c3 返回 id', typeof c3.id === 'string' && c3.id.length > 0);

  // required 校验：name 缺失应抛错
  try {
    await callCreate({ status: 'draft' });
    assertOk('create 缺 name 抛错', false);
  } catch (e: any) {
    assertOk('create 缺 name 抛错', /name/.test(e?.message || ''));
  }
  // enum 校验：status 非法值应抛错
  try {
    await callCreate({ name: 'bad', status: 'invalid' });
    assertOk('create 非法 status 抛错', false);
  } catch (e: any) {
    assertOk('create 非法 status 抛错', /status|enum/i.test(e?.message || ''));
  }

  // ---------- 3) search ----------
  console.log('\n--- 3) search() ---');
  // 注意：search 默认 limit = 1，需显式传 limit 才能返回多条
  // 默认返回 list（count 为 undefined）
  const listAll = await callSearch({ limit: 100 });
  assert('返回 3 条', listAll.list.length, 3);
  assertOk('未返回 count', listAll.count === undefined);

  // count: 'all' 同时返回 list + 总数
  const listAll2 = await callSearch({ limit: 100, count: 'all' });
  assert('count:all list = 3', listAll2.list.length, 3);
  assert('count:all count = 3', listAll2.count, 3);

  // count: 'only' 只返回 count
  const onlyCount = await callSearch({ count: 'only' });
  assertOk('count:only 只有 count', onlyCount.count === 3 && !onlyCount.list);

  // count: 'next' 探测下一页
  const next1 = await callSearch({ start: 0, limit: 2, count: 'next' });
  assert('count:next list = 2', next1.list.length, 2);
  assert('count:next count = 1（还有 1 条）', next1.count, 1);
  const next2 = await callSearch({ start: 2, limit: 2, count: 'next' });
  assert('count:next 末页 count = 0', next2.count, 0);

  // find 条件过滤
  const findPub = await callSearch({ limit: 100, find: { status: 'published' } });
  assert('find status=published → 1 条', findPub.list.length, 1);
  assert('find 命中 bob', findPub.list[0].name, 'bob');

  // cols 投影
  const proj = await callSearch({ cols: { name: 1 }, limit: 100, find: { name: 'alice' } });
  assert('cols 只返回 name', Object.keys(proj.list[0].toObject ? proj.list[0].toObject() : proj.list[0]).filter(k => !k.startsWith('_') && k !== '__v').sort(), ['name']);

  // sort
  const sortedDesc = await callSearch({ limit: 100, sort: { age: -1 }, count: 'all' });
  assert('sort age desc → carol/bob/alice',
    sortedDesc.list.map((d: any) => d.name).join(','), 'carol,bob,alice');

  // start + limit 分页
  const page1 = await callSearch({ sort: { age: 1 }, start: 0, limit: 2 });
  const page2 = await callSearch({ sort: { age: 1 }, start: 2, limit: 2 });
  assert('page1 = alice,bob', page1.list.map((d: any) => d.name).join(','), 'alice,bob');
  assert('page2 = carol'    , page2.list.map((d: any) => d.name).join(','), 'carol');

  // 按 id 查
  const byId = await callSearch({ id: c1.id });
  assert('按 id 查到 alice', byId.list[0].name, 'alice');
  const byIds = await callSearch({ limit: 100, id: [c1.id, c2.id] });
  assert('按 id 数组查到 2 条', byIds.list.length, 2);

  // select: false，search 默认不返回
  const secretHidden = await callSearch({ id: c1.id });
  const secretDoc    = secretHidden.list[0].toObject ? secretHidden.list[0].toObject() : secretHidden.list[0];
  assertOk('select:false 字段默认不返回（secret 不可见）', secretDoc.secret === undefined);

  // ---------- 4) update ----------
  console.log('\n--- 4) update() ---');
  // 单条更新
  const u1 = await callUpdate({ id: c1.id, data: { age: 21 } });
  assert('单条 update count = 1', u1.count, 1);
  const afterU1 = await callSearch({ id: c1.id });
  assert('update 后 age = 21', afterU1.list[0].age, 21);

  // 值未变（同值 update）→ count = 0
  const u1Same = await callUpdate({ id: c1.id, data: { age: 21 } });
  assert('同值 update count = 0', u1Same.count, 0);

  // 批量更新
  const uMulti = await callUpdate({ id: [c1.id, c2.id, c3.id], data: { tags: ['updated'] } });
  assert('批量 update count = 3', uMulti.count, 3);
  const afterUMulti = await callSearch({ limit: 100, find: { 'tags': 'updated' } });
  assert('批量更新后 3 条都含 updated', afterUMulti.list.length, 3);

  // update 走 doc.save，自定义 enum 校验生效
  try {
    await callUpdate({ id: c1.id, data: { status: 'invalid' } });
    assertOk('update 非法 status 抛错（doc.save validator）', false);
  } catch (e: any) {
    assertOk('update 非法 status 抛错（doc.save validator）', /status|enum/i.test(e?.message || ''));
  }

  // update 不存在 id 且不传 force（默认 falsy）→ 抛 UNOPERABLE
  try {
    await callUpdate({ id: '507f1f77bcf86cd799439011', data: { age: 99 } });
    assertOk('update 不存在 id (不传 force) 抛 UNOPERABLE', false);
  } catch (e: any) {
    assertOk('update 不存在 id (不传 force) 抛 UNOPERABLE',
      e instanceof CrudError && e.code === CrudErrno.ALTER_REJECTED);
  }

  // update 不存在 id 且 force=false → 抛 UNOPERABLE
  try {
    await callUpdate({ id: '507f1f77bcf86cd799439011', data: { age: 99 }, force: false });
    assertOk('update 不存在 id (force=false) 抛 UNOPERABLE', false);
  } catch (e: any) {
    assertOk('update 不存在 id (force=false) 抛 UNOPERABLE',
      e instanceof CrudError && e.code === CrudErrno.ALTER_REJECTED);
  }

  // update 不存在 id 但 force=true → 不抛错，count = 0
  const uForce = await callUpdate({ id: '507f1f77bcf86cd799439011', data: { age: 99 }, force: true });
  assert('update 不存在 id (force=true) count = 0', uForce.count, 0);

  // ---------- 5) delete ----------
  console.log('\n--- 5) delete()（软删除） ---');
  const d1 = await callDelete({ id: c3.id });
  assert('软删 1 条 count = 1', d1.count, 1);

  // 软删后 search 默认查不到（自动应用 softDeleteCond）
  const afterDel = await callSearch({ id: c3.id });
  assert('软删后 search 查不到', afterDel.list.length, 0);

  // 但文档仍存在（只是 isDeleted=true, isDeleted 为 select:false 需显式选取）
  const rawDoc: any = await crud.getModel().findById(c3.id).select('+isDeleted').lean().exec();
  assertOk('文档仍在库中（isDeleted=true）', rawDoc && rawDoc.isDeleted === true);

  // 重复软删同一条 → 值未变，count = 0
  const d1Again = await callDelete({ id: c3.id });
  assert('重复软删 count = 0', d1Again.count, 0);

  // 批量软删
  const dMulti = await callDelete({ id: [c1.id, c2.id] });
  assert('批量软删 count = 2', dMulti.count, 2);
  const afterMulti = await callSearch({});
  assert('全部软删后 list = 0', afterMulti.list.length, 0);

  // delete 不存在 id 且 force=false → 抛 UNOPERABLE
  try {
    await callDelete({ id: '507f1f77bcf86cd799439011', force: false });
    assertOk('delete 不存在 id (force=false) 抛 UNOPERABLE', false);
  } catch (e: any) {
    assertOk('delete 不存在 id (force=false) 抛 UNOPERABLE',
      e instanceof CrudError && e.code === CrudErrno.ALTER_REJECTED);
  }

  // delete 不存在 id 但 force=true → 不抛错
  const dForce = await callDelete({ id: '507f1f77bcf86cd799439011', force: true });
  assert('delete 不存在 id (force=true) count = 0', dForce.count, 0);

  // ---------- 6) 软删除 + find 联动 ----------
  console.log('\n--- 6) 软删除与 find 联动 ---');
  await crud.getModel().deleteMany({});
  await callCreate({ name: 'p1', status: 'draft', age: 10 });
  await callCreate({ name: 'p2', status: 'draft', age: 20 });
  // 软删 p1
  const p1 = await callSearch({ find: { name: 'p1' } });
  await callDelete({ id: p1.list[0]._id.toString() });
  // 默认 search 只返回未软删
  const remain = await callSearch({ find: { status: 'draft' } });
  assert('软删后 search 只剩 p2', remain.list.map((d: any) => d.name).join(','), 'p2');
  // count: 'all' 也应只算未软删
  const remainCount = await callSearch({ find: { status: 'draft' }, count: 'all' });
  assert('count:all 也排除软删', remainCount.count, 1);

  // ---------- 7) upsert ----------
  console.log('\n--- 7) upsert() ---');
  await crud.getModel().deleteMany({});

  // 先创建一条，拿到已存在的 _id 用于更新测试
  const existDoc = await callCreate({ name: 'exist', status: 'draft', age: 18 });

  const imp = await callUpsert({
    list: [
      // 没 _id → 添加
      { name: 'new1', status: 'draft', age: 22 },
      // 有 _id 且存在 → 更新
      { _id: existDoc.id, name: 'exist-updated', age: 33 },
      // 有 _id 但不存在 → 报错
      { _id: '507f1f77bcf86cd799439011', name: 'ghost', status: 'draft' },
      // 校验失败（缺 name + 非法 status）→ 报错
      { status: 'invalid' },
    ],
  });
  assert('upsert created = 1', imp.created, 1);
  assert('upsert updated = 1', imp.updated, 1);
  assert('upsert errors = 2', imp.errors.length, 2);

  // 有 _id 但找不到：只有 message，无 errors
  const errNotFound = imp.errors.find((e: any) => e.index === 2);
  assertOk('not-found 错误 index=2', !!errNotFound && errNotFound.index === 2);
  assertOk('not-found 只有 message', !!errNotFound && !!errNotFound.message && !errNotFound.errors);

  // 校验失败：有 message + errors
  const errValid = imp.errors.find((e: any) => e.index === 3);
  assertOk('validation 错误 index=3', !!errValid && errValid.index === 3);
  assertOk('validation 含 errors.name', !!errValid && !!errValid.errors && !!errValid.errors.name);

  // 验证更新生效
  const updatedDoc = await callSearch({ id: existDoc.id });
  assert('upsert 更新后 age = 33', updatedDoc.list[0].age, 33);
  assert('upsert 更新后 name = exist-updated', updatedDoc.list[0].name, 'exist-updated');

  // 验证添加生效
  const addedDoc = await callSearch({ find: { name: 'new1' } });
  assert('upsert 添加 new1 成功', addedDoc.list.length, 1);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  await mongoose.disconnect();
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
