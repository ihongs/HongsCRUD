import { regRole } from 'hongs-crud';

export const REFRESH_PERMITS = ['auth.refresh', 'auth.chall', 'auth.login', 'auth.logout'];

export function regRoles(): void {
  // 匿名角色：放行登录类方法及其他开放方法
  regRole('anon', [
    ...REFRESH_PERMITS,
  ]);

  // 普通用户：放行自身维护类及其他许可方法
  regRole('user', [
    'guest',
    'auth.chall', 'auth.logout', 'auth.refresh', 'auth.permits', 'mine.upload',
    'mine.search', 'mine.update', 'mineApiKey.search', 'mineApiKey.create', 'mineApiKey.delete',
  ]);

  // 超级管理员：放行所有方法，管理所有数据
  regRole('root', [
    'admin', 'admin-all',
    'auth.chall', 'auth.logout', 'auth.refresh', 'auth.permits', 'mine.upload',
    'mine.search', 'mine.update', 'mineApiKey.search', 'mineApiKey.create', 'mineApiKey.delete',
    'user.search', 'user.create', 'user.delete', 'user.update', 'user.upsert', 'user.statis', 'user.schema',
  ]);
}
