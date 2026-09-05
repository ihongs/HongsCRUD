import type { Context } from 'hongs-crud';
import { callFunc, CrudError } from 'hongs-crud';

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

async function dispatch(req: RpcRequest, ctx: Context): Promise<RpcResponse> {
  const id = req.id ?? null;

  if (typeof req.method !== 'string') {
    return err(id, -32600, 'Invalid Request: method is required');
  }

  ctx.via = 'rpc'; // 标记为 RPC 调用

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

export async function handleRpc(body: any, ctx: Context): Promise<RpcResponse | RpcResponse[]> {
  if (Array.isArray(body)) {
    if (!body.length) return err(null, -32600, 'Invalid Request: empty batch');
    return Promise.all(body.map((r) => dispatch(r, ctx)));
  }
  return dispatch(body, ctx);
}
