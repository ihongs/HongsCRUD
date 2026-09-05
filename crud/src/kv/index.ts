// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

// Roster 注册器：regRoster 注册全局实现（单例），getRoster 获取（亦为默认导出）。
// 未注册时读环境变量 KV_ROSTER（值为模块，取其默认导出为实现类，如 hongs-crud/kv/mongo）
// 自动加载该实现并无参构造注册（实现类无参构造时自行读环境变量配置），两者皆无抛 INTERNEL_ERROR。
// 实现为动态 require（值来自环境变量），本入口不静态依赖 mongoose / redis。

import { resolve } from 'path';
import { CrudError, CrudErrno } from '../index';
import type { Roster } from './types';

export * from './types';

const ROSTER: { roster?: Roster } = {};

/** 注册全局 Roster 实现（单例） */
export function regRoster(roster: Roster): void {
  ROSTER.roster = roster;
}

/** 获取全局 Roster 单例；未注册时读 KV_ROSTER 自动注册，两者皆无抛 INTERNEL_ERROR */
export function getRoster(): Roster {
  if (! ROSTER.roster) {
    ROSTER.roster = autoRoster();
  }
  return ROSTER.roster;
}

export default getRoster;   // 默认导出取值器，导入可任取名字，如 import roster from 'hongs-crud/kv'

// 按环境变量 KV_ROSTER 自动构建，值为模块（取其默认导出为实现类）；模块以 './' '../' 开头时相对 cwd 解析，其余按包名
function autoRoster(): Roster {
  const conf = process.env.KV_ROSTER;
  if (! conf) {
    throw new CrudError('Roster not registered!', CrudErrno.INTERNEL_ERROR);
  }
  const spec = conf.startsWith('./') || conf.startsWith('../') ? resolve(conf) : conf;
  let Ctor: any;
  try {
    Ctor = require(spec)?.default;
  } catch (e: any) {
    throw new CrudError(`KV_ROSTER module load failed: ${spec}: ${e?.message}`, CrudErrno.INTERNEL_ERROR);
  }
  if (typeof Ctor !== 'function') {
    throw new CrudError(`KV_ROSTER default export is not a class: ${conf}`, CrudErrno.INTERNEL_ERROR);
  }
  const roster = new Ctor();
  if (typeof roster.get !== 'function'
  ||  typeof roster.set !== 'function'
  ||  typeof roster.remove !== 'function') {
    throw new CrudError(`KV_ROSTER class is not a Roster: ${conf}`, CrudErrno.INTERNEL_ERROR);
  }
  return roster;
}
