export interface RpcError {
  code: number;
  message: string;
  data?: Record<string, any>;
}

interface RpcResponse<T = any> {
  jsonrpc: '2.0';
  result?: T;
  error?: RpcError;
  id: string | number | null;
}

let accessToken = '';
let refreshHandler: (() => Promise<boolean>) | null = null;
let idSeq = 1;

export function setAccessToken(token: string): void {
  accessToken = token || '';
}

export function setRefreshHandler(fn: () => Promise<boolean>): void {
  refreshHandler = fn;
}

async function send<T>(method: string, params: Record<string, any>): Promise<RpcResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const resp = await fetch('/api/rpc', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params: params || {}, id: idSeq++ }),
  });
  if (!resp.ok) {
    throw { code: resp.status, message: resp.statusText || 'Network error' } as RpcError;
  }
  return resp.json() as Promise<RpcResponse<T>>;
}

/**
 * 调用 JSON-RPC 方法。
 * - 自动带 access token
 * - LOGIN_REQUIRED(-32001) 时尝试一次刷新并重放
 * - 失败统一 console.error（只打印错误对象，不打印参数）
 */
export async function rpc<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
  let res: RpcResponse<T>;
  try {
    res = await send<T>(method, params);
  } catch (e: any) {
    console.error('[rpc]', method, e);
    throw e;
  }

  if (res.error) {
    if (res.error.code === -32001 && refreshHandler) {
      const ok = await refreshHandler();
      if (ok) return rpc<T>(method, params);
    }
    console.error('[rpc]', method, res.error);
    throw res.error;
  }

  return res.result as T;
}
