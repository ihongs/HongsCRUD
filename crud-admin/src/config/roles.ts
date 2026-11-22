// 角色配置：只保留代号与显示名（权限动作由后端 roles.ts 决定，不在前端重复记录）
// 后端增删角色时，同步修改本文件。

export interface RoleDef {
  code: string;
  name: string;
  /** 是否可分配给用户（anon 不参与分配） */
  assignable: boolean;
}

export const ROLES: RoleDef[] = [
  { code: 'anon', name: '匿名', assignable: false },
  { code: 'user', name: '普通用户', assignable: true },
  { code: 'root', name: '超级管理员', assignable: true },
];

/** 角色代号 → 显示名（未知代号回退原样） */
export function roleName(code: string): string {
  return ROLES.find(r => r.code === code)?.name ?? code;
}

/** 可分配角色 */
export const ASSIGNABLE_ROLES = ROLES.filter(r => r.assignable);

/** 概览统计口径（仅展示用）：当前后端 root=管理组、user=客户组 */
export const STAT_ADMIN_ROLES = ['root'];
export const STAT_GUEST_ROLES = ['user'];
