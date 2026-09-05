// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

// MongoRoster：Roster 的 MongoDB（mongoose）实现，经 subpath 'hongs-crud/kv/mongo' 导出。
// expires 为 Date 表示到期时间，为 number 表示多少秒后失效；
// 过期记录不即时删除（查询按 expiresAt 过滤），量大时定期调 cleanup 清理。

import { Schema, model, type Model } from 'mongoose';
import type { Roster, Rowset } from '../types';

export * from '../types';

// 按集合名缓存已编译 model，同进程多次 new MongoRoster 复用，避免重复编译报错
const MODELS = new Map<string, Model<any>>();

function getRosterModel(collection: string): Model<any> {
  let m = MODELS.get(collection);
  if (! m) {
    const schema = new Schema({
      key      : { type: String, required: true },
      value    : { type: Schema.Types.Mixed },
      expiresAt: { type: Date, required: true },
    }, { collection, timestamps: true });
    m = model('Roster_' + collection, schema);
    MODELS.set(collection, m);
  }
  return m;
}

export class MongoRoster implements Roster {
  private readonly _model: Model<any>;

  /** collection 为存储集合名，未传时读 KV_ROSTER_COLLECTION，默认 'rosters' */
  constructor(collection?: string) {
    this._model = getRosterModel(collection || process.env.KV_ROSTER_COLLECTION || 'rosters');
  }

  // 获取记录 {key, value, expiresAt, createdAt, updatedAt}，过期视同不存在
  async getRecord(key: string): Promise<Rowset | null> {
    const record = await this._model
      .findOne({ key, expiresAt: { $gt: new Date() } })
      .lean();
    return record as Rowset | null;
  }

  // 获取记录并删除
  async getRecordAndRemove(key: string): Promise<Rowset | null> {
    const record = await this.getRecord(key);
    if (! record) return null;
    await this.remove(key);
    return record;
  }

  // 获取值
  async get(key: string): Promise<any | null> {
    const record = await this.getRecord(key);
    return record ? record.value : null;
  }

  // 获取值并删除
  async getAndRemove(key: string): Promise<any | null> {
    const record = await this.getRecordAndRemove(key);
    return record ? record.value : null;
  }

  // 设置值和有效期，同 key 覆盖
  // expires 为 Date 表示到期时间，为 number 表示多少秒后失效
  async set(key: string, value: any, expires: Date | number): Promise<void> {
    const expiresAt = expires instanceof Date ? expires : new Date(Date.now() + expires * 1000);
    await this._model.updateOne(
      { key },
      { $set: { value, expiresAt } },
      { upsert: true },
    );
  }

  // 删除记录，不存在时无效果
  async remove(key: string): Promise<void> {
    await this._model.deleteOne({ key });
  }

  // 清理过期记录，默认只清理 7 天前的
  async cleanup(beforeDate?: Date): Promise<number> {
    const cutoff = beforeDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this._model.deleteMany({ expiresAt: { $lt: cutoff } });
    return result.deletedCount || 0;
  }
}

export default MongoRoster;   // 供 KV_ROSTER 自动注册：值为本模块，取默认导出为实现类
