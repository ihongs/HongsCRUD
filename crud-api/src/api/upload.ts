import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { Context } from 'koa';
import { readAccess } from '../funcs/auth';
import {
  UPLOAD_TMP, UPLOAD_SECRET,
  uploadDriver, extOfKey, kindOf, sizeOf,
} from '../utils/upload';

/* ---------- 工具 ---------- */

function fail(ctx: Context, status: number, error: string, reason: string): void {
  ctx.status = status;
  ctx.body   = { error, reason };
}

interface UploadTicket {
  kind: string;
  key : string;
  max?: number;   // 签发方指定的大小上限（字节），未指定则按类型默认
}

/**
 * 上传鉴权：token 放在 url 查询参数里（对齐云存储预签名 URL 的用法），
 * 只校验 token 本身（签名 + 过期），不加载用户/角色。
 * key 为 token 的 sub，大小上限写入 data.max。
 */
function resolveUpload(ctx: Context): UploadTicket | null {
  const raw  = ctx.query.token;
  const tok  = typeof raw === 'string' ? raw : '';
  const data = readAccess(tok, UPLOAD_SECRET);
  if (! data) return null;

  const key  = typeof data.sub === 'string' ? data.sub : '';
  const kind = kindOf(extOfKey(key));
  if (! kind) return null;

  const maxr = Number(data.data?.max);
  const max  = Number.isFinite(maxr) && maxr > 0 ? maxr : undefined;
  return { kind, key, max };
}

/* ---------- PUT /api/upload（独立接口，非 RPC） ---------- */

/**
 * 裸流上传端点：与云存储预签名 PUT 用法完全一致。
 * 文件流式写入临时文件，边写边校验大小，不整体读入内存。
 */
export async function handleUpload(ctx: Context): Promise<void> {
  if (ctx.method !== 'PUT') {
    ctx.set('Allow', 'PUT');
    return fail(ctx, 405, 'Method Not Allowed', 'method_not_allowed');
  }

  const ticket = resolveUpload(ctx);
  if (! ticket) {
    return fail(ctx, 401, 'Missing or invalid token', 'invalid_token');
  }

  // 要么按类型默认上限，要么按签发方指定的大小上限
  const maxSize = ticket.max ? ticket.max : sizeOf(ticket.kind);

  // 有 Content-Length 时先挡掉明显超限的请求
  const lenRaw = ctx.get('content-length');
  const lenDec = lenRaw ? Number(lenRaw) : NaN;
  if (Number.isFinite(lenDec) && lenDec > maxSize) {
    return fail(ctx, 413, `File too large, max ${Math.round(maxSize / 1024 / 1024)}MB`, 'too_large');
  }

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
