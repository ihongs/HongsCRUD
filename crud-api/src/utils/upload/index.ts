import { resolve } from 'path';
import { LocalUploadDriver } from './drivers/local';
import type { UploadDriver } from './types';

export * from './types';

/* ---------- 配置 ---------- */

/** 本地上传存储目录（相对运行目录），默认 ./data/www/upload（由 api/static.ts 的静态服务对外提供） */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/www/upload';

/** 上传临时文件目录（相对运行目录），默认 ./data/tmp。请求体流式写盘，不整体读入内存 */
export const UPLOAD_TMP = resolve(process.env.UPLOAD_TMP || './data/tmp');

/* ---------- 驱动 ---------- */

// 上传驱动：未配置 UPLOAD_DRIVER 时用内置本地驱动；替换云存储时设 UPLOAD_DRIVER 指向驱动模块。
// 值为模块（取其默认导出为驱动类，无参构造，驱动类自行读环境变量配置，惯例同 KV_ROSTER）；
// 模块以 './' '../' 开头时相对运行目录解析，其余按包名。
// 前端只面对统一的 RPC 上传指令信封，切换存储前端零改动。

export const uploadDriver: UploadDriver = createDriver();

function createDriver(): UploadDriver {
  const conf = process.env.UPLOAD_DRIVER;
  if (! conf) {
    return new LocalUploadDriver(UPLOAD_DIR);
  }

  const spec = conf.startsWith('./') || conf.startsWith('../') ? resolve(conf) : conf;
  let Ctor: any;
  try {
    Ctor = require(spec)?.default;
  } catch (e: any) {
    throw new Error(`UPLOAD_DRIVER module load failed: ${spec}: ${e?.message}`);
  }
  if (typeof Ctor !== 'function') {
    throw new Error(`UPLOAD_DRIVER default export is not a class: ${conf}`);
  }
  const driver = new Ctor();
  if (typeof driver.issue !== 'function'
  ||  typeof driver.store !== 'function') {
    throw new Error(`UPLOAD_DRIVER class is not an UploadDriver: ${conf}`);
  }
  return driver;
}
