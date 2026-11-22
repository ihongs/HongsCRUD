import { reactive } from 'vue';

export type ToastType = 'success' | 'danger' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const state = reactive<{ items: ToastItem[] }>({ items: [] });
let seq = 1;

export function toast(message: string, type: ToastType = 'info', timeout = 3500): void {
  const id = seq++;
  state.items.push({ id, message, type });
  window.setTimeout(() => removeToast(id), timeout);
}

export function removeToast(id: number): void {
  const i = state.items.findIndex(t => t.id === id);
  if (i >= 0) state.items.splice(i, 1);
}

export function useToasts() {
  return state;
}

/** 记录完整错误到控制台（不打印请求参数），返回给用户的模糊文案 */
export function reportError(scope: string, e: any, userMessage = '操作失败，请稍后重试'): string {
  console.error(`[${scope}]`, e);
  return userMessage;
}
