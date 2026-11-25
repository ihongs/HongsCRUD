<template>
  <div>
    <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
      <h1 class="h4 mb-0 me-auto">用户管理</h1>
      <button v-if="session.canFeature('userCreate')" class="btn btn-primary" @click="openCreate">
        <i class="bi bi-person-plus me-1"></i>新建用户
      </button>
    </div>

    <div class="card border-0 shadow-sm mb-3">
      <div class="card-body d-flex flex-wrap gap-2">
        <input
          v-model.trim="wd"
          class="form-control"
          style="max-width: 260px"
          placeholder="搜索用户名 / 姓名 / 手机 / 邮箱"
          @keyup.enter="applySearch"
        />
        <select v-model="role" class="form-select" style="max-width: 180px" @change="applySearch">
          <option value="">全部角色</option>
          <option v-for="r in ASSIGNABLE_ROLES" :key="r.code" :value="r.code">{{ r.name }}（{{ r.code }}）</option>
        </select>
        <button class="btn btn-outline-primary" @click="applySearch">
          <i class="bi bi-search me-1"></i>查询
        </button>
        <button class="btn btn-outline-secondary" @click="resetSearch">重置</button>
      </div>
    </div>

    <div class="card border-0 shadow-sm">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead>
            <tr class="text-secondary small">
              <th>用户</th>
              <th>角色</th>
              <th>邮箱</th>
              <th>手机</th>
              <th>创建时间</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading"><td colspan="6" class="text-center text-secondary py-4">加载中…</td></tr>
            <tr v-else-if="!list.length"><td colspan="6" class="text-center text-secondary py-4">没有匹配的用户</td></tr>
            <template v-else>
              <tr v-for="u in list" :key="u._id">
              <td>
                <div class="d-flex align-items-center gap-2">
                  <UserAvatar :src="u.avatar" :name="u.name || u.username" />
                  <div>
                    <div>{{ u.name || '—' }}</div>
                    <div class="text-secondary small">{{ u.username }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span v-for="r in u.roles || []" :key="r" class="badge text-bg-light border me-1">{{ roleName(r) }}</span>
              </td>
              <td class="text-secondary small">{{ u.email || '—' }}</td>
              <td class="text-secondary small">{{ u.phone || '—' }}</td>
              <td class="text-secondary small">{{ formatTime(u.createdAt) }}</td>
              <td class="text-end text-nowrap">
                <button v-if="session.canFeature('userUpdate')" class="btn btn-sm btn-outline-primary me-1" @click="openEdit(u)">编辑</button>
                <button
                  v-if="session.canFeature('userDelete')"
                  class="btn btn-sm btn-outline-danger"
                  :disabled="isSelf(u)"
                  :title="isSelf(u) ? '不能停用自己' : '停用（软删除）'"
                  @click="disableUser(u)"
                >停用</button>
              </td>
            </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div class="card-footer bg-white d-flex align-items-center">
        <span class="text-secondary small">共 {{ total }} 条</span>
        <div class="ms-auto btn-group btn-group-sm">
          <button class="btn btn-outline-secondary" :disabled="start <= 0" @click="prevPage">上一页</button>
          <button class="btn btn-outline-secondary" :disabled="start + limit >= total" @click="nextPage">下一页</button>
        </div>
      </div>
    </div>

    <!-- 新建 / 编辑弹窗 -->
    <div ref="modalEl" class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ form.id ? '编辑用户资料' : '新建用户' }}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form @submit.prevent="save">
            <div class="modal-body">
              <div v-if="formError" class="alert alert-danger py-2 small">{{ formError }}</div>

              <div class="row g-3">
                <div class="col-12 col-md-6">
                  <label class="form-label">用户名</label>
                  <input v-model.trim="form.username" class="form-control" required />
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label">名称</label>
                  <input v-model.trim="form.name" class="form-control" />
                </div>

                <div class="col-12">
                  <label class="form-label">头像</label>
                  <div class="d-flex align-items-center gap-2">
                    <UserAvatar :src="form.avatar" :name="form.name || form.username" size="lg" />
                    <input v-model.trim="form.avatar" class="form-control" placeholder="图片 URL" />
                    <label v-if="session.canFeature('avatarUpload')" class="btn btn-outline-secondary mb-0">
                      <span v-if="!uploading">上传</span>
                      <span v-else class="spinner-border spinner-border-sm"></span>
                      <input type="file" accept="image/*" hidden @change="onAvatarChange" />
                    </label>
                  </div>
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label">邮箱</label>
                  <input v-model.trim="form.email" type="email" class="form-control" />
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label">手机</label>
                  <input v-model.trim="form.phone" class="form-control" />
                </div>

                <div class="col-12">
                  <label class="form-label d-block">角色</label>
                  <div class="d-flex flex-wrap gap-3">
                    <label v-for="r in ASSIGNABLE_ROLES" :key="r.code" class="form-check form-check-inline">
                      <input
                        v-model="form.roles"
                        class="form-check-input"
                        type="checkbox"
                        :value="r.code"
                        :disabled="form.id === session.user?.id"
                      />
                      <span class="form-check-label">{{ r.name }}（{{ r.code }}）</span>
                    </label>
                  </div>
                  <div v-if="form.id === session.user?.id" class="form-text">不能修改自己的角色。</div>
                </div>

                <div class="col-12">
                  <label class="form-label">密码</label>

                  <div v-if="!form.id">
                    <div class="input-group">
                      <input v-model="form.password" class="form-control" placeholder="留空表示不设置密码" />
                      <button class="btn btn-outline-secondary" type="button" @click="generatePassword">生成密码</button>
                      <button class="btn btn-outline-secondary" type="button" :disabled="!form.password" @click="copyPassword">复制</button>
                    </div>
                    <div class="form-text">留空时该账号不能使用密码登录（仍可用 API Key）。</div>
                  </div>

                  <div v-else>
                    <div class="d-flex flex-wrap gap-3 mb-2">
                      <label class="form-check"><input v-model="form.pwdMode" class="form-check-input" type="radio" value="keep" /> 不修改</label>
                      <label class="form-check"><input v-model="form.pwdMode" class="form-check-input" type="radio" value="set" /> 设置新密码</label>
                      <label class="form-check"><input v-model="form.pwdMode" class="form-check-input" type="radio" value="clear" /> 清空密码</label>
                    </div>
                    <div v-if="form.pwdMode === 'set'" class="input-group">
                      <input v-model="form.password" class="form-control" placeholder="输入新密码" />
                      <button class="btn btn-outline-secondary" type="button" @click="generatePassword">生成密码</button>
                      <button class="btn btn-outline-secondary" type="button" :disabled="!form.password" @click="copyPassword">复制</button>
                    </div>
                    <div v-else-if="form.pwdMode === 'clear'" class="text-danger small">保存后该账号将无法密码登录。</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>
              <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Modal } from 'bootstrap';
