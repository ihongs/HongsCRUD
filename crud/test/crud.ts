// CRUD 基础功能冒烟测试（含 statis 接口）
// 运行：npm run test:crud
// 前置：本地 MongoDB 已启动（默认 mongodb://127.0.0.1:27017）

import mongoose from 'mongoose';
import { Cradle, CrudError, CrudErrno, callFunc, getRefIds, getRefPaths, regFunc, regCrud, regRole, regHook, hookPermits } from '../src/index';

const MONGO_URI = 'mongodb://127.0.0.1:27017/test';
const DB_NAME   = 'test';
const COLL_NAME = 'testCrud';

// schema：含 required/enum/自定义 validator，用于验证 update 路径走 doc.save 后 validator 是否生效
const schema = new mongoose.Schema({
  name  : { type: String, required: true, maxlength: 20 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft',
            countable: true,
            enumTags : { draft: '草稿', published: '已发布', archived: '已归档' },
            reference: { method: 'test-status-refs' } },
  age   : { type: Number, min: 0, max: 150 },
  tags  : { type: [String] },
  owner : { type: mongoose.Schema.Types.ObjectId, reference: { method: 'crud-test.search' } },
  secret: { type: String, select: false },
  code  : { type: String, readable: false },
  // 多字段同 refName 聚集：workplace / birthplace 同指 area
  workplace : { type: String, reference: { method: 'test-area-refs', refName: 'area' } },
  birthplace: { type: String, reference: { method: 'test-area-refs', refName: 'area' } },
}, {
  collection: COLL_NAME,
  softDelete: true,   // 启用软删除
} as any);

const crud = new Cradle(schema as any);

// statis 测试专用 schema：双 countable 字段（status/role）+ refName 聚集（stat）
const statisSchema = new mongoose.Schema({
  name  : { type: String },
  status: { type: String, enum: ['draft', 'published', 'archived'], countable: true,
            reference: { method: 'test-status-refs', refName: 'stat' } },
  role  : { type: String, enum: ['admin', 'user'], countable: true },
  age   : { type: Number },
}, {
  collection: 'testStatis',
} as any);

const statisCrud = new Cradle(statisSchema as any);

// refs 数据源 1：regFunc 注册的 FUNCS（返回 {list: [...]}）
regFunc('test-status-refs', async () => ({
  list: [
    { _id: 'draft'    , name: '草稿'   },
    { _id: 'published', name: '已发布' },
    { _id: 'archived' , name: '已归档' },
  ],
}));

// refs 数据源 2：regCrud 注册的 CRUDS（走 crud.search 回表取关联文档）
regCrud('crud-test', crud);

// refs 数据源 3：多字段同 refName 聚集（按 idParam 过滤，验证合并收集）
regFunc('test-area-refs', async (params: any) => {
  const all = [
    { _id: 'beijing'  , name: '北京' },
    { _id: 'shanghai' , name: '上海' },
    { _id: 'guangzhou', name: '广州' },
  ];
  const ids = Array.isArray(params?.id) ? params.id : [];
  return { list: all.filter(a => ids.includes(a._id)) };
});

// 角色 tester 放行三个 refs 方法 + 四个钩子测试方法
regRole('tester', ['test-status-refs', 'crud-test.search', 'test-area-refs', 'test-hook-pass', 'test-hook-bare', 'test-hook-vip', 'test-hook-ctx']);

// 调用包装：Cradle 接口方法返回类型签名是同步，实际是 Promise
async function callCreate(data: any): Promise<any> {
  return await (crud.create({ data }, { uid: 'tester', roles: ['tester'] }) as unknown as Promise<any>);
}
async function callSearch(params: any): Promise<any> {
  return await (crud.search(params, { uid: 'tester', roles: ['tester'] }) as unknown as Promise<any>);
}
async function callUpdate(params: any): Promise<any> {
  return await (crud.update(params, { uid: 'tester', roles: ['tester'] }) as unknown as Promise<any>);
}
async function callDelete(params: any): Promise<any> {
  return await (crud.delete(params, { uid: 'tester', roles: ['tester'] }) as unknown as Promise<any>);
}
async function callSchema(params?: any): Promise<any> {
  return await (crud.schema(params || {}, { uid: 'tester', roles: ['tester'] }) as unknown as Promise<any>);
}
async function callUpsert(params: any): Promise<any> {
  return await (crud.upsert(params, { uid: 'tester', roles: ['tester'] }) as unknown as Promise<any>);
}
async function callStatis(c: Cradle, params: any): Promise<any> {
  return await (c.statis(params, { uid: 'tester', roles: ['tester'] }) as unknown as Promise<any>);
}

