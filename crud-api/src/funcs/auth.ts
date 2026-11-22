import { createHmac, pbkdf2Sync, timingSafeEqual } from 'crypto';
import { regFunc, getRole, isPermitted, CrudError, CrudErrno, type Context } from 'hongs-crud';
import { user, userApiKey, genApiKey } from '../cruds/user';
import { issueChallenge, checkChallenge } from '../utils/challenge';

/* ---------- 配置 ---------- */

const JWT_SECRET: string = process.env.JWT_SECRET!;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required. Set it in environment or .env');
}

const ACCESS_TTL    = Number(process.env.ACCESS_TTL)    || 15 * 60 * 1000;
const REFRESH_TTL   = Number(process.env.REFRESH_TTL)   || 365 * 86400000;

/** access token 默认有效期（秒） */
export const ACCESS_TTL_SECONDS = Math.floor(ACCESS_TTL / 1000);

/* ---------- Base64url 工具 ---------- */

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(str: string): Buffer {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((str.length + 3) % 4);
  return Buffer.from(b64, 'base64');
}

/* ---------- JWT (HS256, 手写) ---------- */

export interface AccessPayload {
  uid : string;
  /** token 附加数据（签发时写入的 data，如上传的 scene/ext、SSE 的 scene） */
  data: Record<string, any>;
}

/**
 * 签发 access JWT。
 * ttl 为有效期（秒）：-1 不限（不写 exp），未设置（含 0）时用 ACCESS_TTL，>0 指定。
 * data 为附加数据，有则写入 payload.data。
 * 普通登录 token 不传 data；上传 / SSE 等场景自行携带所需参数。
 */
export function signAccess(uid: string, ttl?: number, data?: Record<string, any>): string {
  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlNum = Number(ttl);

  const claims: Record<string, any> = { sub: uid, iat: nowSec };
  if (ttlNum !== -1) {
    const ttlSec = ttlNum > 0 ? Math.floor(ttlNum) : ACCESS_TTL_SECONDS;
    claims.exp = nowSec + ttlSec;
  }
  if (data && Object.keys(data).length > 0) claims.data = data;

  const pay = base64urlEncode(Buffer.from(JSON.stringify(claims)));
  const sig = base64urlEncode(createHmac('sha256', JWT_SECRET).update(`${header}.${pay}`).digest());
  return `${header}.${pay}.${sig}`;
}

/**
 * 仅校验裸 token（签名 + 过期）：不加载 roles，也不要求 uid 在库中存在。
 * 用于只需要“token 有效”的场景（token 从 url 参数取）。
 */
export function verifyToken(token?: string): AccessPayload | null {
  if (!token || !token.startsWith('eyJ')) return null;
  return verifyAccess(token);
}

