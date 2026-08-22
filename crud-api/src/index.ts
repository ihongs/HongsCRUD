import mongoose from 'mongoose';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import type { Context } from 'hongs-crud';
import { regCruds } from './cruds';
import { regFuncs } from './funcs';
import { regRoles } from './roles';
import { handleRpc } from './api/rpc';
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
  regRoles(); // 注册所有角色权限

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

      // 匿名 fallback：无 uid 且无有效 roles 时，补 anon 角色
      if (!userCtx.uid && (!userCtx.roles || (userCtx.roles as any[]).length === 0)) {
        userCtx = { ...userCtx, roles: ['anon'] };
      }

      ctx.body = await handleRpc(body, userCtx);
      return;
    }
    ctx.status = 404;
  });

  app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    console.log(`[api] POST /api/rpc  e.g. { "jsonrpc":"2.0", "method":"user.search", "params":{}, "id":1 }`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
