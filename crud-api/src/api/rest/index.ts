import type { Context } from 'koa';

/** 处理 RPC / SSE / 上传之外的 URI；有对应处理返回 true */
export async function handleRest(ctx: Context): Promise<boolean> {
  // 健康检查
  if (ctx.path === '/api/health') {
    ctx.body = 'ok';
    return true;
  }

  return false;
}
