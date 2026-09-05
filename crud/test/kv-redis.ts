// RedisRoster 集成测试（src/kv/redis）
// 运行：npm run test:kv:redis
// 前置：本地 Redis（redis://127.0.0.1:6379）已启动；未启动时输出提示并跳过

import { createClient } from 'redis';
import { getRoster } from '../src/kv';
import { RedisRoster } from '../src/kv/redis';

const REDIS_URL = 'redis://127.0.0.1:6379';
const PREFIX    = 'test:roster:';

// 测试用到的全部键，开头结尾各清一遍（remove 幂等）
const KEYS = ['kv:str', 'kv:date', 'kv:over', 'kv:arr', 'kv:obj', 'kv:rec',
  'kv:gone', 'kv:gone2', 'kv:old', 'kv:c1s', 'kv:del', 'kv:shared'];

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
  const redis = createClient({ url: REDIS_URL });
  try {
    await redis.connect();
  } catch (e) {
    console.log(`Redis not available at ${REDIS_URL}, skip.`);
    return;
  }
  console.log(`Connected to ${REDIS_URL}`);

  const sleep  = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
  const roster = new RedisRoster(redis, PREFIX);

  // 清场
  for (const k of KEYS) await roster.remove(k);

  /* ---------- 1) set / get ---------- */
  console.log('--- 1) set / get：number 与 Date 有效期、覆盖、值类型 ---');
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

  /* ---------- 2) getRecord：完整记录 ---------- */
  console.log('\n--- 2) getRecord：完整记录 ---');
  await roster.set('kv:rec', 'v1', 60);
  const rec = await roster.getRecord('kv:rec');
  assert('getRecord 返回键', rec?.key, 'kv:rec');
  assert('getRecord 返回值', rec?.value, 'v1');
  assert('getRecord 的 expiresAt 在未来', rec!.expiresAt instanceof Date && rec!.expiresAt.getTime() > Date.now(), true);
  assert('getRecord 的 createdAt 为时间戳', rec!.createdAt instanceof Date && ! isNaN(rec!.createdAt.getTime()), true);
  assert('getRecord 的 updatedAt 为时间戳', rec!.updatedAt instanceof Date && ! isNaN(rec!.updatedAt.getTime()), true);
  assert('getRecord 不存在的键返回 null', await roster.getRecord('kv:none'), null);

  /* ---------- 3) getAndRemove / getRecordAndRemove ---------- */
  console.log('\n--- 3) getAndRemove / getRecordAndRemove ---');
  await roster.set('kv:gone', 'once', 60);
  assert('getAndRemove 首次取到值', await roster.getAndRemove('kv:gone'), 'once');
  assert('getAndRemove 二次为 null', await roster.getAndRemove('kv:gone'), null);

  await roster.set('kv:gone2', { a: 1 }, 60);
  const rec2 = await roster.getRecordAndRemove('kv:gone2');
  assert('getRecordAndRemove 返回记录的键与值', { key: rec2?.key, value: rec2?.value }, { key: 'kv:gone2', value: { a: 1 } });
  assert('getRecordAndRemove 后记录已删', await roster.get('kv:gone2'), null);

  /* ---------- 4) 过期视同不存在 ---------- */
  console.log('\n--- 4) 过期视同不存在 ---');
  await roster.set('kv:old', 'x', new Date(Date.now() - 1000));
  assert('set 过去时间后 get 为 null', await roster.get('kv:old'), null);
  assert('set 过去时间后 getRecord 为 null', await roster.getRecord('kv:old'), null);

  await roster.set('kv:c1s', 'y', 1);
  assert('未过期前可取到', await roster.get('kv:c1s'), 'y');
  await sleep(1100);
  assert('到期后 get 为 null（TTL 由 Redis 删键）', await roster.get('kv:c1s'), null);

  /* ---------- 5) remove ---------- */
  console.log('\n--- 5) remove：删除与幂等 ---');
  await roster.set('kv:del', 'z', 60);
  await roster.remove('kv:del');
  assert('remove 后取不到', await roster.get('kv:del'), null);
  await roster.remove('kv:del');   // 不存在时无效果
  assert('remove 幂等：不存在的键不抛错', await roster.get('kv:del'), null);

  /* ---------- 6) 键隔离（prefix） ---------- */
  console.log('\n--- 6) 键隔离：prefix 隔开不同实例 ---');
  await roster.set('kv:shared', 'shared', 60);
  const roster2 = new RedisRoster(redis, PREFIX + 'other:');
  assert('另一前缀实例取不到', await roster2.get('kv:shared'), null);
  await roster2.set('kv:shared', 'other', 60);
  assert('另一前缀实例互不覆盖', await roster.get('kv:shared'), 'shared');

  /* ---------- 7) cleanup ---------- */
  console.log('\n--- 7) cleanup：Redis TTL 自管，恒返回 0 ---');
  assert('cleanup 恒返回 0', await roster.cleanup(), 0);
  assert('未过期的仍在', await roster.get('kv:shared'), 'shared');

  /* ---------- 8) KV_ROSTER 自动注册：无参构造与惰性连接 ---------- */
  console.log('\n--- 8) KV_ROSTER 自动注册：无参构造与惰性连接 ---');
  // './' 开头相对 cwd 解析；dist-test/src 与本测试 import 的 '../src' 编译后指向同一副本，可 instanceof
  process.env.KV_ROSTER           = './dist-test/src/kv/redis';
  process.env.KV_ROSTER_REDIS_URL = REDIS_URL;
  process.env.KV_ROSTER_REDIS_PRE = 'test:env:';
  const auto = getRoster();
  assert('自动注册得到 RedisRoster', auto instanceof RedisRoster, true);
  assert('二次 getRoster 返回同一单例', getRoster() === auto, true);
  await auto.set('kv:auto', 'lazy', 60);   // 首次操作触发自建客户端连接
  assert('无参构造的 roster 可存取（惰性连接）', await auto.get('kv:auto'), 'lazy');
  assert('KV_ROSTER_REDIS_PRE 生效：另一前缀取不到', await roster.get('kv:auto'), null);

  /* ---------- 收尾 ---------- */
  for (const k of KEYS) await roster.remove(k);
  await roster2.remove('kv:shared');
  await auto.remove('kv:auto');
  await (auto as any)._redis.disconnect();   // 断开自动注册自建的连接，避免进程挂着
  await redis.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
