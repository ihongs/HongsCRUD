import mongoose from 'mongoose';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { regHooks } from './hooks';
import { regCruds } from './cruds';
import { regFuncs } from './funcs';
import { regRoles } from './roles';
import { regSSES } from './api/sses';
import { handleRpc } from './api/rpc';
import { handleSSE } from './api/sse';
import { handleUpload } from './api/upload';
import { handleStatic } from './api/static';
import { handleRest } from './api/rest';

const PORT = Number(process.env.PORT) || 3000;
const BASE_HREF = process.env.BASE_HREF || 'http://localhost:' + PORT;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crud';

// ES 客户端，辅助检索
// import { setEsClient } from 'hongs-crud/es';
// import { Client } from '@elastic/elasticsearch';
// const ES_URL = process.env.ES_URL || 'http://127.0.0.1:9200';
// setEsClient(new Client({ node: ES_URL }));

// 确保 JWT_SECRET 在启动时已设置
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
    // RPC 接口，内部提取用户 context
    if (ctx.path === '/api/rpc') {
      await handleRpc(ctx);
      return;
    }

    // SSE 流处理，token 走 url 参数，scene 在许可里
    if (ctx.path === '/api/sse') {
      await handleSSE(ctx);
      return;
    }

    // 独立上传接口，token 走 url 参数，scene 在许可里，启用云存储则不用此接口
    if (ctx.path === '/api/upload') {
      await handleUpload(ctx);
      return;
    }

    // 其他处理过程
    if (await handleRest(ctx)) {
      return;
    }

    await handleStatic(ctx);
  });

  app.listen(PORT, () => {
    console.log(`[api] listening on ${BASE_HREF}` );
    console.log('[api] POST /api/rpc JSON RPC 2.0');
    console.log('[api] GET  /api/sse?token=... SSE stream');
    console.log('[api] PUT  /api/upload?token=... raw upload');
    console.log(`[api] GET  /* files in "${process.env.WWW_DIR || './data/www'}"`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
