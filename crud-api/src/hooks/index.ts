import { regHook, hookPermits } from 'hongs-crud';

export function regHooks(): void {
  // callFunc 不内置权限检查，须注册权限过滤器（缺省作用于全部调用）
  regHook(undefined, hookPermits);
}
