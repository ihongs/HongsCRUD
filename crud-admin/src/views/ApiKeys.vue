<template>
  <div>
    <div class="d-flex align-items-center mb-3">
      <h1 class="h4 mb-0">我的 API Key</h1>
      <button v-if="session.canFeature('apiKeyCreate')" class="btn btn-primary ms-auto" @click="openCreate">
        <i class="bi bi-plus-lg me-1"></i>创建
      </button>
    </div>

    <div class="card border-0 shadow-sm">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead>
            <tr class="text-secondary small">
              <th>名称</th>
              <th>创建时间</th>
              <th>过期时间</th>
              <th>状态</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading"><td colspan="5" class="text-center text-secondary py-4">加载中…</td></tr>
            <tr v-else-if="!list.length"><td colspan="5" class="text-center text-secondary py-4">还没有 API Key</td></tr>
            <template v-else>
              <tr v-for="k in list" :key="k._id">
              <td>{{ k.name || '（未命名）' }}</td>
              <td class="text-secondary small">{{ formatTime(k.createdAt) }}</td>
              <td class="text-secondary small">{{ k.expiresAt ? formatTime(k.expiresAt) : '永不过期' }}</td>
              <td>
                <span class="badge" :class="expired(k) ? 'text-bg-danger' : 'text-bg-success'">
                  {{ expired(k) ? '已过期' : '有效' }}
                </span>
              </td>
              <td class="text-end">
                <button v-if="session.canFeature('apiKeyDelete')" class="btn btn-sm btn-outline-danger" @click="remove(k)">删除</button>
              </td>
            </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 创建弹窗 -->
    <div ref="createEl" class="modal fade" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">创建 API Key</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form @submit.prevent="create">
            <div class="modal-body">
              <label class="form-label">名称</label>
              <input v-model.trim="name" class="form-control" placeholder="例如：CLI / 自动化脚本" />
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">取消</button>
              <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? '创建中…' : '创建' }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Key 展示弹窗 -->
    <div ref="keyEl" class="modal fade" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">API Key 已创建</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="alert alert-warning small py-2">仅此一次展示，关闭后无法再次查看，请立即保存。</div>
            <div class="input-group">
              <input :value="createdKey" class="form-control font-monospace" readonly />
              <button class="btn btn-outline-secondary" type="button" @click="copyKey">复制</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Modal } from 'bootstrap';
import { searchApiKeys, createApiKey, deleteApiKey, type ApiKeyRow } from '../api/apiKeys';
import { useSessionStore } from '../stores/session';
import { reportError, toast } from '../composables/useToast';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const list = ref<ApiKeyRow[]>([]);
const loading = ref(false);
const name = ref('');
const saving = ref(false);
const createdKey = ref('');

const createEl = ref<HTMLElement | null>(null);
const keyEl = ref<HTMLElement | null>(null);
let createModal: Modal | null = null;
let keyModal: Modal | null = null;

function formatTime(v?: string): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function expired(k: ApiKeyRow): boolean {
  return !!k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now();
}

async function load() {
  loading.value = true;
  try {
    const res = await searchApiKeys();
    list.value = res.list || [];
  } catch (e: any) {
    toast(reportError('apiKeys.search', e, 'API Key 加载失败'), 'danger');
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  name.value = '';
  createModal?.show();
}

async function create() {
  if (saving.value) return;
  saving.value = true;
  try {
    const res = await createApiKey(name.value);
    createdKey.value = res.key;
    createModal?.hide();
    keyModal?.show();
    await load();
  } catch (e: any) {
    toast(reportError('apiKeys.create', e, '创建失败'), 'danger');
  } finally {
    saving.value = false;
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(createdKey.value);
    toast('已复制', 'success');
  } catch (e) {
    console.error('[apiKeys] copy', e);
    toast('复制失败，请手动选择复制', 'warning');
  }
}

async function remove(k: ApiKeyRow) {
  if (!window.confirm(`确定删除 API Key「${k.name || '未命名'}」？删除后使用该 Key 的客户端将无法访问。`)) return;
  try {
    await deleteApiKey(k._id);
    toast('已删除', 'success');
    await load();
  } catch (e: any) {
    toast(reportError('apiKeys.delete', e, '删除失败'), 'danger');
  }
}

onMounted(() => {
  if (createEl.value) createModal = new Modal(createEl.value);
  if (keyEl.value) keyModal = new Modal(keyEl.value);
  load();
  if (route.query.create === '1' && session.canFeature('apiKeyCreate')) {
    openCreate();
    router.replace({ path: '/api-keys' });
  }
});
</script>