// hits 数组转 {value: count} 映射，消除桶内排序的不确定性
function hitMap(list: any[]): Record<string, number> {
  return Object.fromEntries((list || []).map(h => [h.value, h.count]));
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
  assertOk('schema.code 为 writeOnly（readable: false）', s.properties.code.writeOnly === true);
  assertOk('schema.status 含 x-reference', !!s.properties.status['x-reference']);
  assertOk('schema.status 含 x-enum-tags', s.properties.status['x-enum-tags']?.draft === '草稿');
  assertOk('schema.owner 含 x-reference', !!s.properties.owner['x-reference']);
  assertOk('schema 无顶层 x-references', s['x-references'] === undefined);
  const sCols = await callSchema({ cols: { name: 1 } });
  assertOk('schema cols 只输出 name', Object.keys(sCols.properties).join(',') === 'name');

  // ---------- 2) create ----------
  console.log('\n--- 2) create() ---');
  const c1 = await callCreate({ name: 'alice', status: 'draft'   , age: 20, tags: ['a', 'b'], secret: 's1', workplace: 'shanghai', birthplace: 'beijing' });
  const c2 = await callCreate({ name: 'bob'  , status: 'published', age: 25, tags: ['b'], workplace: 'beijing', birthplace: 'shanghai' });
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
  // 默认返回 { list, total }
  const listAll = await callSearch({ limit: 100 });
  assertOk('no mode 返回 3 条', listAll.list.length === 3 && listAll.total === 3);

  // mode: 'only-list' 只返回 list
  const onlyList = await callSearch({ mode: 'only-list' });
  assertOk('mode:only-list 只有 list', onlyList.list && onlyList.count === undefined);

  // mode: 'only-total' 只返回 total
  const onlyCount = await callSearch({ mode: 'only-total' });
  assertOk('mode:only-total 只有 total', onlyCount.total && onlyCount.list === undefined);

  // mode: 'list-more' 探测更多
  const next1 = await callSearch({ start: 0, limit: 2, mode: 'list-more' });
  assert('mode:list-more list = 2', next1.list.length, 2);
  assert('mode:list-more more = true' , next1.more, true );
  const next2 = await callSearch({ start: 2, limit: 2, mode: 'list-more' });
  assert('mode:list-more more = false', next2.more, false);

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

  // ---------- 3.5) search refs ----------
  console.log('\n--- 3.5) search refs ---');
  // c1.owner 指向 c2，走 crud-test.search 回表
  await callUpdate({ id: c1.id, data: { owner: c2.id } });

  const refAll = await callSearch({ limit: 100, refs: true });
  assertOk('refs.status 是行数组', Array.isArray(refAll.refs?.['status']));
  assertOk('refs.status 三行', refAll.refs?.['status']?.length === 3);
  assertOk('refs.status 含 draft 草稿行', !!refAll.refs?.['status']?.find((r: any) => r._id === 'draft' && r.name === '草稿'));
  assertOk('refs.status 含 published 已发布行', !!refAll.refs?.['status']?.find((r: any) => r._id === 'published' && r.name === '已发布'));
  assertOk('refs.status 含 archived 已归档行', !!refAll.refs?.['status']?.find((r: any) => r._id === 'archived' && r.name === '已归档'));
  assertOk('refs.owner 是行数组', Array.isArray(refAll.refs?.['owner']));
  assertOk('refs.owner 含 bob 行', !!refAll.refs?.['owner']?.find((r: any) => String(r._id) === c2.id && r.name === 'bob'));

  // refs 白名单：只取 owner
  const refSome = await callSearch({ limit: 100, refs: { owner: 1 } });
  assertOk('refs: {owner: 1} 只有 owner', Object.keys(refSome.refs || {}).join(',') === 'owner');
  assertOk('refs: {owner: 1} 取到 bob', !!refSome.refs?.['owner']?.find((r: any) => String(r._id) === c2.id && r.name === 'bob'));

  // refs 白名单：按 name 命中 status
  const refByNum = await callSearch({ limit: 100, refs: { status: 1 } });
  assertOk('refs: {status: 1} 只有 status', Object.keys(refByNum.refs || {}).join(',') === 'status');

  // 多字段同 refName 聚集：workplace / birthplace 同指 area，合并收集后一起查
  // c1: workplace=shanghai birthplace=beijing；c2: workplace=beijing birthplace=shanghai（交叉重复验证去重）
  const refArea = await callSearch({ limit: 100, refs: { area: 1 } });
  assertOk('refs: {area: 1} 键为 area', Object.keys(refArea.refs || {}).join(',') === 'area');
  assertOk('refs.area 是行数组', Array.isArray(refArea.refs?.['area']));
  assertOk('refs.area 合并去重后 2 行', refArea.refs?.['area']?.length === 2);
  assertOk('refs.area 含上海行（workplace）', !!refArea.refs?.['area']?.find((r: any) => r._id === 'shanghai' && r.name === '上海'));
  assertOk('refs.area 含北京行（birthplace）', !!refArea.refs?.['area']?.find((r: any) => r._id === 'beijing' && r.name === '北京'));

  // 默认不带 refs；undefined / null 等同 false，不附加关联
  const refNone = await callSearch({ limit: 100 });
  assertOk('默认不带 refs', refNone.refs === undefined);
  assertOk('refs: null 等同 false 不取', (await callSearch({ limit: 100, refs: null as any })).refs === undefined);
  assertOk('getRefIds 不传 refs 返回空', Object.keys(getRefIds(getRefPaths(schema as any), refNone.list || [])).length === 0);

  // ---------- 3.6) statis refs ----------
  console.log('\n--- 3.6) statis refs ---');
  const cntAll = await callStatis(crud, { refs: true });
  const cntMap = hitMap(cntAll.hits?.status);
  assertOk('statis.status 三值齐全', cntMap.draft === 1 && cntMap.published === 1 && cntMap.archived === 1);
  assertOk('statis total = 3', cntAll.total === 3);
  assertOk('statis refs.status 是行数组', Array.isArray(cntAll.refs?.['status']));
  assertOk('statis refs.status 含 draft 草稿行', !!cntAll.refs?.['status']?.find((r: any) => r._id === 'draft' && r.name === '草稿'));
  const cntNone = await callStatis(crud, {});
  assertOk('statis 默认不带 refs', cntNone.refs === undefined);

  // ---------- 3.7) hooks（callFunc 钩子） ----------
  console.log('\n--- 3.7) hooks：callFunc 钩子 ---');
  const CTX = { uid: 'tester', roles: ['tester'] };
  regFunc('test-hook-pass', async ({ n }: any) => ({ n }));
  regFunc('test-hook-bare', async ({ n }: any) => ({ n }));
  regFunc('test-hook-nop' , async ({ n }: any) => ({ n }));
  regFunc('test-hook-vip' , async ({ n }: any) => ({ n }));
  regFunc('test-hook-ctx' , async ({ n }: any, ctx: any) => ({ n, uid: ctx.uid }));
  // 未注册 hookPermits 时不做权限检查
  assert('未注册 hookPermits 时不做权限检查', await callFunc('test-hook-nop', { n: 1 }, CTX), { n: 1 });
  // 权限检查钩子（README 示例同款），缺省 name 作用于全部调用
  regHook(undefined, hookPermits);
  // 依次注册三个：字符串精确命中、正则命中调整输出、null 亦为通配
  regHook('test-hook-pass', async (name, params, ctx, next) => {
    params.n = (params.n || 0) * 2;   // 输入干预
    const res = await next(params, ctx);
    return { n: res.n + 1 };          // 输出干预
  });
  regHook(/^test-hook-vip$/, async (name, params, ctx, next) => ({ ...await next(params, ctx), vip: true }));
  regHook(null, (name, params, ctx, next) => next(params, ctx));
  assert('字符串命中的 hook 改写输入并调整输出', await callFunc('test-hook-pass', { n: 1 }, CTX), { n: 3 });
  assert('未命中的 hook 不干预正常透传', await callFunc('test-hook-bare', { n: 11 }, CTX), { n: 11 });
  try {
    await callFunc('test-hook-nop', { n: 1 }, CTX);
    assertOk('注册 hookPermits 后未授权方法抛 RIGHT_DEPRIVED', false);
  } catch (e: any) {
    assertOk('注册 hookPermits 后未授权方法抛 RIGHT_DEPRIVED', e instanceof CrudError && e.code === CrudErrno.RIGHT_DEPRIVED);
  }
  try {
    await callFunc('crud-test.update', { _id: c1.id, doc: { name: 'x' } }, CTX);
    assertOk('注册 hookPermits 后未授权 crud 方法抛 RIGHT_DEPRIVED', false);
  } catch (e: any) {
    assertOk('注册 hookPermits 后未授权 crud 方法抛 RIGHT_DEPRIVED', e instanceof CrudError && e.code === CrudErrno.RIGHT_DEPRIVED);
  }
  assert('正则命中的 hook 调整输出', await callFunc('test-hook-vip', { n: 5 }, CTX), { n: 5, vip: true });
  // 替换 ctx 向下传递（新 uid 抵达目标函数），原参不动
  regHook('test-hook-ctx', (name, params, ctx, next) => next(params, { uid: 'hooker', roles: ctx.roles }));
  assert('hook 替换 ctx 向下传递', await callFunc('test-hook-ctx', { n: 7 }, CTX), { n: 7, uid: 'hooker' });
  // 空串亦为通配钩子
  regHook('', async (name, params, ctx, next) => ({ ...await next(params, ctx), bare: true }));
  assert('空串通配钩子命中全部调用', await callFunc('test-hook-bare', { n: 12 }, CTX), { n: 12, bare: true });

  // ---------- 4) update ----------
  console.log('\n--- 4) update() ---');
  // 单条更新
  const u1 = await callUpdate({ id: c1.id, data: { age: 21 } });
  assert('单条 update affected = 1', u1.affected, 1);
  const afterU1 = await callSearch({ id: c1.id });
  assert('update 后 age = 21', afterU1.list[0].age, 21);

  // 值未变（同值 update）→ affected = 0
  const u1Same = await callUpdate({ id: c1.id, data: { age: 21 } });
  assert('同值 update affected = 0', u1Same.affected, 0);

  // 批量更新
  const uMulti = await callUpdate({ id: [c1.id, c2.id, c3.id], data: { tags: ['updated'] } });
  assert('批量 update affected = 3', uMulti.affected, 3);
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
  assert('update 不存在 id (force=true) affected = 0', uForce.affected, 0);

  // ---------- 5) delete ----------
  console.log('\n--- 5) delete()（软删除） ---');
  const d1 = await callDelete({ id: c3.id });
  assert('软删 1 条 affected = 1', d1.affected, 1);

  // 软删后 search 默认查不到（自动应用 softDeleteCond）
  const afterDel = await callSearch({ id: c3.id });
  assert('软删后 search 查不到', afterDel.list.length, 0);

  // 但文档仍存在（只是 isDeleted=true, isDeleted 为 select:false 需显式选取）
  const rawDoc: any = await crud.getModel().findById(c3.id).select('+isDeleted').lean().exec();
  assertOk('文档仍在库中（isDeleted=true）', rawDoc && rawDoc.isDeleted === true);

  // 重复软删同一条 → 值未变，count = 0
  const d1Again = await callDelete({ id: c3.id });
  assert('重复软删 affected = 0', d1Again.affected, 0);

  // 批量软删
  const dMulti = await callDelete({ id: [c1.id, c2.id] });
  assert('批量软删 affected = 2', dMulti.affected, 2);
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
  assert('delete 不存在 id (force=true) affected = 0', dForce.affected, 0);

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
  assert('软删后 search 数量也变', remain.total, 1);

  // ---------- 7) upsert ----------
  console.log('\n--- 7) upsert() ---');
  await crud.getModel().deleteMany({});

  // 先创建一条，拿到已存在的 _id 用于更新测试
  const existDoc = await callCreate({ name: 'exist', status: 'draft', age: 18 });

  const imp = await callUpsert({
    items: [
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

  // ---------- 8) statis（独立 schema：双 countable 字段 + refName 聚集） ----------
  console.log('\n--- 8) statis ---');
  await statisCrud.getModel().deleteMany({});
  console.log('Cleared collection: testStatis');
  // 准备测试数据（共 6 条）
  //  status    role    age
  //  draft     admin   20
  //  draft     user    25
  //  draft     user    30
  //  published admin   22
  //  published user    28
  //  archived  admin   35
  await statisCrud.getModel().insertMany([
    { name: 'a1', status: 'draft'    , role: 'admin', age: 20 },
    { name: 'a2', status: 'draft'    , role: 'user' , age: 25 },
    { name: 'a3', status: 'draft'    , role: 'user' , age: 30 },
    { name: 'a4', status: 'published', role: 'admin', age: 22 },
    { name: 'a5', status: 'published', role: 'user' , age: 28 },
    { name: 'a6', status: 'archived' , role: 'admin', age: 35 },
  ]);
  console.log('Inserted 6 test docs');

  // ---------- 8.1) 基础统计 ----------
  console.log('\n--- 8.1) 基础统计：全部 countable 字段 ---');
  const st1 = await callStatis(statisCrud, {});
  assert('total = 6', st1.total, 6);
  assert('hits.status', hitMap(st1.hits.status), { draft: 3, published: 2, archived: 1 });
  assert('hits.role'  , hitMap(st1.hits.role)  , { admin: 3, user: 3 });

  // ---------- 8.2) cols 白名单 ----------
  console.log('\n--- 8.2) cols 白名单：只统计 status ---');
  const st2 = await callStatis(statisCrud, { cols: { status: 1 } });
  assert('total = 6', st2.total, 6);
  assert('hits 只含 status', Object.keys(st2.hits).sort(), ['status']);
  assert('hits.status', hitMap(st2.hits.status), { draft: 3, published: 2, archived: 1 });

  // ---------- 8.3) sels 联动 ----------
  //   status: 排除自身条件，返回全量分布（draft/published/archived）
  //   role  : 应用 status=draft 条件，只看 draft 文档的 role 分布
  console.log('\n--- 8.3) sels 联动：sels.status = [draft] ---');
  const st3 = await callStatis(statisCrud, { sels: { status: ['draft'] } });
  assert('total = 3（draft 的 3 条）', st3.total, 3);
  assert('hits.status（不应用自身 sels，全量）', hitMap(st3.hits.status), { draft: 3, published: 2, archived: 1 });
  assert('hits.role（应用 status=draft 过滤）', hitMap(st3.hits.role), { admin: 1, user: 2 });

  // ---------- 8.4) sels 空数组（等同没传） ----------
  console.log('\n--- 8.4) sels 空数组：sels.status = [] ---');
  const st4 = await callStatis(statisCrud, { sels: { status: [] } });
  assert('total = 6（空 sels 不影响）', st4.total, 6);
  assert('hits.status', hitMap(st4.hits.status), { draft: 3, published: 2, archived: 1 });
  assert('hits.role'  , hitMap(st4.hits.role)  , { admin: 3, user: 3 });

  // ---------- 8.5) tops 限制 ----------
  console.log('\n--- 8.5) tops = 1：每个字段只取 count 最高的 1 个 ---');
  const st5 = await callStatis(statisCrud, { tops: 1 });
  // status: draft(3) > published(2) > archived(1) → 只剩 draft:3
  // role  : admin(3) === user(3)，$sort 后顺序不稳定，只会剩 1 个
  assert('hits.status 只剩 1 项', st5.hits.status.length, 1);
  assert('hits.status.draft = 3', hitMap(st5.hits.status).draft, 3);
  assert('hits.role 只剩 1 项', st5.hits.role.length, 1);

  // ---------- 8.6) find 过滤 ----------
  console.log('\n--- 8.6) find: age >= 28 ---');
  const st6 = await callStatis(statisCrud, { find: { age: { $gte: 28 } } });
  // age >= 28 的文档：
  //   a3 draft    user  30
  //   a5 published user  28
  //   a6 archived  admin 35
  assert('total = 3', st6.total, 3);
  assert('hits.status', hitMap(st6.hits.status), { draft: 1, published: 1, archived: 1 });
  assert('hits.role'  , hitMap(st6.hits.role)  , { user: 2, admin: 1 });

  // ---------- 8.7) refs ----------
  console.log('\n--- 8.7) refs：refName 生效 ---');
  const st7 = await callStatis(statisCrud, { refs: true });
  assert('refs 键为 refName: stat', Object.keys(st7.refs || {}).sort(), ['stat']);
  assert('refs.stat 是行数组', Array.isArray(st7.refs?.stat), true);
  assert('refs.stat 含 draft 草稿行', !!st7.refs?.stat?.find((r: any) => r._id === 'draft' && r.name === '草稿'), true);
  assert('refs.stat 含 published 已发布行', !!st7.refs?.stat?.find((r: any) => r._id === 'published' && r.name === '已发布'), true);
  assert('refs.stat 含 archived 已归档行', !!st7.refs?.stat?.find((r: any) => r._id === 'archived' && r.name === '已归档'), true);
  // refs 指定原字段名也可命中
  const st7b = await callStatis(statisCrud, { refs: { status: 1 } });
  assert('refs: {status: 1} 命中 refName 键 stat', Object.keys(st7b.refs || {}).sort(), ['stat']);
  // 不带 refs 时无 refs
  const st7c = await callStatis(statisCrud, {});
  assert('默认不带 refs', st7c.refs, undefined);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  await mongoose.disconnect();
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
