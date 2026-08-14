import { regCrud } from 'hongs-crud';
import { userCrud } from './user';

export function registerSchemas(): void {
  regCrud('user', userCrud);
}
