import { regCrud }          from 'hongs-crud';
import { user }             from './user';
import { mine, mineApiKey } from './mine';

export function regCruds(): void {
  regCrud('user',       user);
  regCrud('mine',       mine);
  regCrud('mineApiKey', mineApiKey);
}
