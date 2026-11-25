import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  UploadCredential, UploadDriver, UploadStoreParams, UploadIssueParams,
} from '../types';
import { extOfKey, mimeOf, storeKey } from '../types';

/** 上传指令有效期（秒）：取 CHALLENGE_TTL（默认 120s） */
const CREDENTIAL_TTL = Number(process.env.CHALLENGE_TTL) || 120;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for S3 upload driver`);
  return value;
}

/**
 * Amazon S3 直传驱动（同时也适用于 COS/TOS/MinIO 等 S3 兼容存储）：
 * - 文件由前端按预签名 URL 以 PUT 裸流直传，不经过本服务端
 * - 对象键 {scene}/{yyyy/mm/dd}/{uuid}.{ext}，与本地驱动结构一致
 * - 访问地址优先取 S3_PUBLIC_BASE_URL（CDN / 公有读域名），否则按 endpoint 推导
 * - store() 供服务端本地文件直接入库（如本地处理后再上传），流式发送，无需额外依赖
 *
 * 依赖（peerDependencies，按需安装）：@aws-sdk/client-s3、@aws-sdk/s3-request-presigner
 * 环境变量：
 *   S3_BUCKET（必填） / S3_REGION（默认 AWS_REGION 或 us-east-1）
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY（可选 S3_SESSION_TOKEN；都不配时走 SDK 默认凭据链）
 *   S3_ENDPOINT（可选，S3 兼容存储填其 S3 协议 endpoint）
 *   S3_FORCE_PATH_STYLE（可选，'true' 时使用 {endpoint}/{bucket}/{key} 路径风格）
 *   S3_PUBLIC_BASE_URL（可选，如 https://cdn.example.com）
 */
export class S3UploadDriver implements UploadDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint?: string;
  private readonly forcePathStyle: boolean;
  private readonly publicBase?: string;

  constructor() {
    this.bucket         = required('S3_BUCKET');
    this.region         = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
    this.endpoint       = normalizeEndpoint(process.env.S3_ENDPOINT);
    this.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
    this.publicBase     = process.env.S3_PUBLIC_BASE_URL?.replace(/\/+$/, '');

    const accessKeyId     = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      forcePathStyle: this.forcePathStyle,
      // 预签名 PUT 必须关闭默认的请求体校验和：否则会按空 body 生成 x-amz-checksum-*，
      // 前端真正上传内容时校验和不匹配导致签名/校验失败
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      // 未配置静态密钥时走 SDK 默认凭据链（环境变量 / 实例角色 / SSO 等）
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey, sessionToken: process.env.S3_SESSION_TOKEN } }
        : {}),
    });
  }

  async issue({ scene, ext }: UploadIssueParams): Promise<UploadCredential> {
    const key         = storeKey(scene, ext);
    const contentType = mimeOf(ext);

    // 预签名只签 host；Content-Type 通过信封下发给前端，确保对象以正确的类型存储
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: CREDENTIAL_TTL },
    );

    return {
      url,
      method   : 'PUT',
      headers  : { 'Content-Type': contentType },
      expiresIn: CREDENTIAL_TTL,
      accessUrl: this.publicUrl(key),
    };
  }

  /** 服务端本地文件入库：流式 PutObject，ContentLength 由文件大小得出（避免 SDK 预读整个文件） */
  async store({ path, key }: UploadStoreParams): Promise<string> {
    const { size } = await stat(path);
    await this.client.send(new PutObjectCommand({
      Bucket       : this.bucket,
      Key          : key,
      Body         : createReadStream(path),
      ContentLength: size,
      ContentType  : mimeOf(extOfKey(key)),
    }));
    return this.publicUrl(key);
  }

  private publicUrl(key: string): string {
    if (this.publicBase) return `${this.publicBase}/${key}`;

    const u = new URL(this.endpoint || `https://s3.${this.region}.amazonaws.com`);
    return this.forcePathStyle
      ? `${u.origin}/${this.bucket}/${key}`
      : `${u.protocol}//${this.bucket}.${u.host}/${key}`;
  }
}

function normalizeEndpoint(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  return endpoint.includes('://') ? endpoint : `https://${endpoint}`;
}

export default S3UploadDriver;
