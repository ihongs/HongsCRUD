import { rpc } from './rpc';

interface UploadConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  accessUrl: string;
}

/** upload.config 申请上传，再 PUT 文件，返回可访问地址 */
export async function uploadFile(file: File, scene = 'avatar'): Promise<string> {
  const cfg = await rpc<UploadConfig>('upload.config', {
    scene,
    name: file.name,
    size: file.size,
  });

  const resp = await fetch(cfg.url, {
    method: cfg.method || 'PUT',
    headers: cfg.headers || {},
    body: file,
  });
  if (!resp.ok) {
    throw { code: resp.status, message: resp.statusText || 'upload failed' };
  }
  return cfg.accessUrl;
}
