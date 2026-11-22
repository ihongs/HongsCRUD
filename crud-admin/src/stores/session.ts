import { defineStore } from 'pinia';
import { rpc, setAccessToken } from '../api/rpc';
import { solveChallenge } from '../api/pow';
import { FEATURE_METHODS, featureAllowed, type FeatureKey } from '../config/features';

const RT_KEY = 'crud-admin.rt';

export interface SessionUser {
  id: string;
  username: string;
  name?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  roles: string[];
}

let refreshing: Promise<boolean> | null = null;

export const useSessionStore = defineStore('session', {
  state: () => ({
    accessToken: '',
    refreshToken: sessionStorage.getItem(RT_KEY) || '',
    user: null as SessionUser | null,
    permits: [] as string[],
    booted: false,
  }),

  getters: {
    roles: (s): string[] => s.user?.roles ?? [],
    /** 方法级权限：命中即可用 */
    can: (s) => (method: string): boolean => s.permits.includes(method),
    /** 功能点权限：methods 为或关系 */
    canFeature: (s) => (key: FeatureKey): boolean => featureAllowed(key, s.permits),
  },

  actions: {
    persistTokens(accessToken: string, refreshToken: string) {
      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      sessionStorage.setItem(RT_KEY, refreshToken);
      setAccessToken(accessToken);
    },

    clear() {
      this.accessToken = '';
      this.refreshToken = '';
      this.user = null;
      this.permits = [];
      sessionStorage.removeItem(RT_KEY);
      setAccessToken('');
    },

    async login(username: string, password: string) {
      const chal = await rpc<any>('auth.chall', { username });
      const nonce = await solveChallenge(chal.challenge, Number(chal.difficulty) || 16);
      const res = await rpc<any>('auth.login', {
        username,
        password,
        scene: 'admin',
        chall: { challenge: chal.challenge, nonce },
      });
      this.persistTokens(res.accessToken, res.refreshToken);
      await this.loadMe();
    },

    async loadMe() {
      const res = await rpc<any>('mine.search', {
        cols: { username: 1, name: 1, avatar: 1, email: 1, phone: 1, roles: 1 },
      });
      const u = res?.list?.[0];
      if (!u) throw { code: -32001, message: 'current user not found' };
      this.user = {
        id: String(u._id),
        username: u.username,
        name: u.name,
        avatar: u.avatar,
        email: u.email,
        phone: u.phone,
        roles: Array.isArray(u.roles) ? u.roles : [],
      };

      await this.loadPermits();
    },

    /** 一次性向后台询问当前用户的功能权限（返回允许的方法数组） */
    async loadPermits() {
      try {
        const res = await rpc<{ permits: string[] }>('auth.permits', {
          methods: FEATURE_METHODS,
        });
        this.permits = Array.isArray(res?.permits) ? res.permits : [];
      } catch (e) {
        console.error('[session] loadPermits failed', e);
        this.permits = [];
      }
    },

    async bootstrap() {
      if (this.booted) return;
      this.booted = true;
      if (!this.refreshToken) return;

      const ok = await this.refreshSession();
      if (!ok) return;
      try {
        await this.loadMe();
      } catch (e) {
        console.error('[session] loadMe failed', e);
        this.clear();
      }
    },

    /** 单飞刷新：并发请求共享同一次刷新 */
    async refreshSession(): Promise<boolean> {
      if (refreshing) return refreshing;

      refreshing = (async () => {
        const rt = this.refreshToken;
        if (!rt) return false;
        try {
          const res = await rpc<any>('auth.refresh', { refreshToken: rt });
          this.persistTokens(res.accessToken, res.refreshToken);
          return true;
        } catch (e) {
          console.error('[session] refresh failed', e);
          this.clear();
          return false;
        } finally {
          refreshing = null;
        }
      })();

      return refreshing;
    },

    async logout() {
      const rt = this.refreshToken;
      if (rt) {
        try { await rpc('auth.logout', { refreshToken: rt }); } catch { /* ignore */ }
      }
      this.clear();
    },
  },
});
