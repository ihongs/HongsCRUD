<template>
  <div>
    <div class="d-flex align-items-center mb-3">
      <h1 class="h4 mb-0">概览</h1>
      <button class="btn btn-sm btn-outline-secondary ms-auto" :disabled="loading" @click="load">
        <i class="bi bi-arrow-clockwise me-1"></i>刷新
      </button>
    </div>

    <div class="row g-3 mb-2">
      <div v-for="card in cards" :key="card.label" class="col-6 col-xl-3">
        <div class="card stat-card border-0 shadow-sm h-100">
          <div class="card-body">
            <div class="text-secondary small">{{ card.label }}</div>
            <div class="display-6 mt-1">{{ loading ? '—' : card.value }}</div>
            <div class="text-secondary small mt-1">{{ card.hint }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-12 col-xl-8">
        <div class="card border-0 shadow-sm h-100">
          <div class="card-header bg-white fw-semibold">最近注册用户</div>
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead>
                <tr class="text-secondary small">
                  <th>用户</th>
                  <th>角色</th>
                  <th>注册时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="loading"><td colspan="3" class="text-center text-secondary py-4">加载中…</td></tr>
                <tr v-else-if="!recentUsers.length"><td colspan="3" class="text-center text-secondary py-4">暂无数据</td></tr>
                <tr
                  v-for="u in recentUsers"
                  v-else
                  :key="u._id"
                  class="cursor-pointer"
                  @click="openUser(u)"
                >
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <UserAvatar :src="u.avatar" :name="u.name || u.username" />
                      <div>
                        <div>{{ u.name || u.username }}</div>
                        <div class="text-secondary small">{{ u.username }}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span v-for="r in u.roles || []" :key="r" class="badge text-bg-light border me-1">{{ roleName(r) }}</span>
                  </td>
                  <td class="text-secondary small">{{ formatTime(u.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="col-12 col-xl-4">
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white fw-semibold">快捷操作</div>
          <div class="card-body d-flex flex-wrap gap-2">
            <RouterLink v-if="session.canFeature('apiKeyCreate')" class="btn btn-sm btn-outline-primary" to="/api-keys?create=1">
              <i class="bi bi-key me-1"></i>创建 API Key
            </RouterLink>
            <RouterLink v-if="session.canFeature('profile')" class="btn btn-sm btn-outline-secondary" to="/profile">
              <i class="bi bi-person-circle me-1"></i>个人资料
            </RouterLink>
          </div>
        </div>

        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white fw-semibold">我的 API Key</div>
          <div class="card-body">
            <div class="d-flex justify-content-between"><span class="text-secondary">总数</span><span>{{ keyStats.total }}</span></div>
            <div class="d-flex justify-content-between mt-1"><span class="text-secondary">30 天内到期</span><span class="text-warning">{{ keyStats.expiring }}</span></div>
            <div class="d-flex justify-content-between mt-1"><span class="text-secondary">已过期</span><span class="text-danger">{{ keyStats.expired }}</span></div>
            <RouterLink class="btn btn-sm btn-link px-0 mt-2" to="/api-keys">查看全部</RouterLink>
          </div>
        </div>

        <div class="card border-0 shadow-sm">
          <div class="card-header bg-white fw-semibold">当前账号</div>
          <div class="card-body d-flex align-items-center gap-3">
            <UserAvatar :src="session.user?.avatar" :name="session.user?.name || session.user?.username" size="lg" />
            <div>
              <div class="fw-semibold">{{ session.user?.name || session.user?.username }}</div>
              <div class="text-secondary small">{{ session.user?.username }}</div>
              <div class="mt-1">
                <span v-for="r in session.user?.roles || []" :key="r" class="badge text-bg-light border me-1">{{ roleName(r) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="keyStats.expiring > 0" class="alert alert-warning mt-3 mb-0">
      <i class="bi bi-exclamation-triangle me-1"></i>
      有 {{ keyStats.expiring }} 个 API Key 将在 30 天内到期。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { rpc } from '../api/rpc';
import { searchApiKeys } from '../api/apiKeys';
import { STAT_ADMIN_ROLES, STAT_GUEST_ROLES, roleName } from '../config/roles';
import { useSessionStore } from '../stores/session';
import { reportError, toast } from '../composables/useToast';
import UserAvatar from '../components/UserAvatar.vue';

interface RecentUser {
  _id: string;
  username: string;
  name?: string;
  avatar?: string;
  roles?: string[];
  createdAt?: string;
}

const session = useSessionStore();
const router = useRouter();

const loading = ref(true);
const total = ref(0);
const recent7d = ref(0);
const adminCount = ref(0);
const guestCount = ref(0);
const recentUsers = ref<RecentUser[]>([]);
const keyStats = reactive({ total: 0, expiring: 0, expired: 0 });

const cards = computed(() => [
  { label: '用户总数', value: total.value, hint: `近 7 天新增 +${recent7d.value}` },
  { label: '近 7 天新增', value: recent7d.value, hint: '较上一个自然周' },
  { label: '管理员数', value: adminCount.value, hint: '拥有 admin 权限' },
  { label: '客户用户数', value: guestCount.value, hint: '拥有 guest 权限' },
]);

function formatTime(v?: string): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function openUser(u: RecentUser) {
  router.push({ path: '/users', query: { wd: u.username } });
}

async function load() {
  loading.value = true;
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const [t, r7, admin, guest, recent, keys] = await Promise.all([
      rpc<{ total: number }>('user.search', { mode: 'only-total' }),
      rpc<{ total: number }>('user.search', { mode: 'only-total', find: { createdAt: { $gte: since } } }),
      rpc<{ total: number }>('user.search', { mode: 'only-total', find: { roles: { $in: STAT_ADMIN_ROLES } } }),
      rpc<{ total: number }>('user.search', { mode: 'only-total', find: { roles: { $in: STAT_GUEST_ROLES } } }),
      rpc<{ list: RecentUser[] }>('user.search', {
        limit: 5,
        sort: { createdAt: -1 },
        cols: { username: 1, name: 1, avatar: 1, roles: 1, createdAt: 1 },
      }),
      searchApiKeys({ mode: 'list-total' }),   // 需 keys.total：0.2.5 起缺省只返回 list
    ]);

    total.value = t.total || 0;
    recent7d.value = r7.total || 0;
    adminCount.value = admin.total || 0;
    guestCount.value = guest.total || 0;
    recentUsers.value = recent.list || [];

    const now = Date.now();
    const limit = now + 30 * 86400000;
    const list = keys.list || [];
    keyStats.total = keys.total ?? list.length;
    keyStats.expiring = list.filter(k => k.expiresAt && new Date(k.expiresAt).getTime() > now && new Date(k.expiresAt).getTime() <= limit).length;
    keyStats.expired = list.filter(k => k.expiresAt && new Date(k.expiresAt).getTime() <= now).length;
  } catch (e: any) {
    toast(reportError('overview', e, '概览加载失败，请稍后重试'), 'danger');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
