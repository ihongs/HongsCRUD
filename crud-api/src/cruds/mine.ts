import { ObjectId } from 'mongodb';
import {
  Crud,
  CrudError,
  CrudErrno,
  Context,
  CreateResult,
  DeleteResult,
  SearchResult,
  UpdateResult,
  SchemaResult,
  CountsParams,
  CountsResult,
} from 'hongs-crud';
import { User, UserApiKey, genApiKey } from './user';

/* ---------- 通用工具 ---------- */

function requireUid(ctx: Context, action: string): string {
  const uid = ctx?.uid;
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    throw new CrudError(
      `Cannot ${action}: not logged in (ctx.uid missing).`,
      CrudErrno.LOGIN_REQUIRED,
    );
  }
  return uid;
}

/* ---------- Mine（自己的用户信息）---------- */

export class Mine extends User implements Crud {
  callable = ['search', 'update'];   // 只允许查 & 改自己

  /* ----- create / delete / schema / counts：不可调用 ----- */

  create(_params: any, _ctx: Context): CreateResult {
    throw new CrudError('"mine.create" is not supported.', CrudErrno.METHOD_MISSING);
  }

  delete(_params: any, _ctx: Context): DeleteResult {
    throw new CrudError('"mine.delete" is not supported.', CrudErrno.METHOD_MISSING);
  }

  schema(_params: any, _ctx: Context): SchemaResult {
    throw new CrudError('"mine.schema" is not supported.', CrudErrno.METHOD_MISSING);
  }

  counts(_params: CountsParams, _ctx: Context): CountsResult {
    throw new CrudError('"mine.counts" is not supported.', CrudErrno.METHOD_MISSING);
  }

  /* ----- search：_id === uid ----- */

  search(params: any, ctx: Context): SearchResult {
    const uid = requireUid(ctx, 'mine.search');
    params = { ...(params || {}) };
    params.id = new ObjectId(uid);
    params.find = undefined;
    return super.search(params as any, ctx);
  }

  /* ----- update：_id === uid ----- */

  update(params: any, ctx: Context): UpdateResult {
    const uid = requireUid(ctx, 'mine.update');
    params = { ...(params || {}) };
    params.id = new ObjectId(uid);
    params.find = undefined;
    return super.update(params as any, ctx);
  }
}

export const mine = new Mine();

/* ---------- MineApiKey（自己的 sk key）---------- */

export class MineApiKey extends UserApiKey implements Crud {
  callable = ['search', 'create', 'delete'];   // 只允许查 & 加 & 删

  /* ----- update / schema / counts：不可调用 ----- */

  update(_params: any, _ctx: Context): UpdateResult {
    throw new CrudError('"mineApiKey.update" is not supported.', CrudErrno.METHOD_MISSING);
  }

  schema(_params: any, _ctx: Context): SchemaResult {
    throw new CrudError('"mineApiKey.schema" is not supported.', CrudErrno.METHOD_MISSING);
  }

  counts(_params: CountsParams, _ctx: Context): CountsResult {
    throw new CrudError('"mineApiKey.counts" is not supported.', CrudErrno.METHOD_MISSING);
  }

  /* ----- create：userId = uid, app = 'sk'；强制生成 key 并返回；expiresAt 按 schema.skExpires 推算 ----- */

  create(params: any, ctx: Context): CreateResult {
    const uid = requireUid(ctx, 'mineApiKey.create');
    params = { ...(params || {}) };
    params.data = { ...(params.data || {}) };

    params.data.userId = new ObjectId(uid);
    params.data.app    = 'sk';

    // 强制生成 key：不管调用方传没传，一律重新生成（确保唯一性 & 格式），并在结果里返回
    const newKey = genApiKey('sk-');
    params.data.key = newKey;

    // expiresAt：强制按 schema.options.skExpires 推算（创建时 + skExpires），
    // 用户即便传了 expiresAt 也会被覆盖，不允许自行指定过期时间
    const skExpires = (this.getSchema() as any).options?.skExpires as number | undefined;
    if (typeof skExpires === 'number' && Number.isFinite(skExpires) && skExpires > 0) {
      params.data.expiresAt = new Date(Date.now() + skExpires);
    } else {
      // skExpires 未配置/非法时 → 清掉调用方可能传入的过期时间（永不过期）
      delete params.data.expiresAt;
    }

    // 调用父类 create，拿到 { id } 后把生成的 key 一并附加返回
    const base = super.create(params as any, ctx) as unknown as Promise<CreateResult>;
    return base.then(r => ({ ...r, key: newKey })) as unknown as CreateResult;
  }

  /* ----- delete：只能删 userId === uid 且 app === 'sk' 的 ----- */

  delete(params: any, ctx: Context): DeleteResult {
    const uid = requireUid(ctx, 'mineApiKey.delete');
    params = { ...(params || {}) };
    const uidOid = new ObjectId(uid);
    params.find = { ...(params.find || {}), userId: uidOid, app: 'sk' };
    return super.delete(params as any, ctx);
  }
  
  /* ----- search：userId === uid && app=sk ----- */

  search(params: any, ctx: Context): SearchResult {
    const uid = requireUid(ctx, 'mineApiKey.search');
    params = { ...(params || {}) };
    const uidOid = new ObjectId(uid);
    params.find = { ...(params.find || {}), userId: uidOid, app: 'sk' };
    return super.search(params as any, ctx);
  }
}

export const mineApiKey = new MineApiKey();
