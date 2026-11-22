<template>
  <div class="d-flex min-vh-100">
    <!-- 桌面侧栏 -->
    <aside class="admin-sidebar d-none d-lg-flex flex-column p-3 flex-shrink-0">
      <div class="brand fs-5 px-2 py-3">
        <i class="bi bi-database me-2"></i>HongsCRUD
      </div>
      <nav class="nav flex-column">
        <RouterLink class="nav-link" active-class="active" to="/">
          <i class="bi bi-speedometer2 me-2"></i>概览
        </RouterLink>
        <RouterLink v-if="session.canFeature('users')" class="nav-link" active-class="active" to="/users">
          <i class="bi bi-people me-2"></i>用户管理
        </RouterLink>
      </nav>
    </aside>

    <!-- 移动端侧栏 -->
    <div id="adminNav" class="offcanvas offcanvas-start text-bg-dark" tabindex="-1">
      <div class="offcanvas-header">
        <span class="offcanvas-title fs-5">HongsCRUD</span>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas"></button>
      </div>
      <div class="offcanvas-body">
        <nav class="nav flex-column">
          <RouterLink class="nav-link text-light" to="/" data-bs-dismiss="offcanvas">
            <i class="bi bi-speedometer2 me-2"></i>概览
          </RouterLink>
          <RouterLink v-if="session.canFeature('users')" class="nav-link text-light" to="/users" data-bs-dismiss="offcanvas">
            <i class="bi bi-people me-2"></i>用户管理
          </RouterLink>
        </nav>
      </div>
    </div>

    <div class="admin-main d-flex flex-column">
      <header class="bg-white border-bottom px-3 px-lg-4 py-2 d-flex align-items-center">
        <button class="btn btn-outline-secondary d-lg-none me-2" type="button" data-bs-toggle="offcanvas" data-bs-target="#adminNav">
          <i class="bi bi-list"></i>
        </button>
        <div class="ms-auto dropdown">
          <button class="btn btn-light d-flex align-items-center gap-2" data-bs-toggle="dropdown" type="button">
            <UserAvatar :src="session.user?.avatar" :name="session.user?.name || session.user?.username" />
            <span class="d-none d-sm-inline">{{ session.user?.name || session.user?.username }}</span>
            <i class="bi bi-chevron-down small"></i>
          </button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li v-if="session.canFeature('apiKeys')">
              <RouterLink class="dropdown-item" to="/api-keys"><i class="bi bi-key me-2"></i>我的 API Key</RouterLink>
            </li>
            <li v-if="session.canFeature('profile')">
              <RouterLink class="dropdown-item" to="/profile"><i class="bi bi-person-circle me-2"></i>个人资料</RouterLink>
            </li>
            <li><hr class="dropdown-divider" /></li>
            <li><button class="dropdown-item text-danger" type="button" @click="logout">退出登录</button></li>
          </ul>
        </div>
      </header>

      <main class="p-3 p-lg-4 flex-grow-1">
        <RouterView />
      </main>
    </div>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import UserAvatar from '../components/UserAvatar.vue';
import ToastHost from '../components/ToastHost.vue';

const session = useSessionStore();
const router = useRouter();

async function logout() {
  await session.logout();
  router.replace('/login');
}
</script>
