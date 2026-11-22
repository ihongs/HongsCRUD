import OSS from 'ali-oss';
import type {
  UploadCredential, UploadDriver, UploadStoreParams, UploadIssueParams,
} from '../types';
import { extOfKey, mimeOf, storeKey } from '../types';

/** 上传指令有效期（秒）：取 CHALLENGE_TTL（默认 120s） */
const CREDENTIAL_TTL = Math.ceil((Number(process.env.CHALLENGE_TTL) || 120 * 1000) / 1000);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for OSS upload driver`);
  return value;
}

/**
 * 阿里云 OSS 直传驱动（预签名 PUT，V1 签名）：
 * - 文件由前端按预签名 URL 以 PUT 裸流直传，不经过本服务端
 * - 对象键 {scene}/{yyyy/mm/dd}/{uuid}.{ext}，与本地驱动结构一致
 * - 访问地址优先取 OSS_PUBLIC_BASE_URL（CDN / 自定义域名），否则按 endpoint + bucket 推导
 * - store() 供服务端本地文件直接入库（如本地处理后再上传），大文件由 ali-oss 自动分片，无需额外依赖
 *
 * 依赖（peerDependencies，按需安装）：ali-oss
 * 环境变量：
 *   OSS_BUCKET（必填） / OSS_REGION（默认 oss-cn-hangzhou）
 *   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET（必填；可选 OSS_STS_TOKEN）
 *   OSS_ENDPOINT（可选，如 oss-cn-hangzhou.aliyuncs.com 或自定义域名）
 *   OSS_CNAME（可选，'true' 表示 OSS_ENDPOINT 是绑定到 Bucket 的自定义域名）
 *   OSS_SECURE（可选，'false' 时使用 http，默认 https）
 *   OSS_PUBLIC_BASE_URL（可选，如 https://cdn.example.com）
 */
export class OssUploadDriver implements UploadDriver {
  private readonly client: OSS;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint?: string;
  private readonly cname: boolean;
  private readonly secure: boolean;
  private readonly publicBase?: string;

  constructor() {
    this.bucket     = required('OSS_BUCKET');
    this.region     = process.env.OSS_REGION || 'oss-cn-hangzhou';
    this.cname      = process.env.OSS_CNAME === 'true';
    this.secure     = process.env.OSS_SECURE !== 'false';
    this.endpoint   = normalizeEndpoint(process.env.OSS_ENDPOINT, this.secure ? 'https' : 'http');
    this.publicBase = process.env.OSS_PUBLIC_BASE_URL?.replace(/\/+$/, '');

    this.client = new OSS({
      region: this.region,
      endpoint: this.endpoint,
      bucket: this.bucket,
      cname: this.cname,
      accessKeyId: required('OSS_ACCESS_KEY_ID'),
      accessKeySecret: required('OSS_ACCESS_KEY_SECRET'),
      stsToken: process.env.OSS_STS_TOKEN,
      secure: this.secure,
    });
  }

  async issue({ scene, ext }: UploadIssueParams): Promise<UploadCredential> {
    const key         = storeKey(scene, ext);
    const contentType = mimeOf(ext);

    // Content-Type 会签进 URL：前端 PUT 时必须原样携带该头，否则签名校验失败
    const url = this.client.signatureUrl(key, {
      method: 'PUT',
      expires: CREDENTIAL_TTL,
      'Content-Type': contentType,
    });

    return {
      url,
      method   : 'PUT',
      headers  : { 'Content-Type': contentType },
      expiresIn: CREDENTIAL_TTL,
      accessUrl: this.publicUrl(key),
    };
  }

  /** 服务端本地文件入库：ali-oss 按文件路径上传，超过分片阈值时自动分片 */
  async store({ path, key }: UploadStoreParams): Promise<string> {
    await this.client.put(key, path, { mime: mimeOf(extOfKey(key)) });
    return this.publicUrl(key);
  }

  private publicUrl(key: string): string {
    if (this.publicBase) return `${this.publicBase}/${key}`;

    if (this.endpoint) {
      const u = new URL(this.endpoint);
      // 自定义域名（CNAME）直接作为访问域名；标准 endpoint 需要拼上 bucket 前缀（虚拟主机风格）
      const host = this.cname ? u.host : `${this.bucket}.${u.host}`;
      return `${u.protocol}//${host}/${key}`;
    }
    return `${this.secure ? 'https:' : 'http:'}//${this.bucket}.${this.region}.aliyuncs.com/${key}`;
  }
}

function normalizeEndpoint(endpoint: string | undefined, protocol: string): string | undefined {
  if (!endpoint) return undefined;
  return endpoint.includes('://') ? endpoint : `${protocol}://${endpoint}`;
}

export default OssUploadDriver;
