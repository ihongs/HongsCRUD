import type { Context } from 'koa';
import { signAccess, verifyToken } from '../funcs/auth';

/** SSE 流对象：data/uid 为许可信息，另含消息与关闭方法 */
export interface SSEStream {
  /** 签发许可的用户 id */
  uid: string;
  /** 连接许可携带的业务数据（附带 scene），连接时由 token 解码而来 */
  data: Record<string, any>;
  /** 发送一条消息；data 为字符串时原样发送，否则 JSON 序列化。可附带事件名与消息 id */
  message(data: unknown, event?: string, id?: string | number): void;
  /** 关闭流（幂等） */
  close(): void;
}

/** SSE 场景处理函数：连接建立后执行，需等待或监听，结束会关闭流 */
export type SSEHandler = (sse: SSEStream, ctx: Context) => Promise<void> | void;

/** SSE 注册表：{ scene: handler } */
export const SSES: Record<string, SSEHandler> = {};

/** 注册 SSE 场景 */
export function regSSE(scene: string, handler: SSEHandler): void {
  SSES[scene] = handler;
}

/**
 * 生成绑定 token 的 SSE 连接地址，供业务在创建任务等时机返回给客户端。
 * @param scene 已注册的场景
 * @param uid   许可用户 id（写入 sse.uid）
 * @param ttl   有效期（秒）：-1 不限，0 或不传用 ACCESS_TTL，>0 指定
 * @param data  业务数据（如 taskId），写入 token，连接时通过 sse.data 读取
 */
export function getSSEUrl(scene: string, uid: string, ttl = 0, data?: Record<string, any>): string {
  if (!SSES[scene]) {
    throw new Error(`SSE scene "${scene}" is not registered`);
  }
  const token = signAccess(uid, ttl, { ...(data || {}), scene });
  return `/api/sse?token=${encodeURIComponent(token)}`;
}

/**
 * GET /api/sse?token=...
 * - token 走 url 参数（前端 EventSource 只能 GET，无法自定义 header）
 * - token 由 getSSEUrl 签发（无状态 JWT）：验签 + 过期，参数从 token.data 解码
 * - data.scene 决定使用 SSES 里的哪个场景
 * - 有效期内可重复连接；是否禁止复用/提前失效由业务自行决定（需要时自行加 KV）
 */
export async function handleSSE(ctx: Context): Promise<void> {
  const rawToken = ctx.query.token;
  const token    = typeof rawToken === 'string' ? rawToken : '';
  const auth     = verifyToken(token);
  const scene    = auth && typeof auth.data.scene === 'string' ? auth.data.scene : '';

  // 无效/过期 token，或不是 SSE 许可（没有 scene）都按无效处理
  if (!auth || !scene) {
    ctx.status = 401;
    ctx.body   = { error: 'Missing or invalid token', reason: 'invalid_token' };
    return;
  }

  const handler = SSES[scene];
  if (!handler) {
    ctx.status = 404;
    return;
  }

  // 不走 Koa 的响应接管，直接写 res 以保持长连接
  ctx.respond = false;
  const res = ctx.res;
  res.writeHead(200, {
    'Content-Type'   : 'text/event-stream; charset=utf-8',
    'Cache-Control'  : 'no-cache, no-transform',
    'Connection'     : 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 不缓冲，保证实时性
  });
  res.flushHeaders?.();

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (!res.writableEnded) res.end();
  };

  const error = (message: string): void => {
    if (closed) return;
    res.write(`event: error\ndata: ${JSON.stringify({ message: String(message) })}\n\n`);
  };

  const message = (data: unknown, event?: string, id?: string | number) => {
    if (closed) return;
    let text: string;
    if (typeof data !== 'string') {
      try {
        text = JSON.stringify(data);
      }
      catch {
        text = String(data);
      }
    } else {
      text = String(data);
    }
    if (id || id === 0) res.write(`id: ${id}\n`);
    if (event) res . write (`event: ${event}\n`);
    // data 支持多行，SSE 规范要求每行都加 data: 前缀
    for (const line of text.split('\n')) res.write(`data: ${line}\n`);
    res.write('\n');
  };

  const sse: SSEStream = {
    uid : auth.uid ,
    data: auth.data,
    message,
    close,
  };

  // 客户端断开（关闭页面/刷新）：停止推送；token 无状态，重连仍可用直到过期
  ctx.req.on('close', () => { closed = true; });

  try {
    await handler(sse, ctx);
  } catch (e: any) {
    error(e?.message || 'Internal error');
  } finally {
    close();
  }
}
