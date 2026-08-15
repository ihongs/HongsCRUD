import { randomBytes, pbkdf2Sync } from 'crypto';
import { Schema } from 'mongoose';
import { Cradle } from 'hongs-crud';

/* ---------- User (users) ---------- */

const userSchema = new Schema(
  {
    username:  { type: String, unique: true },
    password:  { type: String },
    passsalt:  { type: String },
    name:      { type: String },
    avatar:    { type: String },
    email:     { type: String, index: true },
    phone:     { type: String, index: true },
    roles:     { type: [String], default: ['user'], index: true },
    isDeleted: { type: Boolean , default: false },
  },
  {
    collection: 'users',
    softDelete: { field: 'isDeleted' },
    timestamps: true,
  },
);

/**
 * 使用随机盐 + PBKDF2 对明文密码加密。
 * 返回 { password, passsalt } 对象，可直接合并到写入 data。
 */
function hashPassword(plain: string): { password: string; passsalt: string } {
  const passsalt = randomBytes(16).toString('hex');
  const password = pbkdf2Sync(plain, passsalt, 100_000, 64, 'sha512').toString('hex');
  return { password, passsalt };
}

export class User extends Cradle {
  constructor() {
    super(userSchema);
  }

  override add(data: Record<string, any>): string {
    if (typeof data.password === 'string' && data.password.length > 0) {
      Object.assign(data, hashPassword(data.password));
    }
    return super.add(data);
  }

  override set(id: string, data: Record<string, any>): number {
    if (typeof data.password === 'string' && data.password.length > 0) {
      Object.assign(data, hashPassword(data.password));
    }
    return super.set(id, data);
  }
}

export const user = new User();

/* ---------- UserApiKey (userApiKeys) ---------- */

const userApiKeySchema = new Schema(
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

export class UserApiKey extends Cradle {
  constructor() {
    super(userApiKeySchema);
  }
}

export const userApiKey = new UserApiKey();

/* ---------- Helpers ---------- */

/**
 * 生成一个唯一的 API Key（sk）。
 * 格式：sk_<32字节随机base64url(约43字符)>，整体长度约 46 字符。
 * 使用 32 字节 / 256 位熵，碰撞概率在实际使用中可忽略，
 * 若需更强保证可在写入 DB 时结合 userApiKeySchema.key 的 unique 约束重试。
 */
export function genApiKey(prefix: 'sk-' | string = 'sk-'): string {
  const bytes = randomBytes(32);
  // base64url，去掉末尾 = 填充，更短更适合作为 key
  const body = bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${prefix}${body}`;
}
