import { regRole } from 'hongs-crud';

export function regRoles(): void {
  // 匿名角色：未登录的用户
  regRole('anon', [
    'auth.chall', 'auth.login', 'auth.logout', 'auth.refresh',
  ]);

  // 普通用户：已登录的一般用户
  regRole('user', [
    'guest',
    'auth.chall', 'auth.logout', 'auth.refresh', 'auth.permits', 'upload.config',
    'mine.search', 'mine.update', 'mineApiKey.search', 'mineApiKey.create', 'mineApiKey.delete',
  ]);

  // 超级管理员：放行所有方法，管理所有数据
  regRole('root', [
    'admin', 'admin-all',
    'auth.chall', 'auth.logout', 'auth.refresh', 'auth.permits', 'upload.config',
    'mine.search', 'mine.update', 'mineApiKey.search', 'mineApiKey.create', 'mineApiKey.delete',
    'user.search', 'user.create', 'user.delete', 'user.update', 'user.upsert', 'user.statis', 'user.schema',
  ]);
}
