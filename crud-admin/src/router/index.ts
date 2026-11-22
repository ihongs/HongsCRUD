import { createRouter, createWebHashHistory } from 'vue-router';
import { useSessionStore } from '../stores/session';
import Login from '../views/Login.vue';
import Overview from '../views/Overview.vue';
import Users from '../views/Users.vue';
import ApiKeys from '../views/ApiKeys.vue';
import Profile from '../views/Profile.vue';
import AdminLayout from '../layouts/AdminLayout.vue';

const router = createRouter({
  history: createWebHashHistory('/admin/'),
  routes: [
    { path: '/login', name: 'login', component: Login },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', name: 'overview', component: Overview },
        { path: 'users', name: 'users', component: Users },
        { path: 'api-keys', name: 'api-keys', component: ApiKeys },
        { path: 'profile', name: 'profile', component: Profile },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.booted) await session.bootstrap();

  if (to.path === '/login') {
    return session.user ? '/' : true;
  }
  if (!session.user) {
    return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined };
  }
  return true;
});

export default router;
