import { rpc } from './rpc';

export function getProfile() {
  return rpc<{ list?: any[]; total?: number }>('mine.search', {
    cols: { username: 1, name: 1, avatar: 1, email: 1, phone: 1, roles: 1 },
  });
}

export function updateProfile(data: Record<string, any>) {
  return rpc<{ affected: number }>('mine.update', { data });
}
