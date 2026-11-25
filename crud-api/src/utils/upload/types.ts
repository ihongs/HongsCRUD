/* 上传类型与场景 */

import { randomUUID } from 'crypto';
import { UPLOAD_MIME } from '../../types/mimeTypes';

/** 上传 token 独立签名密钥：未配置时由 JWT_SECRET 派生，避免与登录 token 互通 */
export const UPLOAD_SECRET = process.env.JWT_UPLOAD_SECRET || `${process.env.JWT_SECRET}:upload`;

/** 大小上限（字节） */
export const MAX_FILE_SIZE: Record<string, number> = {
  avatar: 2 * 1024 * 1024, // 用户头像
  image:  5 * 1024 * 1024,
  video: 30 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
  file : 20 * 1024 * 1024,
};

/**
 * 允许的扩展名（小写，不含点）
 * 注意：不要加入 svg。
 * SVG 是可执行脚本的 XML 文档，静态访问会以 image/svg+xml 同源内联返回，
 * 上传者可在本站源下执行 JS（存储型 XSS：会窃取 token、冒用接口）。
 */
export const ALLOWED_KINDS: Record<string, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  video: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
  file : ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'md', 'zip', 'rar', '7z'],
};

/** 扩展名白名单检查：返回归类（image/video/audio/file），非法返回 null */
export function kindOf(ext: string): string | null {
  if (ALLOWED_KINDS.image.includes(ext)) return 'image';
  if (ALLOWED_KINDS.video.includes(ext)) return 'video';
  if (ALLOWED_KINDS.audio.includes(ext)) return 'audio';
  if (ALLOWED_KINDS.file .includes(ext)) return 'file';
  return null;
}

/** 取扩展名对应的 Content-Type，未知类型按二进制流处理 */
export function mimeOf(ext: string): string {
  return UPLOAD_MIME[ext.toLowerCase()] || 'application/octet-stream';
}

/** 从对象键取扩展名（小写，不含点）；无扩展名返回空串 */
export function extOfKey(key: string): string {
  const i = key.lastIndexOf('.');
  return i < 0 ? '' : key.slice(i + 1).toLowerCase();
}

/** 生成存储键：{scene}/{yyyy/mm/dd}/{uuid}.{ext}（本地与云驱动共用，也是对外访问路径） */
export function storeKey(scene: string, ext: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  const name = `${randomUUID()}.${ext}`;
  return `${scene}/${date}/${name}`;
}

/**
 * 上传指令（前端信封）：前端照 url + method + headers 发送文件即可，存储位置由后端驱动决定。
 * url 可能是相对路径（本服务端 /api/upload?token=...）或绝对地址（云存储预签名），
 * 前端用 new URL(url, location.href) 统一处理即可；两者都是裸流 PUT。
 */
export interface UploadCredential {
  /** 文件发往地址 */
  url       : string;
  /** 发送方法 */
  method    : 'PUT';
  /** 发送时要附带的请求头 */
  headers?  : Record<string, string>;
  /** 指令有效期（秒） */
  expiresIn : number;
  /** 上传完成后的访问地址（签发时即确定，与上传响应里的 url 一致） */
  accessUrl : string;
}

/** 签发上传指令的入参（调用方已完成 scene/ext/size 校验） */
export interface UploadIssueParams {
  /** 场景（子目录名），由签发方固定，如 mine.upload 用 avatar */
  scene: string;
  size : number;
  ext  : string;
  uid  : string; // local 需要，云存储可忽略
}

/** 存储入参：文件已写入临时文件，等待驱动落盘/中转。key 决定最终位置，ext/大小均从 key 与文件本身得出 */
export interface UploadStoreParams {
  /** 本地临时文件路径 */
  path: string;
  /** 存储键（相对存储根），由 storeKey(scene, ext) 生成 */
  key : string;
}

/**
 * 上传驱动：决定文件存哪里、怎么传。本地实现见 drivers/local.ts；
 * 替换云存储时新增驱动实现此接口，改 UPLOAD_DRIVER 指向它即可，前端流程不变。
 */
export interface UploadDriver {
  /** 签发上传指令（云存储驱动返回预签名地址；本地驱动返回本服务端端点地址） */
  issue(params: UploadIssueParams): Promise<UploadCredential>;
  /** 服务端本地文件的存储（本地落盘/推云），位置由 key 指定；直传流程不经过它 */
  store(params: UploadStoreParams): Promise<string>;
}
