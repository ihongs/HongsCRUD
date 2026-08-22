import { regRole } from 'hongs-crud';

export function regRoles(): void {
  // 匿名角色：放行登录相关 func（无 uid 且无 roles 时由入口补 anon）
  regRole('anon', [
    'auth.login', 'auth.logout', 'auth.refresh',
    'verify.challenge',
  ]);

  // 管理员角色：放行 mine / mineApiKey / user 所有 callable 方法
  regRole('admin', [
    'auth.logout', 'auth.refresh', 'verify.challenge',
    'user.create', 'user.update', 'user.delete', 'user.search',
    'user.counts', 'user.upsert', 'user.schema',
    'mine.search', 'mine.update',
    'mineApiKey.search', 'mineApiKey.create', 'mineApiKey.delete',
  ]);
}
