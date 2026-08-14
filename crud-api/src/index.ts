import mongoose from 'mongoose';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import type { Context } from 'hongs-crud';
import { registerSchemas } from './schemas';
import { handleRpc } from './api/rpc';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crud';
const PORT = Number(process.env.PORT) || 3000;

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('[mongo] connected:', MONGO_URI);

  registerSchemas();

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
      const userCtx: Context = { uid: undefined, roles: [] };
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
