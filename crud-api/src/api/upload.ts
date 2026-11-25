import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { Context } from 'koa';
import kv from 'hongs-crud/kv';
import { readAccess } from '../funcs/auth';
import {
  UPLOAD_TMP, MAX_FILE_SIZE, UPLOAD_SECRET,
  uploadDriver, extOfKey, kindOf,
} from '../utils/upload';

/* ---------- 配置 ---------- */

/** 每 IP 每小时上传次数上限 */
const UPLOAD_RATE_LIMIT = Number(process.env.UPLOAD_RATE_LIMIT) || 100;

/* ---------- 工具 ---------- */

function fail(ctx: Context, status: number, error: string, reason: string): void {
  ctx.status = status;
  ctx.body   = { error, reason };
}

// 信任反代转发的客户端 IP（开发直连时回退到 socket 地址）。
// 前提：上级反向代理必须【强制覆盖】写入客户端真实 IP（而非追加原值），
// 否则该头可被调用方伪造，限流（每 IP 每小时次数）会被绕过。此处不做额外校验。
function getClientIp(ctx: Context): string {
  const fwd = ctx.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return ctx.get('x-real-ip') || ctx.ip || 'unknown';
}

function getCurrHour(): number {
  return Math.floor(Date.now() / 3600000);
}

interface UploadTicket {
  kind: string;
  key : string;
}

/**
 * 上传鉴权：token 放在 url 查询参数里（对齐云存储预签名 URL 的用法），
 * 只校验 token 本身（签名 + 过期），不加载用户/角色。
 * 只有 key 由签发方（如 mine.upload）写入 token.data（场景与扩展名都包含在 key 里），
 * 这里不接受客户端额外传参。
 */
function resolveUpload(ctx: Context): UploadTicket | null {
  const raw  = ctx.query.token;
  const tok  = typeof raw === 'string' ? raw : '';
  const data = readAccess(tok, UPLOAD_SECRET);
  if (! data) return null;

  const key  = typeof data.data.key === 'string' ? data.data.key : '';
  const kind = kindOf(extOfKey(key));
  if (! kind) return null;

  return { kind, key };
}

/* ---------- PUT /api/upload（独立接口，非 RPC） ---------- */

/**
 * 裸流上传端点：与云存储预签名 PUT 用法完全一致。
 *   1. RPC mine.upload({ name, size }) → { url, method, accessUrl, ... }
 *   2. 直接把文件 PUT 到返回的 /api/upload?token=...（本地）或预签名地址（云存储）
 * 文件流式写入临时文件，边写边校验大小，不整体读入内存。
 */
export async function handleUpload(ctx: Context): Promise<void> {
  if (ctx.method !== 'PUT') {
    ctx.set('Allow', 'PUT');
    return fail(ctx, 405, 'Method Not Allowed', 'method_not_allowed');
  }

  const ticket = resolveUpload(ctx);
  if (!ticket) {
    return fail(ctx, 401, 'Missing or invalid token', 'invalid_token');
  }

  const maxSize = MAX_FILE_SIZE[ticket.kind];

  // 有 Content-Length 时先挡掉明显超限的请求
  const lenRaw   = ctx.get('content-length');
  const declared = lenRaw ? Number(lenRaw) : NaN;
  if (Number.isFinite(declared) && declared > maxSize) {
    return fail(ctx, 413, `File too large, max ${Math.round(maxSize / 1024 / 1024)}MB`, 'too_large');
  }

  // 每 IP 每小时限流（hongs-crud/kv 计数）
  const rlKey = `upload:rl:${getClientIp(ctx)}:${getCurrHour()}`;
  const count = Number(await kv.get(rlKey)) || 0;
  if (count >= UPLOAD_RATE_LIMIT) {
    return fail(ctx, 429, 'Too many uploads, retry later', 'rate_limited');
  }
  await kv.set(rlKey, count + 1, 3600);

  // 流式写入临时文件（UPLOAD_TMP 可能不存在，先建目录）
  await mkdir(UPLOAD_TMP, { recursive: true });
  const tmpPath = join(UPLOAD_TMP, randomUUID());

  let size     = 0;
  let tooLarge = false;
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > maxSize) {
        tooLarge = true;
        cb(new Error('too_large'));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(ctx.req, guard, createWriteStream(tmpPath));
  } catch {
    await rm(tmpPath, { force: true });
    if (tooLarge) {
      return fail(ctx, 413, `File too large, max ${Math.round(maxSize / 1024 / 1024)}MB`, 'too_large');
    }
    return fail(ctx, 400, 'Upload interrupted', 'bad_upload');
  }

  if (size === 0) {
    await rm(tmpPath, { force: true });
    return fail(ctx, 400, 'Empty file', 'empty_file');
  }

  // 交给驱动落盘并清理临时文件
  try {
    const url = await uploadDriver.store({ path: tmpPath, key: ticket.key });
    ctx.body  = { url, success: true };
  } finally {
    await rm(tmpPath, { force: true });
  }
}
