import type { Context } from 'hongs-crud';
import { regFunc, CrudError, CrudErrno } from 'hongs-crud';
import { uploadDriver } from '../utils/upload';
import {
  MAX_FILE_SIZE, kindOf,
} from '../utils/upload/types';

/* ---------- 配置 ---------- */

/** 允许的上传场景（子目录），部署方通过 UPLOAD_SCENES 配置；工具层不做限制 */
const UPLOAD_SCENES = String(process.env.UPLOAD_SCENES || 'common,avatar')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** 未指定 scene 时的默认值 */
const DEFAULT_SCENE = UPLOAD_SCENES[0] || 'common';

/**
 * upload.config：登录用户申请上传配置（标准上传入口）。
 * 参数：{ scene?, name, size }，name 为文件名（从中取扩展名）。
 * 返回 { url, method, headers?, expiresIn, accessUrl }：
 * - 本地驱动返回相对地址 /api/upload?token=...，许可 token 由驱动内签发（data 里只有 key）并放在 url 上；
 *   云存储驱动返回预签名绝对地址，鉴权由云存储签名负责，不需要 token
 * - accessUrl 在签发时即确定（本地由 key 推导），上传完成后直接使用
 * 特殊场景（如注册前上传）另行增加申请方法或调整本方法即可。
 */
async function uploadConfig(params: Record<string, any>, ctx: Context): Promise<any> {
  if (!ctx.uid) {
    throw new CrudError('Login required', CrudErrno.LOGIN_REQUIRED, { reason: 'login_required' });
  }

  const scene = typeof params?.scene === 'string' && params.scene ? params.scene : DEFAULT_SCENE;
  const size  = Number(params?.size) || 0 ;
  const name  = String(params?.name || '');
  const ext   = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const kind  = kindOf(ext);

  if (!UPLOAD_SCENES.includes(scene)) {
    throw new CrudError(`Unsupported scene: ${scene}`, CrudErrno.PARAMS_INVALID, { reason: 'bad_scene' });
  }
  if (!kind) {
    throw new CrudError(`Unsupported file type: .${ext}`, CrudErrno.PARAMS_INVALID, { reason: 'bad_extension' });
  }
  const maxSize = MAX_FILE_SIZE[kind];
  if (size > maxSize) {
    throw new CrudError(`File too large, max ${Math.round(maxSize / 1024 / 1024)}MB`, CrudErrno.PARAMS_INVALID, { reason: 'too_large' });
  }

  return uploadDriver.issue({ uid: ctx.uid, scene, ext, size });
}

/* ---------- 注册 ---------- */

export function regUploadFuncs(): void {
  regFunc('upload.config', uploadConfig);
}