function verifyAccess(token: string): AccessPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payB64, sigB64] = parts;

  // 重算签名
  const expSig = base64urlEncode(
    createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payB64}`).digest(),
  );
  // timingSafeEqual 要求等长；长度不等直接判失败
  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  // 解 payload 并验 exp
  try {
    const payload = JSON.parse(base64urlDecode(payB64).toString());
    // 无 exp 表示不限时（仅 getSSEUrl 用 ttl=-1 签发）
    if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub) return null;
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    return { uid: payload.sub, data };
  } catch {
    return null;
  }
}

/* ---------- 密码验证 ---------- */

function verifyPassword(plain: string, user: any): void {
  if (!user?.passsalt || !user?.password) {
    throw new CrudError('Invalid credentials', CrudErrno.PARAMS_INVALID, { reason: 'bad_credentials' });
  }
  const hash = pbkdf2Sync(plain, user.passsalt, 100_000, 64, 'sha512').toString('hex');
  const hashBuf = Buffer.from(hash);
  const userBuf = Buffer.from(user.password);
  if (hashBuf.length !== userBuf.length || !timingSafeEqual(hashBuf, userBuf)) {
    throw new CrudError('Invalid credentials', CrudErrno.PARAMS_INVALID, { reason: 'bad_credentials' });
  }
}

/* ---------- uid 识别 + roles 加载 ---------- */

async function loadUserRoles(uid: string): Promise<string[]> {
  const m = user.getModel();
  const doc = await m.findOne({ _id: uid, isDeleted: { $ne: true } }).select('roles').lean() as any;
  return doc?.roles ?? [];
}

/**
 * 解析 Authorization header，返回 ctx。
 * - sk-... → 查 userApiKeys(app=sk) → ctx.uid
 * - eyJ... → JWT 解析 → ctx.uid
 * - 无 token / 失败 → ctx.uid 留空
 * 有 uid 时加载 roles。
 */
export async function resolveUserCtx(authHeader?: string): Promise<Context> {
  const ctx: Context = {};
  if (! authHeader || !authHeader.startsWith('Bearer ')) {
    return ctx;
  }
  const token = authHeader.slice(7).trim();
  if (! token) {
    return ctx;
  }

  // eyJ... 前缀 → JWT
  if (token.startsWith('eyJ')) {
    const res = verifyAccess(token);
    if (res) {
      ctx.uid = res.uid;
      ctx.roles = await loadUserRoles(ctx.uid);
    }
    return ctx;
  }

  // sk- 前缀 → API key 路径
  if (token.startsWith('sk-')) {
    const mod = userApiKey.getModel();
    const doc = await mod.findOne({ key: token, app: 'sk' }).lean() as any;
    if (doc && (!doc.expiresAt || doc.expiresAt.getTime() > Date.now())) {
      ctx.uid = String(doc.userId);
      ctx.roles = await loadUserRoles(ctx.uid);
    }
    return ctx;
  }

  // rt- 或其他 → 业务请求不处理
  return ctx;
}

/* ---------- func: auth.chall ---------- */

async function authChall(params: Record<string, any>, _ctx: Context): Promise<any> {
  const username: string | undefined = params?.username;
  if (! username || typeof username !== 'string') {
    throw new CrudError('username is required', CrudErrno.PARAMS_INVALID, { reason: 'missing_username' });
  }

  return issueChallenge('auth:' + username);
}

/* ---------- func: auth.login ---------- */

async function authLogin(params: Record<string, any>, _ctx: Context): Promise<any> {
  const username: string | undefined = params?.username;
  const password: string | undefined = params?.password;
  const scene: string | undefined = params?.scene;
  const chall: Record<string, any> | undefined = params?.chall;

  if (!username || typeof username !== 'string') {
    throw new CrudError('username is required', CrudErrno.PARAMS_INVALID, { reason: 'bad_credentials' });
  }
  if (!password || typeof password !== 'string') {
    throw new CrudError('password is required', CrudErrno.PARAMS_INVALID, { reason: 'bad_credentials' });
  }

  // 1. 验证 chall 对象（challenge + nonce），并原子消费该挑战（只能用一次）
  await checkChallenge('auth:' + username, chall?.challenge || '', chall?.nonce || '');

  // 2. 查用户（只针对有用户名密码的用户；+ 前缀强制取 select:false 字段）
  const userModel = user.getModel();
  const u = await userModel
    .findOne({
      username,
      password: { $exists: true, $ne: '' },
      isDeleted: { $ne: true },
    })
    .select('_id username name avatar roles +password +passsalt')
    .lean() as any;

  if (!u) {
    throw new CrudError('Invalid credentials', CrudErrno.PARAMS_INVALID, { reason: 'bad_credentials' });
  }

  // 3. 验证场景
  if (scene && !isPermitted(scene, u.roles || [])) {
    throw new CrudError('Not permitted scene', CrudErrno.PARAMS_INVALID, { reason: 'bad_credentials' });
  }

  // 4. 密码比对
  verifyPassword(password, u);

  // 5. 签发 access JWT
  const uid = String(u._id);
  const now = Date.now();
  const accessToken = signAccess(uid);

  // 6. 写 refresh token
  const refreshKey = genApiKey('rt-');
  const apiKeyModel = userApiKey.getModel();
  await apiKeyModel.create({
    userId: u._id,
    app: 'rt',
    key: refreshKey,
    expiresAt: new Date(now + REFRESH_TTL),
  });

  return {
    accessToken,
    accessExp: now + ACCESS_TTL,
    refreshToken: refreshKey,
    refreshExp: now + REFRESH_TTL,
    user: { id: uid, name: u.name, avatar: u.avatar },
  };
}

/* ---------- func: auth.refresh ---------- */

async function authRefresh(params: Record<string, any>, _ctx: Context): Promise<any> {
  const refreshToken: string | undefined = params?.refreshToken;
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new CrudError('refreshToken is required', CrudErrno.PARAMS_INVALID, { reason: 'refresh_invalid' });
  }

  const m = userApiKey.getModel();
  const doc = await m.findOne({ key: refreshToken, app: 'rt' }).lean() as any;
  if (!doc) {
    throw new CrudError('Invalid refresh token', CrudErrno.PARAMS_INVALID, { reason: 'refresh_invalid' });
  }

  const now = Date.now();
  if (doc.expiresAt && doc.expiresAt.getTime() <= now) {
    // 已过期，删除
    await m.deleteOne({ _id: doc._id });
    throw new CrudError('Refresh token expired', CrudErrno.PARAMS_INVALID, { reason: 'refresh_expired' });
  }

  // 轮换：删旧行 + 写新行
  await m.deleteOne({ _id: doc._id });
  const newRefreshKey = genApiKey('rt-');
  await m.create({
    userId: doc.userId,
    app: 'rt',
    key: newRefreshKey,
    expiresAt: new Date(now + REFRESH_TTL),
  });

  const accessToken = signAccess(String(doc.userId));
  return {
    accessToken,
    accessExp: now + ACCESS_TTL,
    refreshToken: newRefreshKey,
    refreshExp: now + REFRESH_TTL,
  };
}

/* ---------- func: auth.permits ---------- */

async function authPermits(params: Record<string, any>, ctx: Context): Promise<any> {
  if (! ctx.uid) {
    throw new CrudError('Login required', CrudErrno.LOGIN_REQUIRED, { reason: 'login_required' });
  }

  const methods = Array.isArray(params?.methods) ? params.methods : [];
  const allowed = new Set<string>();
  const matched = new Set<string>();
  const permits : string[] = [];

  for (const role of ctx.roles || []) {
    try {
      for (const act of getRole(role)) allowed.add(act);
    } catch {
      // 未注册的角色忽略
    }
  }

  for (const raw of methods) {
    if (typeof raw !== 'string' || ! raw || matched.has(raw)) continue;
    if (! allowed.has(raw)) continue;
    matched.add (raw);
    permits.push(raw);
  }

  return { permits };
}

/* ---------- func: auth.logout ---------- */

async function authLogout(params: Record<string, any>, _ctx: Context): Promise<any> {
  const refreshToken: string | undefined = params?.refreshToken;
  if (refreshToken && typeof refreshToken === 'string') {
    const m = userApiKey.getModel();
    await m.deleteOne({ key: refreshToken, app: 'rt' });
  }
  return { ok: true };
}

/* ---------- 注册 ---------- */

export function regAuthFuncs(): void {
  regFunc('auth.chall',   authChall);
  regFunc('auth.login',   authLogin);
  regFunc('auth.logout',  authLogout);
  regFunc('auth.refresh', authRefresh);
  regFunc('auth.permits', authPermits);
}
