// 功能点 → 后端方法配置。
// - methods 之间是「或」关系：任一方法可用，功能点即可用。
// - 空数组表示无需权限（如概览）。
// - 菜单/按钮只依赖主要方法，细粒度依赖由后端 roles 配置解决。

export interface FeatureDef {
  label: string;
  methods: string[];
}

export const FEATURES = {
  // 菜单
  overview: { label: '概览', methods: [] },
  users: { label: '用户管理', methods: ['user.search'] },
  apiKeys: { label: '我的 API Key', methods: ['mineApiKey.search'] },
  profile: { label: '个人资料', methods: ['mine.search'] },

  // 用户管理操作
  userCreate: { label: '新建用户', methods: ['user.create'] },
  userUpdate: { label: '编辑用户', methods: ['user.update'] },
  userDelete: { label: '停用用户', methods: ['user.delete'] },
  avatarUpload: { label: '上传头像', methods: ['mine.upload'] },

  // API Key 操作
  apiKeyCreate: { label: '创建 API Key', methods: ['mineApiKey.create'] },
  apiKeyDelete: { label: '删除 API Key', methods: ['mineApiKey.delete'] },

  // 个人资料
  profileUpdate: { label: '修改个人资料', methods: ['mine.update'] },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;

/** 登录后一次性向后台询问的方法列表 */
export const FEATURE_METHODS: string[] = Array.from(
  new Set(Object.values(FEATURES).flatMap(f => f.methods)),
);

/** 功能点是否可用（methods 为或关系；空数组恒真） */
export function featureAllowed(key: FeatureKey, permits: string[]): boolean {
  const methods = FEATURES[key].methods;
  if (!methods.length) return true;
  return methods.some(m => permits.includes(m));
}
