import { copyFile, mkdir, rename } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { signAccess } from '../../../funcs/auth';
import {
  storeKey, UPLOAD_SECRET,
  type UploadDriver, type UploadStoreParams, type UploadCredential, type UploadIssueParams,
} from '../types';

/** 上传指令有效期（秒）：取 CHALLENGE_TTL（默认 120s） */
const CREDENTIAL_TTL = Number(process.env.CHALLENGE_TTL) || 120;

/**
 * 本地存储驱动：文件落在 {UPLOAD_DIR}/{scene}/{yyyy/mm/dd}/{uuid}.{ext}
 * 文件名不可变（UUID），静态访问可长缓存
 */
export class LocalUploadDriver implements UploadDriver {
  private readonly root: string;

  // 无参构造可用（对齐 KV 驱动惯例，便于 UPLOAD_DRIVER 动态加载）：自行读 UPLOAD_DIR
  constructor(dir: string = process.env.UPLOAD_DIR || './static/upload') {
    this.root = resolve(dir);
  }

  /**
   * 本地模式：对齐云存储预签名 URL 的用法，许可 token 在驱动内签发（云存储不需要）并放在 url 查询参数里，
   * 前端直接把文件 PUT 到这个 url 即可（存储键 key 由 token 声明决定）。
   * 存储键在签发时生成并写入 token，因此 accessUrl 在 config 阶段就已确定。
   */
  async issue({ scene, ext, uid }: UploadIssueParams): Promise<UploadCredential> {
    const key   = storeKey(scene, ext);
    const token = signAccess(uid, { key }, undefined, UPLOAD_SECRET);
    return {
      url      : `/api/upload?token=${encodeURIComponent(token)}`,
      method   : 'PUT',
      expiresIn: CREDENTIAL_TTL,
      accessUrl: `/upload/${key}`,
    };
  }

  async store({ path: tmpPath, key }: UploadStoreParams): Promise<string> {
    const target = join(this.root, key);

    await mkdir(dirname(target), { recursive: true });
    try {
      // 同一分区：直接改名（不复制数据）
      await rename(tmpPath, target);
    } catch (e: any) {
      // 跨设备（UPLOAD_TMP 与 UPLOAD_DIR 不在同一分区）才退回复制
      if (e?.code !== 'EXDEV') throw e;
      await copyFile (tmpPath, target);
    }

    return `/upload/${key}`;
  }
}

// 供 UPLOAD_DRIVER 动态加载（require(...).default）
export default LocalUploadDriver;
