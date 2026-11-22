import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import './styles/theme.css';
import App from './App.vue';
import router from './router';
import { useSessionStore } from './stores/session';
import { setRefreshHandler } from './api/rpc';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

const session = useSessionStore();
setRefreshHandler(() => session.refreshSession());
if (session.accessToken) session.refreshSession();

app.use(router);
app.mount('#app');
