import { randomInt } from 'crypto';
import mongoose from 'mongoose';
import { user } from '../cruds/user';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crud';

const USERNAME = 'admin';

/** 去掉易混淆字符（0/O/o、1/l/I）的字符集 */
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 生成 6 位随机密码（crypto 无偏随机） */
function genPassword(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CHARSET[randomInt(CHARSET.length)];
  }
  return out;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('[mongo] connected:', MONGO_URI);

  const password = genPassword();
  const model = user.getModel();

  // username 是 unique 索引，软删除的记录也会占位，故这里不加 isDeleted 过滤
  const exist = await model.findOne({ username: USERNAME }).select('_id').lean() as any;

  let uid: string;
  let action: 'created' | 'updated';

  if (exist) {
    uid = String(exist._id);
    // 重置密码，并确保拥有 admin 角色、未被软删除
    await (user.set(uid, {
      password,
      roles: ['admin'],
      isDeleted: false,
    }) as unknown as Promise<[ any, number ]>);
    action = 'updated';
  } else {
    [ , uid ] = await (user.add({
      username: USERNAME,
      password,
      name: '管理员',
      roles: ['admin'],
    }) as unknown as Promise<[ any, string ]>);
    action = 'created';
  }

  console.log('');
  console.log('==================================');
  console.log(` 管理员账户已${action === 'created' ? '创建' : '重置'}`);
  console.log('----------------------------------');
  console.log(` id       : ${uid}`);
  console.log(` username : ${USERNAME}`);
  console.log(` password : ${password}`);
  console.log('==================================');
  console.log(' 请立即保存该密码，它不会再次显示。');
  console.log('');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[fatal]', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
