// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

// RedisRoster：Roster 的 Redis（node-redis v4）实现，经 subpath 'hongs-crud/kv/redis' 导出。
// 每键一个 hash（value / expiresAt / createdAt / updatedAt）并带 TTL，到期由 Redis 自身删除，
// 无惰性留档，cleanup 恒返回 0；redis 为可选 peer 依赖，仅使用本实现时安装。

import { createClient, type RedisClientType } from 'redis';
import type { Roster, Rowset } from '../types';

export * from '../types';

// 原子取整个 hash 并删除：HGETALL 与 DEL 在 Redis 内一次执行，并发同 key 时只有一个调用能拿到记录。
// 存的是 hash，无法用 GETDEL，故用 Lua；返回扁平数组 [field1, value1, field2, value2, ...]
const SCRIPT_GET_ALL_AND_DEL = `
local d = redis.call('HGETALL', KEYS[1])
if #d == 0 then return nil end
redis.call('DEL', KEYS[1])
return d
`;

// 原子写入（仅当键不存在）：EXISTS + HSET + EXPIRE 一次执行，返回 1 表示写入成功、0 表示已存在。
// 已存在但 expiresAt 已过的记录视同不存在（与 get/getAll 语义一致），先删掉再写
const SCRIPT_ADD = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  local exp = redis.call('HGET', KEYS[1], 'expiresAt')
  if exp and tonumber(exp) > tonumber(ARGV[5]) then return 0 end
  redis.call('DEL', KEYS[1])
end
redis.call('HSET', KEYS[1], 'value', ARGV[1], 'expiresAt', ARGV[2], 'createdAt', ARGV[3], 'updatedAt', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`;

export class RedisRoster implements Roster {
  // 泛型放宽为 any：兼容 createClient() 返回的任意 modules / functions / scripts 形态
  private readonly _redis : RedisClientType<any, any, any>;
  private readonly _prefix: string;
  private _conn?: Promise<unknown>;   // connect() 返回 Promise<client>，只关心完成与否，放宽为 unknown

  /**
   * redis 未传时读 KV_ROSTER_REDIS_URL 自建客户端（默认 redis://127.0.0.1:6379）；
   * prefix 用于同 db 内多实例的键隔离，未传时读 KV_ROSTER_REDIS_PRE，默认不隔离。
   * 自建或传入未连接的客户端时，首次操作自动发起连接（惰性连接）。
   */
  constructor(redis?: RedisClientType<any, any, any>, prefix?: string) {
    this._redis  = redis || createClient({ url: process.env.KV_ROSTER_REDIS_URL });
    this._prefix = prefix ?? process.env.KV_ROSTER_REDIS_PRE ?? '';
  }

  private _key(key: string): string {
    return this._prefix + key;
  }

  // 确保已连接：isOpen 已连接则跳过，否则发起连接并等待（幂等，失败后下次可重试）
  private async _ensure(): Promise<void> {
    if (this._redis.isOpen) return;
    if (! this._conn) {
      this._conn = this._redis.connect().catch((err) => {
        this._conn = undefined;
        throw err;
      });
    }
    await this._conn;
  }

  // hash 字段 → Rowset；过期视同不存在
  private _record(key: string, d: Record<string, string> | null): Rowset | null {
    if (! d || ! d.expiresAt) return null;
    if (Number(d.expiresAt) <= Date.now()) return null;   // TTL 兜底：到期未及删除的键不外露
    return {
      key,
      value: d.value === undefined ? undefined : JSON.parse(d.value),
      expiresAt: new Date(Number(d.expiresAt)),
      createdAt: new Date(Number(d.createdAt)),
      updatedAt: new Date(Number(d.updatedAt)),
    };
  }

  // 获取记录 {key, value, expiresAt, createdAt, updatedAt}，过期视同不存在
  async getAll(key: string): Promise<Rowset | null> {
    await this._ensure();
    const d = await this._redis.hGetAll(this._key(key));
    return this._record(key, d);
  }

  // 获取记录并删除
  // 用 Lua 把 HGETALL + DEL 合并为一次原子执行：并发同 key 时只有一个调用能拿到记录
  async getAllAndDel(key: string): Promise<Rowset | null> {
    await this._ensure();
    const reply = await this._redis.eval(SCRIPT_GET_ALL_AND_DEL, {
      keys: [this._key(key)],
    }) as string[] | null;
    if (! reply || ! reply.length) return null;

    const d: Record<string, string> = {};
    for (let i = 0; i < reply.length; i += 2) d[reply[i]] = reply[i + 1];

    return this._record(key, d);
  }

  // 获取值
  async get(key: string): Promise<any | null> {
    const record = await this.getAll(key);
    return record ? record.value : null;
  }

  // 获取值并删除
  async getAndDel(key: string): Promise<any | null> {
    const record = await this.getAllAndDel(key);
    return record ? record.value : null;
  }

  // 设置值和有效期，同 key 覆盖
  // expires 为 Date 表示到期时间，为 number 表示多少秒后失效
  async set(key: string, value: any, expires: Date | number): Promise<void> {
    await this._ensure();
    const now = Date.now();
    const expiresAt = expires instanceof Date ? expires.getTime() : now + expires * 1000;
    const old = await this._redis.hGetAll(this._key(key));   // 覆盖时保留首次创建时间
    const ttl = Math.max(1, Math.ceil((expiresAt - now) / 1000));   // 已到期的也给 1 秒 TTL，由 expiresAt 兜底拦截
    await this._redis.hSet(this._key(key), {
      value    : JSON.stringify(value ?? null),
      expiresAt: String(expiresAt),
      createdAt: old.createdAt || String(now),
      updatedAt: String(now),
    });
    await this._redis.expire(this._key(key), ttl);
  }

  // 仅当 key 不存在时写入：EXISTS + HSET + EXPIRE 在 Lua 内原子执行，并发只有一个成功
  async add(key: string, value: any, expires: Date | number): Promise<boolean> {
    await this._ensure();
    const now = Date.now();
    const expiresAt = expires instanceof Date ? expires.getTime() : now + expires * 1000;
    const ttl = Math.max(1, Math.ceil((expiresAt - now) / 1000));   // 已到期的也给 1 秒 TTL，由 expiresAt 兜底拦截
    const ok = await this._redis.eval(SCRIPT_ADD, {
      keys     : [this._key(key)],
      arguments: [JSON.stringify(value ?? null), String(expiresAt), String(now), String(ttl), String(now)],
    });
    return Number(ok) === 1;
  }

  // 删除记录，不存在时无效果
  async del(key: string): Promise<void> {
    await this._ensure();
    await this._redis.del(this._key(key));
  }

  // Redis 到期键由自身删除，无留档可清，恒返回 0
  async cleanup(_before?: Date): Promise<number> {
    return 0;
  }
}

export default RedisRoster;   // 供 KV_ROSTER 自动注册：值为本模块，取默认导出为实现类
