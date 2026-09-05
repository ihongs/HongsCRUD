// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

// RedisRoster：Roster 的 Redis（node-redis v4）实现，经 subpath 'hongs-crud/kv/redis' 导出。
// 每键一个 hash（value / expiresAt / createdAt / updatedAt）并带 TTL，到期由 Redis 自身删除，
// 无惰性留档，cleanup 恒返回 0；redis 为可选 peer 依赖，仅使用本实现时安装。

import { createClient, type RedisClientType } from 'redis';
import type { Roster, Rowset } from '../types';

export * from '../types';

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

  // 获取记录 {key, value, expiresAt, createdAt, updatedAt}，过期视同不存在
  async getAll(key: string): Promise<Rowset | null> {
    await this._ensure();
    const d = await this._redis.hGetAll(this._key(key));
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

  // 获取记录并删除
  async getAllAndDel(key: string): Promise<Rowset | null> {
    const record = await this.getAll(key);
    if (! record) return null;
    await this.del(key);
    return record;
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