import { searchUsers, createUser, updateUser, deleteUser } from '../api/users';
import { uploadFile } from '../api/upload';
import { ASSIGNABLE_ROLES, roleName } from '../config/roles';
import { useSessionStore } from '../stores/session';
import { reportError, toast } from '../composables/useToast';
import UserAvatar from '../components/UserAvatar.vue';

interface UserRow {
  _id: string;
  username: string;
  name?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  roles?: string[];
  createdAt?: string;
}

interface UserForm {
  id: string;
  username: string;
  name: string;
  avatar: string;
  email: string;
  phone: string;
  roles: string[];
  pwdMode: 'keep' | 'set' | 'clear';
  password: string;
}

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const wd = ref(typeof route.query.wd === 'string' ? route.query.wd : '');
const role = ref('');
const start = ref(0);
const limit = 20;
const list = ref<UserRow[]>([]);
const total = ref(0);
const loading = ref(false);

const modalEl = ref<HTMLElement | null>(null);
let modal: Modal | null = null;

const form = reactive<UserForm>({
  id: '',
  username: '',
  name: '',
  avatar: '',
  email: '',
  phone: '',
  roles: ['user'],
  pwdMode: 'keep',
  password: '',
});
const formError = ref('');
const saving = ref(false);
const uploading = ref(false);

function formatTime(v?: string): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function isSelf(u: UserRow): boolean {
  return u._id === session.user?.id;
}

