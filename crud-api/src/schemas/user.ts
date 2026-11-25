import { Schema } from 'mongoose';

export const userSchema = new Schema(
  {
    username:  { type: String, unique: true, textable: true },
    password:  { type: String, select: false },
    passsalt:  { type: String, select: false },
    name:      { type: String, textable: true },
    title:     { type: String, textable: true },
    avatar:    { type: String },
    email:     { type: String, index: true, textable: true },
    phone:     { type: String, index: true, textable: true },
    roles:     { type: [String], default: ['user'], index: true },
  },
  {
    collection: 'users',
    softDelete: true,
    timestamps: true,
    limitDef: 20,
    // cs/Chaser：分词器默认 intlSegmenter；csAutoIndex 开启后由插件自动建全文字段 text 索引
    csAutoIndex: true,
  } as any,
);

export const userApiKeySchema = new Schema(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    key:       { type: String, required: true, unique : true },
    app:       { type: String, required: true, default: 'sk' }, // sk 为普通 api key，还可为 wx,qq
    name:      { type: String },
    expiresAt: { type: Date },
  },
  {
    collection: 'userApiKeys',
    timestamps: true,
    skExpires: 86400000 * 365, // 365 天
  },
);
