import mongoose from 'mongoose';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import type { Context } from 'hongs-crud';
import { regHooks } from './hooks';
import { regCruds } from './cruds';
import { regFuncs } from './funcs';
import { regRoles } from './roles';
import { regSSES } from './sses';
import { handleRpc } from './api/rpc';
import { handleSSE } from './api/sse';
import { handleUpload } from './api/upload';
import { handleStatic } from './api/static';
import { resolveUserCtx } from './funcs/auth';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crud';
const PORT = Number(process.env.PORT) || 3000;

// 确保 JWT_SECRET 在启动时已设置（auth.ts 会再次校验）
void process.env.JWT_SECRET;

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('[mongo] connected:', MONGO_URI);

  regCruds(); // 注册所有 CRUD
  regFuncs(); // 注册所有接口函数
  regHooks(); // 注册所有钩子函数
  regRoles(); // 注册所有角色权限
  regSSES(); // 注册 SSE 场景

  const app = new Koa();
  app.use(bodyParser({ enableTypes: ['json'] }));

  app.use(async (ctx) => {
    if (ctx.method === 'POST' && ctx.path === '/api/rpc') {
      const body = ctx.request.body;
      if (!body || typeof body !== 'object') {
        ctx.status = 400;
        ctx.body = { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null };
        return;
      }

      // 解析 JWT / API Key → 构造 ctx
      let userCtx: Context = await resolveUserCtx(ctx.request.headers.authorization);

      // 标记 RPC 调用
      userCtx.via = 'rpc';

      ctx.body = await handleRpc(body, userCtx);
      return;
    }

    // SSE 流（GET；token 走 url 参数：/api/sse?token=...，scene 在许可里）
    if (ctx.method === 'GET' && ctx.path === '/api/sse') {
      await handleSSE(ctx);
      return;
    }

    // 独立上传接口（非 RPC）：只认 upload.config 签发的 token + KV 限流 + 裸流 PUT
    if (ctx.method === 'PUT' && ctx.path === '/api/upload') {
      await handleUpload(ctx);
      return;
    }

    // 非 /api 请求：默认静态资源（static 目录，上传文件也在 static/upload 下）
    if (!ctx.path.startsWith('/api/')) {
      await handleStatic(ctx);
      return;
    }

    ctx.status = 404;
  });

  app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    console.log(`[api] POST /api/rpc  JSON RPC 2.0`);
    console.log('[api] GET  /api/sse?token=...  SSE stream');
    console.log('[api] PUT  /api/upload?token=...  raw upload');
    console.log('[api] GET  /*  static files (static/)');
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
