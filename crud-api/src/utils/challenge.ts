import { randomBytes, createHmac, timingSafeEqual, createHash } from 'crypto';
import { CrudError, CrudErrno } from 'hongs-crud';
import kv from 'hongs-crud/kv';

/* ---------- 配置 ---------- */

const JWT_SECRET: string = process.env.JWT_SECRET!;
if (! JWT_SECRET) {
  throw new Error('JWT_SECRET is required. Set it in environment or .env');
}

const CHALLENGE_TTL = Number(process.env.CHALLENGE_TTL) || 120 * 1000;
const CHALLENGE_DIF = Number(process.env.CHALLENGE_DIF) || 16;
const CHALLENGE_ALG = 'sha256';

/* ---------- Base64url 工具 ---------- */

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(str: string): Buffer {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((str.length + 3) % 4);
  return Buffer.from(b64, 'base64');
}

/* ---------- 出题及查验 ---------- */

interface ChallengePayload {
  o: string; // objective
  t: number; // timestamp
  d: number; // difficulty
  n: string; // nonce (challenge random)
}

/**
 * 出题，返回 challenge + difficulty + alg + ttl
 */
export function issueChallenge(objective: string): Record<string, any> {
  const payload: ChallengePayload = {
    o: objective,
    t: Date.now(),
    d: CHALLENGE_DIF,
    n: base64urlEncode(randomBytes(8)),
  };
  const b64 = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = base64urlEncode(createHmac(CHALLENGE_ALG, JWT_SECRET).update(b64).digest());
  const challenge = `${b64}.${sig}`;
  return { challenge, difficulty: CHALLENGE_DIF, alg: CHALLENGE_ALG, ttl: CHALLENGE_TTL };
}

/**
 * 验证，校验 challenge + nonce 是否有效
 */
export async function checkChallenge(objective: string, challenge: string, nonce: string): Promise<void> {
  if (!challenge || !nonce) {
    throw new CrudError('Missing challenge or nonce', CrudErrno.PARAMS_INVALID, { reason: 'challenge_invalid' });
  }

  const payload = parseChallenge(challenge);
  if (!payload) {
    throw new CrudError('Invalid challenge', CrudErrno.PARAMS_INVALID, { reason: 'challenge_invalid' });
  }
  if (payload.o !== objective) {
    throw new CrudError('Invalid objective', CrudErrno.PARAMS_INVALID, { reason: 'challenge_invalid' });
  }
  if (payload.t < Date.now() - CHALLENGE_TTL) {
    throw new CrudError('Challenge expired', CrudErrno.PARAMS_INVALID, { reason: 'challenge_expired' });
  }

  // PoW 校验
  const hashHex = createHash(CHALLENGE_ALG).update(`${challenge}.${nonce}`).digest('hex');
  if (countChallenge(hashHex) < payload.d) {
    throw new CrudError('PoW verification failed', CrudErrno.PARAMS_INVALID, { reason: 'challenge_failed' });
  }

  // 标记只需覆盖挑战剩余有效期，额外留 10 秒兜住 TTL 取整与多实例时钟偏差
  // 一次性消费：add 为原子写入（仅当键不存在），只有一个能写入，其余视为已使用
  const challengeKey = 'pow:' + base64urlEncode(createHash(CHALLENGE_ALG).update(challenge).digest());
  const remainingSec = Math.max(1, Math.ceil(( payload.t + CHALLENGE_TTL - Date.now() ) / 1000)) + 10;
  const marked = await kv.add(challengeKey, 1, remainingSec);
  if (! marked) {
    throw new CrudError('Challenge already used' , CrudErrno.PARAMS_INVALID, { reason: 'challenge_marked' });
  }
}

/** 解析 challenge payload */
function parseChallenge(challenge: string): ChallengePayload | null {
  const parts = challenge.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = base64urlEncode(createHmac(CHALLENGE_ALG, JWT_SECRET).update(b64).digest());
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(base64urlDecode(b64).toString());
  } catch {
    return null;
  }
}

/** 计算 sha256 hex 前导 0 位数 */
function countChallenge(hex: string): number {
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
