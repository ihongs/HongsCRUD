import { copyFile, mkdir, rename } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { signAccess } from '../../../funcs/auth';
import {
  UPLOAD_SECRET,
  type UploadDriver, type UploadStoreParams, type UploadCredential, type UploadIssueParams,
} from '../types';

/** 上传指令有效期（秒）：取 CHALLENGE_TTL（默认 120s） */
const CREDENTIAL_TTL = Number(process.env.CHALLENGE_TTL) || 120;

/**
 * 本地存储驱动：文件落在 {UPLOAD_DIR}/{key}
 * key 由调用方指定（可用 storeKey 生成 UUID 文件名），静态访问可长缓存
 */
export class LocalUploadDriver implements UploadDriver {
  private readonly root: string;

  // 无参构造可用（对齐 KV 驱动惯例，便于 UPLOAD_DRIVER 动态加载）：自行读 UPLOAD_DIR
  constructor(dir: string = process.env.UPLOAD_DIR || './data/www/upload') {
    this.root = resolve(dir);
  }

  accessUrl(key: string): string {
    return `/upload/${key}`;
  }

  /**
   * 本地模式：对齐云存储预签名 URL 的用法，许可 token 在驱动内签发（云存储不需要）并放在 url 查询参数里，
   * 前端直接把文件 PUT 到这个 url 即可（存储键 key 由调用方指定并写入 token 的 sub）。
   */
  async issue({ key, ttl, max }: UploadIssueParams): Promise<UploadCredential> {
    const accessUrl = this.accessUrl(key);
    const expiresIn = ttl || CREDENTIAL_TTL;
    // 大小上限写入 token，由 /api/upload 在流式接收时强制校验
    const data  = max && max > 0 ? { max } : undefined;
    const token = signAccess(key, data, expiresIn, UPLOAD_SECRET);
    return {
      url      : `/api/upload?token=${encodeURIComponent(token)}`,
      method   : 'PUT',
      expiresIn,
      accessUrl,
    };
  }

  async store({ path: tmpPath, key }: UploadStoreParams): Promise<string> {
    // key 由调用方指定，落盘前确认仍在存储根内（防 ../ 逃逸）
    const target = resolve(this.root, key);
    if (target === this.root || !target.startsWith(this.root + sep)) {
      throw new Error(`Invalid upload key: ${key}`);
    }

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
