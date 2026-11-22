<template>
  <div>
    <h1 class="h4 mb-3">个人资料</h1>

    <div class="row g-3">
      <div class="col-12 col-xl-7">
        <div class="card border-0 shadow-sm">
          <div class="card-body">
            <form @submit.prevent="save">
              <div class="d-flex align-items-center gap-3 mb-4">
                <UserAvatar :src="form.avatar" :name="form.name || session.user?.username" size="lg" />
                <div>
                  <label v-if="session.canFeature('avatarUpload')" class="btn btn-outline-secondary btn-sm mb-1">
                    <span v-if="!uploading">更换头像</span>
                    <span v-else class="spinner-border spinner-border-sm"></span>
                    <input type="file" accept="image/*" hidden @change="onAvatarChange" />
                  </label>
                  <div class="text-secondary small">支持 jpg / png / webp 等</div>
                </div>
              </div>

              <div class="row g-3">
                <div class="col-12 col-md-6">
                  <label class="form-label">用户名</label>
                  <input :value="form.username" class="form-control" disabled />
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label">名称</label>
                  <input v-model.trim="form.name" class="form-control" />
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
                  <label class="form-label">头像 URL</label>
                  <input v-model.trim="form.avatar" class="form-control" placeholder="/upload/xxx.png" />
                </div>

                <div class="col-12">
                  <label class="form-label">修改密码</label>
                  <div class="input-group">
                    <input v-model="newPassword" class="form-control" placeholder="留空则不修改" autocomplete="new-password" />
                    <button class="btn btn-outline-secondary" type="button" @click="generatePassword">生成密码</button>
                  </div>
                  <div class="form-text">修改后所有登录会话会失效，需要重新登录。</div>
                </div>
              </div>

              <div v-if="session.canFeature('profileUpdate')" class="mt-4">
                <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div class="col-12 col-xl-5">
        <div class="card border-0 shadow-sm">
          <div class="card-header bg-white fw-semibold">角色</div>
          <div class="card-body">
            <span v-for="r in form.roles" :key="r" class="badge text-bg-light border me-1">{{ roleName(r) }}</span>
            <div class="text-secondary small mt-2">角色由管理员分配，不能自行修改。</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getProfile, updateProfile } from '../api/profile';
import { uploadFile } from '../api/upload';
import { roleName } from '../config/roles';
import { useSessionStore } from '../stores/session';
import { reportError, toast } from '../composables/useToast';
import UserAvatar from '../components/UserAvatar.vue';

const session = useSessionStore();
const router = useRouter();

const form = reactive({
  id: '',
  username: '',
  name: '',
  avatar: '',
  email: '',
  phone: '',
  roles: [] as string[],
});
const newPassword = ref('');
const saving = ref(false);
const uploading = ref(false);

function generatePassword() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  newPassword.value = Array.from(bytes, b => charset[b % charset.length]).join('');
}

async function load() {
  try {
    const res = await getProfile();
    const u = res?.list?.[0];
    if (!u) return;
    form.id = String(u._id);
    form.username = u.username || '';
    form.name = u.name || '';
    form.avatar = u.avatar || '';
    form.email = u.email || '';
    form.phone = u.phone || '';
    form.roles = Array.isArray(u.roles) ? u.roles : [];
  } catch (e: any) {
    toast(reportError('profile.load', e, '资料加载失败'), 'danger');
  }
}

async function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    form.avatar = await uploadFile(file, 'avatar');
    toast('头像已上传，保存后生效', 'success');
  } catch (err: any) {
    toast(reportError('profile.uploadAvatar', err, '头像上传失败'), 'danger');
  } finally {
    uploading.value = false;
    (e.target as HTMLInputElement).value = '';
  }
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    const data: Record<string, any> = {
      name: form.name,
      avatar: form.avatar,
      email: form.email,
      phone: form.phone,
    };
    if (newPassword.value) data.password = newPassword.value;

    await updateProfile(data);

    if (newPassword.value) {
      toast('密码已更新，请重新登录', 'success');
      await session.logout();
      await router.replace('/login');
      return;
    }

    toast('已保存', 'success');
    await session.loadMe();
  } catch (e: any) {
    toast(reportError('profile.save', e, '保存失败'), 'danger');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
