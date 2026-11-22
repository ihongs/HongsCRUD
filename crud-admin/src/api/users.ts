import { rpc } from './rpc';

export interface SearchResult<T = any> {
  list?: T[];
  total?: number;
  more?: boolean;
}

export function searchUsers(params: Record<string, any>) {
  return rpc<SearchResult>('user.search', params);
}

export function createUser(data: Record<string, any>) {
  return rpc<{ id: string }>('user.create', { data });
}

export function updateUser(id: string, data: Record<string, any>) {
  return rpc<{ affected: number; validIds?: string[] }>('user.update', { id, data });
}

export function deleteUser(id: string) {
  return rpc<{ affected: number; validIds?: string[] }>('user.delete', { id });
}
