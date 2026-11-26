import { rpc } from './rpc';

interface UploadConfig {
  url: string;
  method?: 'PUT' | 'POST';
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  accessUrl: string;
}

/** mine.upload 申请头像上传，按信封的 method 发送（PUT 裸流 / POST 表单），返回可访问地址 */
export async function uploadFile(file: File): Promise<string> {
  const cfg = await rpc<UploadConfig>('mine.upload', {
    name: file.name,
    size: file.size,
  });

  let resp: Response;
  if (cfg.method === 'POST') {
    // 预签名 POST：签名与策略放表单字段，文件固定用 file 字段，Content-Type 交给浏览器带 boundary
    const form = new FormData();
    for (const [k, v] of Object.entries(cfg.fields || {})) form.append(k, v);
    form.append('file', file);
    resp = await fetch(cfg.url, { method: 'POST', body: form });
  } else {
    resp = await fetch(cfg.url, {
      method: cfg.method || 'PUT',
      headers: cfg.headers || {},
      body: file,
    });
  }
  if (!resp.ok) {
    throw { code: resp.status, message: resp.statusText || 'upload failed' };
  }
  return cfg.accessUrl;
}
