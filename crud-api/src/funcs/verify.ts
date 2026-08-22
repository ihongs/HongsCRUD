import { randomBytes, createHmac, timingSafeEqual, createHash } from 'crypto';
import type { Context } from 'hongs-crud';
import { regFunc, CrudError, CrudErrno } from 'hongs-crud';

/* ---------- 配置 ---------- */

const JWT_SECRET: string = process.env.JWT_SECRET!;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required. Set it in environment or .env');
}

const CHALLENGE_TTL = Number(process.env.CHALLENGE_TTL) || 120 * 1000;
const DIFFICULTY    = Number(process.env.DIFFICULTY)    || 16;

/* ---------- Base64url 工具 ---------- */

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(str: string): Buffer {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((str.length + 3) % 4);
  return Buffer.from(b64, 'base64');
}

/* ---------- PoW (challenge + verify) ---------- */

interface ChallengePayload {
  u: string; // username
  t: number; // timestamp (ms)
  d: number; // difficulty
  n: string; // nonce (challenge random)
}

function issueChallenge(username: string): { challenge: string; difficulty: number; alg: string; expiresIn: number } {
  const payload: ChallengePayload = {
    u: username,
    t: Date.now(),
    d: DIFFICULTY,
    n: base64urlEncode(randomBytes(8)),
  };
  const b64payload = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = base64urlEncode(createHmac('sha256', JWT_SECRET).update(b64payload).digest());
  const challenge = `${b64payload}.${sig}`;
  return { challenge, difficulty: DIFFICULTY, alg: 'sha256', expiresIn: Math.floor(CHALLENGE_TTL / 1000) };
}

function parseChallenge(challenge: string): ChallengePayload | null {
  const parts = challenge.split('.');
  if (parts.length !== 2) return null;
  const [b64payload, sig] = parts;
  const expectedSig = base64urlEncode(createHmac('sha256', JWT_SECRET).update(b64payload).digest());
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(base64urlDecode(b64payload).toString());
  } catch {
    return null;
  }
}

/** 计算 sha256 hex 前导 0 位数 */
function countLeadingZeros(hex: string): number {
  let count = 0;
  for (let i = 0; i < hex.length; i++) {
    const c = hex[i];
    if (c === '0') count += 4;
    else {
      // 按位统计
      const n = parseInt(c, 16);
      if (n >= 8) break;
      if (n >= 4) count += 1;
      else if (n >= 2) count += 2;
      else if (n === 1) count += 3;
      break;
    }
  }
  return count;
}

/**
 * 验证 verify 对象（含 challenge + nonce），返回 { uid:username } 或抛错。
 * 未来可扩展 imageCaptcha 等字段。
 */
export function verifyPoW(verify: Record<string, any>, expectedUsername: string): void {
  const challenge: string | undefined = verify?.challenge;
  const nonce: string | undefined     = verify?.nonce;
  if (!challenge || typeof challenge !== 'string') {
    throw new CrudError('Missing challenge in verify', CrudErrno.PARAMS_INVALID, { reason: 'bad_challenge' });
  }
  if (!nonce || typeof nonce !== 'string') {
    throw new CrudError('Missing nonce in verify', CrudErrno.PARAMS_INVALID, { reason: 'bad_pow' });
  }

  const payload = parseChallenge(challenge);
  if (!payload) {
    throw new CrudError('Invalid challenge signature', CrudErrno.PARAMS_INVALID, { reason: 'bad_challenge' });
  }
  if (payload.u !== expectedUsername) {
    throw new CrudError('Challenge username mismatch', CrudErrno.PARAMS_INVALID, { reason: 'bad_challenge' });
  }
  if (Date.now() - payload.t > CHALLENGE_TTL) {
    throw new CrudError('Challenge expired', CrudErrno.PARAMS_INVALID, { reason: 'expired' });
  }

  // PoW 校验
  const hashHex = createHash('sha256').update(`${challenge}.${nonce}`).digest('hex');
  if (countLeadingZeros(hashHex) < payload.d) {
    throw new CrudError('PoW verification failed', CrudErrno.PARAMS_INVALID, { reason: 'bad_pow' });
  }
}

/* ---------- func: verify.challenge ---------- */

async function verifyChallenge(params: Record<string, any>, _ctx: Context): Promise<any> {
  const username: string | undefined = params?.username;
  if (!username || typeof username !== 'string') {
    throw new CrudError('username is required', CrudErrno.PARAMS_INVALID, { reason: 'missing_username' });
  }
  return issueChallenge(username);
}

/* ---------- 注册 ---------- */

export function regVerifyFuncs(): void {
  regFunc('verify.challenge', verifyChallenge);
}