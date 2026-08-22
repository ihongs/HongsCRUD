import { regAuthFuncs } from './auth';
import { regVerifyFuncs } from './verify';

export function regFuncs(): void {
  regAuthFuncs();
  regVerifyFuncs();
}
