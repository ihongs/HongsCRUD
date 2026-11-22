import { regAuthFuncs } from './auth';
import { regUploadFuncs } from './upload';

export function regFuncs(): void {
  regAuthFuncs();
  regUploadFuncs();
}
