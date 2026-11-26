import { LocalUploadDriver } from './local';
import type {
  UploadCredential, UploadDriver, UploadStoreParams, UploadIssueParams,
} from '../types';

/**
 * 本地中转驱动：签发与上传都走本服务（PUT /api/upload，服务端可强制执行大小上限），
 * 落盘前再交给内部驱动 store 推到云存储。
 * 用于需要真实校验大小、又想用云存储的场景：UPLOAD_DRIVER=local-to-s3 / local-to-oss。
 */
export class LocalToUploadDriver implements UploadDriver {
  private readonly local: UploadDriver;
  private readonly inner: UploadDriver;

  constructor(inner: UploadDriver, local: UploadDriver = new LocalUploadDriver()) {
    this.inner = inner;
    this.local = local;
  }

  async issue(params: UploadIssueParams): Promise<UploadCredential> {
    const cred = await this.local.issue(params);
    // accessUrl 指向最终存储位置（本地驱动给的是 /upload/...，云存储需换成云地址）
    return { ...cred, accessUrl: this.accessUrl(params.key) };
  }

  store(params: UploadStoreParams): Promise<string> {
    return this.inner.store(params);
  }

  accessUrl(key: string): string {
    return this.inner.accessUrl?.(key) ?? this.local.accessUrl?.(key) ?? `/upload/${key}`;
  }
}

export default LocalToUploadDriver;
