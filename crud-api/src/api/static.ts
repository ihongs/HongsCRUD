import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { resolve, sep } from 'path';
import type { Context } from 'koa';
import { STATIC_MIME } from '../types/mimeTypes';

/** 静态资源目录：非 /api 请求默认从这里取文件（上传文件默认落在 static/upload） */
const STATIC_ROOT = resolve('./static');

/**
 * SPA 子应用：SPA_URIS 如 /app1,/app2，规范为 /app1/ /app2/ 前缀；
 * 其下路径的文件、目录不存在时回落到该子应用的 index.html，未配置则不兜底（交给 nginx 等外部处理）
 */
const SPA_URIS = [...new Set(String(process.env.SPA_URIS || '')
  .split(',')
  .map(s => s.trim().replace(/^\/+|\/+$/g, ''))
  .filter(Boolean)
  .map(s => `/${s}/`))];

/** 目标文件状态：目录回落到其 index.html；不存在或不是文件返回 null（target 随目录回落更新） */
async function statTarget(target: string): Promise<{ target: string; size: number } | null> {
  try {
    let st = await stat(target);
    if (st.isDirectory()) {
      target = resolve(target, 'index.html');
      st = await stat(target);
    }
    return st.isFile() ? { target, size: st.size } : null;
  } catch {
    return null;
  }
}

/**
 * 默认静态行为：把非 /api 的 GET/HEAD 请求映射到 static 目录。
 * 流式发送（不整文件读入内存），防路径穿越，目录请求回落到 index.html。
 */
export async function handleStatic(ctx: Context): Promise<void> {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    ctx.status = 405;
    ctx.set('Allow', 'GET, HEAD');
    ctx.body = { error: 'Method Not Allowed', reason: 'method_not_allowed' };
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

  let found = await statTarget(target);
  if (!found) {
    // SPA 兜底：路径落在 SPA_URIS 子应用内时，交给该子应用的 index.html 处理前端路由
    const app = SPA_URIS.find(p => pathname === p.slice(0, -1) || pathname.startsWith(p));
    if (app) {
      found = await statTarget(resolve(STATIC_ROOT, '.' + app + 'index.html'));
    }
  }
  if (!found) {
    ctx.status = 404;
    return;
  }
  target = found.target;

  const ext = target.toLowerCase().substring(target.lastIndexOf('.') + 1);
  ctx.set('Content-Type', STATIC_MIME[ext] || 'application/octet-stream');
  ctx.set('Content-Length', String(found.size));
  ctx.set('X-Content-Type-Options', 'nosniff');
  if (pathname.startsWith('/upload/')) {
    // 上传目录文件名不可变，可长缓存
    ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    // 其他静态资源缓存 12 小时
    ctx.set('Cache-Control', 'public, max-age=43200');
  }

  if (ctx.method === 'HEAD') {
    ctx.status = 200;
    return;
  }
  ctx.body = createReadStream(target);
}
