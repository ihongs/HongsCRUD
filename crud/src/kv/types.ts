// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

// Roster（键值记录）的类型声明，经 subpath 'hongs-crud/kv' 导出；
// 主入口 hongs-crud 不含本目录，实现见 kv/mongo（mongoose）与 kv/redis（node-redis）。

/** 键值记录：value 为任意结构，expiresAt 之后视同不存在 */
export interface Rowset {
  key      : string;   // 键
  value?   : any;      // 值
  expiresAt: Date;     // 过期时间，查询时过滤，不即时删除
  createdAt: Date;     // 创建时间
  updatedAt: Date;     // 更新时间
}

/** 键值存取接口：expires 为 Date 表示到期时间，为 number 表示多少秒后失效 */
export interface Roster {
  /** 取值，过期或不存在返回 null */
  get(key: string): Promise<any | null>;
  /** 取完整记录，过期或不存在返回 null */
  getRecord(key: string): Promise<Rowset | null>;
  /** 取值并删除（一次性令牌），过期或不存在返回 null */
  getAndRemove(key: string): Promise<any | null>;
  /** 取完整记录并删除 */
  getRecordAndRemove(key: string): Promise<Rowset | null>;
  /** 写入并覆盖同 key 记录 */
  set(key: string, value: any, expires: Date | number): Promise<void>;
  /** 删除记录，不存在时无效果 */
  remove(key: string): Promise<void>;
  /** 清理过期记录，返回删除数；redis 实现由 TTL 自管，恒返回 0 */
  cleanup(before?: Date): Promise<number>;
}
