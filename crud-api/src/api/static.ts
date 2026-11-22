import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { resolve, sep } from 'path';
import type { Context } from 'koa';

/** 静态资源目录：非 /api 请求默认从这里取文件（上传文件默认落在 static/upload） */
const STATIC_ROOT = resolve('./static');

/** 静态资源 Content-Type（前端常用类型） */
const STATIC_MIME: Record<string, string> = {
  txt  : 'text/plain; charset=utf-8',
  html : 'text/html; charset=utf-8',
  htm  : 'text/html; charset=utf-8',
  css  : 'text/css; charset=utf-8',
  csv  : 'text/csv; charset=utf-8',
  md   : 'text/markdown; charset=utf-8',
  js   : 'text/javascript; charset=utf-8',
  mjs  : 'text/javascript; charset=utf-8',
  json : 'application/json; charset=utf-8',
  map  : 'application/json; charset=utf-8',
  xml  : 'application/xml; charset=utf-8',
  pdf  : 'application/pdf',
  zip  : 'application/zip',
  rar  : 'application/vnd.rar',
  '7z' : 'application/x-7z-compressed',
  doc  : 'application/msword',
  docx : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls  : 'application/vnd.ms-excel',
  xlsx : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt  : 'application/vnd.ms-powerpoint',
  pptx : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  svg  : 'image/svg+xml',
  ico  : 'image/x-icon',
  jpeg : 'image/jpeg',
  jpg  : 'image/jpeg',
  png  : 'image/png',
  gif  : 'image/gif',
  webp : 'image/webp',
  avif : 'image/avif',
  woff : 'font/woff',
  woff2: 'font/woff2',
  ttf  : 'font/ttf',
  otf  : 'font/otf',
  mp3  : 'audio/mpeg',
  wav  : 'audio/wav',
  ogg  : 'audio/ogg',
  m4a  : 'audio/mp4',
  aac  : 'audio/aac',
  flac : 'audio/flac',
  mp4  : 'video/mp4',
  webm : 'video/webm',
  mov  : 'video/quicktime',
  m4v  : 'video/x-m4v',
  avi  : 'video/x-msvideo',
  mkv  : 'video/x-matroska',
};

/**
 * 默认静态行为：把非 /api 的 GET/HEAD 请求映射到 static 目录。
 * 流式发送（不整文件读入内存），防路径穿越，目录请求回落到 index.html。
 */
export async function handleStatic(ctx: Context): Promise<void> {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    ctx.status = 404;
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(ctx.path);
  } catch {
    ctx.status = 400;
    return;
  }

  let target = resolve(STATIC_ROOT, '.' + pathname);
  // 防路径穿越：必须落在 STATIC_ROOT 内
  if (target !== STATIC_ROOT && !target.startsWith(STATIC_ROOT + sep)) {
    ctx.status = 404;
    return;
  }

  let st;
  try {
    st = await stat(target);
    if (st.isDirectory()) {
      target = resolve(target, 'index.html');
      st = await stat(target);
    }
  } catch {
    ctx.status = 404;
    return;
  }
  if (!st.isFile()) {
    ctx.status = 404;
    return;
  }

  const ext = target.toLowerCase().substring(target.lastIndexOf('.') + 1);
  ctx.set('Content-Type', STATIC_MIME[ext] || 'application/octet-stream');
  ctx.set('X-Content-Type-Options', 'nosniff');
  ctx.set('Content-Length', String(st.size));
  // 上传目录文件名不可变，可长缓存
  if (pathname.startsWith('/upload/')) {
    ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  if (ctx.method === 'HEAD') {
    ctx.status = 200;
    return;
  }
  ctx.body = createReadStream(target);
}
