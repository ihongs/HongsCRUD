import { randomBytes, pbkdf2Sync } from 'crypto';
import { Schema } from 'mongoose';
import { Cradle, type Context, type SearchResult } from 'hongs-crud';
import { Chaser } from 'hongs-crud/cs';

/* ---------- User (users) ---------- */

const userSchema = new Schema(
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
    // cs/Chaser 全文字段与 text 索引：由全局插件按 searchOpts 自动建 fullText 索引
    searchOpts: {},
  } as any,
);

export class User extends Chaser {
  constructor() {
    super(userSchema);
  }

  override add(data: Record<string, any>): [ any, string ] {
    const hasPassword = typeof data.password === 'string';
    if (hasPassword) {
      if (data.password.length > 0) {
        Object.assign(data, hashPassword(data.password));
      } else {
        data.passsalt = '';
      }
    }

    return super.add(data);
  }

  /**
   * 更新用户：
   * - password 非空 → 重新加盐哈希；
   * - password === ''  → 清空密码（同时清 salt），此后不能密码登录；
   * - 未传 password   → 保持不变；
   * 写入密码后统一吊销该用户的 refresh token（app='rt'）。
   */
  override set(id: string, data: Record<string, any>): [ any, number ] {
    const hasPassword = typeof data.password === 'string';
    if (hasPassword) {
      if (data.password.length > 0) {
        Object.assign(data, hashPassword(data.password));
      } else {
        data.passsalt = '';
      }
    }

    const result = super.set(id, data) as unknown as Promise<[ any, number ]>;
    if (! hasPassword) return result as unknown as [ any, number ];

    return result.then(async ([ doc, n ]) => {
      if (n > 0) {
        await userApiKey.getModel().deleteMany({ userId: doc?._id ?? id, app: 'rt' });
      }
      return [ doc, n ];
    }) as unknown as [ any, number ];
  }

  /**
   * 软删除（停用）后吊销该用户 refresh token；配合 loadUserRoles 过滤 isDeleted，
   * 旧 access 也会立刻失去所有权限。
   */
  override delAll(ids: string[], data?: Record<string, any>): number {
    const result = super.delAll(ids, data) as unknown as Promise<number>;
    return result.then(async n => {
      if (n > 0) {
        await userApiKey.getModel().deleteMany({ userId: { $in: ids }, app: 'rt' });
      }
      return n;
    }) as unknown as number;
  }

  /**
   * 管理端搜索：强制剔除 password / passsalt，任何 cols 组合都拿不到。
   * wd 交给底层 $text，不做正则回退。
   */
  override search(params: any, ctx: Context): SearchResult {
    params = { ...(params || {}) };

    const cols: Record<string, any> = { ...(params.cols || {}) };
    if (! params.cols || Object.values(params.cols).includes(0)) {
      cols.password = 0;
      cols.passsalt = 0;
    } else {
      delete cols.password;
      delete cols.passsalt;
      if (! Object.keys(cols).length) {
        cols.password = 0;
        cols.passsalt = 0;
      }
    }
    params.cols = cols;

    return super.search(params, ctx);
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
 * 使用随机盐 + PBKDF2 对明文密码加密。
 * 返回 { password, passsalt } 对象，可直接合并到写入 data。
 */
function hashPassword(plain: string): { password: string; passsalt: string } {
  const passsalt = randomBytes(16).toString('hex');
  const password = pbkdf2Sync(plain, passsalt, 100_000, 64, 'sha512').toString('hex');
  return { password, passsalt };
}

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