async function load() {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      cols: { username: 1, name: 1, avatar: 1, roles: 1, email: 1, phone: 1, createdAt: 1 },
      sort: { createdAt: -1 },
      start: start.value,
      limit,
      mode: 'list-total',   // 分页需 total：0.2.5 起缺省只返回 list
    };
    if (wd.value) params.wd = wd.value;
    if (role.value) params.find = { roles: role.value };

    const res = await searchUsers(params);
    list.value = (res.list || []) as UserRow[];
    total.value = res.total || 0;
  } catch (e: any) {
    toast(reportError('users.search', e, '用户列表加载失败'), 'danger');
  } finally {
    loading.value = false;
  }
}

function applySearch() {
  start.value = 0;
  load();
}

function resetSearch() {
  wd.value = '';
  role.value = '';
  start.value = 0;
  load();
}

function prevPage() {
  start.value = Math.max(0, start.value - limit);
  load();
}

function nextPage() {
  if (start.value + limit < total.value) {
    start.value += limit;
    load();
  }
}

function resetForm() {
  form.id = '';
  form.username = '';
  form.name = '';
  form.avatar = '';
  form.email = '';
  form.phone = '';
  form.roles = ['user'];
  form.pwdMode = 'keep';
  form.password = '';
  formError.value = '';
}

function openCreate() {
  resetForm();
  form.pwdMode = 'set';
  modal?.show();
}

function openEdit(u: UserRow) {
  resetForm();
  form.id = u._id;
  form.username = u.username || '';
  form.name = u.name || '';
  form.avatar = u.avatar || '';
  form.email = u.email || '';
  form.phone = u.phone || '';
  form.roles = Array.isArray(u.roles) && u.roles.length ? [...u.roles] : ['user'];
  modal?.show();
}

function generatePassword() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  form.password = Array.from(bytes, b => charset[b % charset.length]).join('');
  if (form.id) form.pwdMode = 'set';
}

async function copyPassword() {
  try {
    await navigator.clipboard.writeText(form.password);
    toast('已复制', 'success');
  } catch (e) {
    console.error('[users] copy password', e);
    toast('复制失败，请手动选择复制', 'warning');
  }
}

async function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    form.avatar = await uploadFile(file);
    toast('头像已上传', 'success');
  } catch (err: any) {
    toast(reportError('users.uploadAvatar', err, '头像上传失败'), 'danger');
  } finally {
    uploading.value = false;
    (e.target as HTMLInputElement).value = '';
  }
}

function isDuplicate(e: any): boolean {
  const msg = String(e?.message || '');
  return msg.includes('E11000') || msg.toLowerCase().includes('duplicate key');
}

async function save() {
  if (saving.value) return;
  formError.value = '';

  if (!form.username) {
    formError.value = '用户名不能为空';
    return;
  }

  const data: Record<string, any> = {
    username: form.username,
    name: form.name,
    avatar: form.avatar,
    email: form.email,
    phone: form.phone,
    roles: form.roles,
  };

  if (!form.id) {
    if (form.password) data.password = form.password;
  } else if (form.pwdMode === 'set') {
    if (!form.password) {
      formError.value = '请输入新密码';
      return;
    }
    data.password = form.password;
  } else if (form.pwdMode === 'clear') {
    data.password = '';
  }

  saving.value = true;
  try {
    if (form.id) await updateUser(form.id, data);
    else await createUser(data);
    toast('已保存', 'success');
    modal?.hide();
    await load();
  } catch (e: any) {
    if (isDuplicate(e)) formError.value = '用户名已存在';
    else toast(reportError('users.save', e, '保存失败'), 'danger');
  } finally {
    saving.value = false;
  }
}

async function disableUser(u: UserRow) {
  if (isSelf(u)) return;
  if (!window.confirm(`确定停用用户「${u.username}」？停用后该账号将无法登录。`)) return;
  try {
    await deleteUser(u._id);
    toast('已停用', 'success');
    await load();
  } catch (e: any) {
    toast(reportError('users.delete', e, '停用失败'), 'danger');
  }
}

onMounted(() => {
  if (modalEl.value) {
    modal = new Modal(modalEl.value);
    modalEl.value.addEventListener('hidden.bs.modal', resetForm);
  }
  load();
  if (route.query.create === '1' && session.canFeature('userCreate')) {
    openCreate();
    router.replace({ path: '/users' });
  }
});

watch(
  () => route.query.wd,
  (v) => {
    const next = typeof v === 'string' ? v : '';
    if (next && next !== wd.value) {
      wd.value = next;
      start.value = 0;
      load();
    }
  },
);
</script>
