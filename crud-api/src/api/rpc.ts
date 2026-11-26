import type { Context as KoaContext } from 'koa';
import type { Context as UsrContext } from 'hongs-crud';
import { callFunc, CrudError, CrudErrno } from 'hongs-crud';
import { resolveContext } from '../funcs/auth';
import { REFRESH_PERMITS } from '../roles';

interface RpcRequest {
  jsonrpc?: string;
  method?: string;
  params?: any;
  id?: string | number | null;
}

interface RpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: { code: number; message: string; data?: any };
  id: string | number | null;
}

function ok(id: string | number | null, result: any): RpcResponse {
  return { jsonrpc: '2.0', result, id };
}

function err(id: string | number | null, code: number, message: string, data?: any): RpcResponse {
  const e: { code: number; message: string; data?: any } = { code, message };
  if (data !== undefined) e.data = data;
  return { jsonrpc: '2.0', error: e, id };
}

async function dispatch(req: RpcRequest, ctx: UsrContext): Promise<RpcResponse> {
  const id = req.id ?? null;

  if (typeof req.method !== 'string') {
    return err(id, -32600, 'Invalid Request: method is required');
  }

  try {
    const result = await callFunc(req.method, req.params || {}, ctx);
    return ok(id, result);
  } catch (e: any) {
    if (e instanceof CrudError) {
      return err(id, e.code || -32603, e.message, e.data);
    }
    return err(id, -32603, e?.message || 'Internal error');
  }
}

/**
 * POST /api/rpc
 * 解析请求体与身份（JWT / API Key），标记 via = 'rpc'，调度后写回响应；批量请求逐条并行处理
 */
export async function handleRpc(ctx: KoaContext): Promise<void> {
  if (ctx.method !== 'POST') {
    ctx.status = 405;
    ctx.set('Allow', 'POST');
    ctx.body = { error: 'Method Not Allowed', reason: 'method_not_allowed' };
    return;
  }

  const body = ctx.request.body as any;
  if (!body || typeof body !== 'object') {
    ctx.status = 400;
    ctx.body = { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null };
    return;
  }

  let usrCtx: UsrContext;
  try {
    usrCtx = await resolveContext(ctx.request.headers.authorization);
  } catch (e: any) {
    const id      = ! Array.isArray(body) ? (body?.id ?? null) : null;
    const method  = ! Array.isArray(body) ? (body?.method ?? '') : '';
    // access token 过期：续期/登录类方法需放行，其他照常返回 TOKEN_DECEASED 让客户端刷新
    const expired = e instanceof CrudError && e.code === CrudErrno.TOKEN_DECEASED;
    if (expired && REFRESH_PERMITS.includes(method)) {
      usrCtx = {};
    } else {
      // 身份解析失败（如 token 过期）按 JSON-RPC 错误返回，而非 HTTP 500
      ctx.body = e instanceof CrudError
        ? err(id, e.code || -32603, e.message, e.data)
        : err(id, -32603, e?.message || 'Internal error');
      return;
    }
  }
  usrCtx.via = 'rpc';

  if (Array.isArray(body)) {
    ctx.body = !body.length
      ? err(null, -32600, 'Invalid Request: empty batch')
      : await Promise.all(body.map((r) => dispatch(r, usrCtx)));
  } else {
    ctx.body = await dispatch(body, usrCtx);
  }
}
