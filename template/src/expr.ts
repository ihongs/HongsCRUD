/**
 * 模板错误：统一携带行号与（include 子）模板路径。
 */
export class TemplateError extends Error {
  line?: number;
  file?: string;

  constructor(message: string, line?: number, file?: string) {
    const prefix = file
      ? (line ? `${file}:${line}: ` : `${file}: `)
      : (line ? `Line ${line}: ` : '');
    super(prefix + message);
    this.name = 'TemplateError';
    this.line = line;
    this.file = file;
  }
}

export type Evaluator = (view: any) => any;

export interface ExprLocation {
  line?: number;
  file?: string;
}

/**
 * 把 JS 表达式预编译为一个函数；执行时 this 即作用域代理视图。
 */
export function compileExpr(expr: string, at: ExprLocation = {}): Evaluator {
  let fn: Function;

  try {
    fn = new Function('with (this) { return (' + expr + '); }');
  } catch (err: any) {
    throw new TemplateError(err && err.message ? err.message : String(err), at.line, at.file);
  }

  return function evaluate(view: any): any {
    try {
      return fn.call(view);
    } catch (err: any) {
      if (err instanceof TemplateError) {
        throw err;
      }
      throw new TemplateError(err && err.message ? err.message : String(err), at.line, at.file);
    }
  };
}

function findKey(scope: any, key: PropertyKey): { found: boolean; value?: any } {
  let obj = scope;
  while (obj && obj !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return { found: true, value: obj[key] };
    }
    obj = Object.getPrototypeOf(obj);
  }
  return { found: false };
}

/**
 * 作用域代理：标识符先查 renderData（含作用域链），未命中再查 globalData。
 * 只做顶层遮蔽，不深合并；不穿透到宿主全局。
 */
export function createView(data: Record<string, any>, globalData: Record<string, any>): any {
  return new Proxy(data, {
    has: () => true,
    get(target, key) {
      if (key === Symbol.unscopables) {
        return undefined;
      }
      const local = findKey(target, key);
      if (local.found) {
        return local.value;
      }
      const global = findKey(globalData, key);
      return global.found ? global.value : undefined;
    },
    set(target, key, value) {
      target[key as any] = value;
      return true;
    },
  });
}
