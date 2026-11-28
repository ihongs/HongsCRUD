import { Block, RenderState, createScope } from './blocks';
import { GLOBAL } from './data';
import { TemplateError } from './expr';
import { parseTemplate } from './parser';

export { GLOBAL, TemplateError };
export type { DataBag } from './data';
export type { Block, RenderState, Scope } from './blocks';

export interface CompileOptions {
  /** 当前模板目录，include 相对此目录解析 */
  baseDir?: string;
  /** 安全根目录，include 不得越出；默认等于 baseDir */
  rootDir?: string;
  /** 该模板使用的全局数据，默认 GLOBAL；render 时与 data 浅合并 */
  globalData?: Record<string, any>;
}

export class Template {
  constructor(
    private readonly blocks: Block[],
    private readonly globalData: Record<string, any>,
  ) {}

  /** 使用 data（变量 + 函数）渲染；先查 data，未命中回退 globalData */
  render(data?: Record<string, any>): string {
    // 只浅拷贝 render 数据，避免 set 改动调用方对象；不拷贝 globalData
    const renderData = { ...(data || {}) };
    const state: RenderState = { out: [], globalData: this.globalData };
    const scope = createScope(renderData, this.globalData);

    for (const block of this.blocks) {
      block.render(state, scope);
    }

    return state.out.join('');
  }
}

export function compile(source: string, options: CompileOptions = {}): Template {
  let baseDir: string | undefined;
  let rootDir: string | undefined;

  if (options.baseDir || options.rootDir) {
    let path: any;
    try {
      path = loadNodeModule('path');
    } catch (err) {
      throw new TemplateError('baseDir/rootDir requires Node.js path module');
    }
    baseDir = options.baseDir ? path.resolve(options.baseDir) : undefined;
    rootDir = options.rootDir ? path.resolve(options.rootDir) : baseDir;
  }

  const blocks = parseTemplate(source, { baseDir, rootDir, loadModule: loadNodeModule });

  return new Template(blocks, options.globalData ?? GLOBAL);
}

export function compileFile(file: string, options: CompileOptions = {}): Template {
  let fs: any;
  let path: any;
  try {
    fs = loadNodeModule('fs');
    path = loadNodeModule('path');
  } catch (err) {
    throw new TemplateError('compileFile requires Node.js fs/path');
  }

  const target = path.resolve(file);
  const baseDir = options.baseDir ? path.resolve(options.baseDir) : path.dirname(target);
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : baseDir;

  let source: string;
  try {
    source = fs.readFileSync(target, 'utf8');
  } catch (err) {
    throw new TemplateError(`Template not found: ${file}`);
  }

  const blocks = parseTemplate(source, { baseDir, rootDir, file: target, loadModule: loadNodeModule });

  return new Template(blocks, options.globalData ?? GLOBAL);
}

/**
 * 惰性加载 Node 内置模块：非 Node 环境 import 本库不会失败，
 * 只有真正用到 compileFile / include 时才报错。
 */
function loadNodeModule(name: string): any {
  const req = typeof require === 'function' ? require : undefined;
  if (req) {
    try {
      return req(name);
    } catch (err) {
      // 继续走统一报错
    }
  }
  throw new Error(`Node.js module "${name}" is not available in this environment`);
}
