<template>
  <div class="min-vh-100 d-flex align-items-center justify-content-center bg-light">
    <div class="card shadow-sm border-0" style="width: min(420px, 92vw)">
      <div class="card-body p-4 p-lg-5">
        <div class="text-center mb-4">
          <div class="fs-3 fw-bold">HongsCRUD</div>
          <div class="text-secondary small mt-1">管理后台</div>
        </div>

        <form @submit.prevent="submit">
          <div class="mb-3">
            <label class="form-label">用户名</label>
            <input v-model.trim="username" class="form-control" autocomplete="username" required />
          </div>
          <div class="mb-3">
            <label class="form-label">密码</label>
            <input v-model="password" type="password" class="form-control" autocomplete="current-password" required />
          </div>

          <div v-if="error" class="alert alert-danger py-2 small">{{ error }}</div>

          <button class="btn btn-primary w-100" type="submit" :disabled="loading">
            <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
            {{ loading ? '安全校验并登录中…' : '登录' }}
          </button>
        </form>

        <div class="text-secondary small text-center mt-4">
          仅限有后台权限的账号登录
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

function messageOf(e: any): string {
  console.error('[login]', e);
  const reason = e?.data?.reason;
  if (reason === 'bad_credentials') return '账号不存在、密码错误或无权访问后台';
  if (typeof reason === 'string' && reason.startsWith('challenge_')) return '安全校验失败，请重试';
  if (e?.code === 0 || e?.message === 'Failed to fetch') return '无法连接服务器';
  return '登录失败，请稍后重试';
}

async function submit() {
  if (loading.value) return;
  error.value = '';
  loading.value = true;
  try {
    await session.login(username.value, password.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (e: any) {
    error.value = messageOf(e);
  } finally {
    loading.value = false;
  }
}
</script>
