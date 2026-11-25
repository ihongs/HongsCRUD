import { regUserCruds } from './user';
import { regMineCruds } from './mine';

export function regCruds(): void {
  regUserCruds();
  regMineCruds();
}
