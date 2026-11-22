import { rpc } from './rpc';

export interface ApiKeyRow {
  _id: string;
  name?: string;
  expiresAt?: string;
  createdAt?: string;
}

export function searchApiKeys(params: Record<string, any> = {}) {
  return rpc<{ list?: ApiKeyRow[]; total?: number }>('mineApiKey.search', {
    find: { app: 'sk' },
    limit: 100,
    sort: { createdAt: -1 },
    cols: { name: 1, expiresAt: 1, createdAt: 1 },
    ...params,
  });
}

export function createApiKey(name: string) {
  return rpc<{ id: string; key: string }>('mineApiKey.create', { data: { name } });
}

export function deleteApiKey(id: string) {
  return rpc<{ affected: number }>('mineApiKey.delete', { id });
}
