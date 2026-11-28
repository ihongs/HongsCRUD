import { isPlainObject } from './data';
import { createView, Evaluator, TemplateError } from './expr';

export interface Scope {
  data: Record<string, any>;
  view: any;
}

export interface RenderState {
  out: string[];
  globalData: Record<string, any>;
}

export interface Block {
  render(state: RenderState, scope: Scope): void;
}

export function createScope(data: Record<string, any>, globalData: Record<string, any>): Scope {
  return { data, view: createView(data, globalData) };
}

function renderBlocks(blocks: Block[], state: RenderState, scope: Scope): void {
  for (const block of blocks) {
    block.render(state, scope);
  }
}

function assign(scope: Scope, name: string, value: any): void {
  let obj: any = scope.data;
  while (obj && obj !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(obj, name)) {
      obj[name] = value;
      return;
    }
    obj = Object.getPrototypeOf(obj);
  }
  scope.data[name] = value;
}

export class TxtBlock implements Block {
  constructor(private readonly text: string) {}

  render(state: RenderState): void {
    state.out.push(this.text);
  }
}

export class VarBlock implements Block {
  constructor(private readonly expr: Evaluator) {}

  render(state: RenderState, scope: Scope): void {
    const value = this.expr(scope.view);
    if (value !== null && value !== undefined) {
      state.out.push(String(value));
    }
  }
}

export class SetBlock implements Block {
  constructor(private readonly name: string, private readonly expr: Evaluator) {}

  render(_state: RenderState, scope: Scope): void {
    assign(scope, this.name, this.expr(scope.view));
  }
}

export interface IfGroup {
  condition: Evaluator;
  blocks: Block[];
}

export class IfBlock implements Block {
  constructor(private readonly groups: IfGroup[], private readonly elseBlocks: Block[]) {}

  render(state: RenderState, scope: Scope): void {
    for (const group of this.groups) {
      if (group.condition(scope.view)) {
        renderBlocks(group.blocks, state, scope);
        return;
      }
    }
    renderBlocks(this.elseBlocks, state, scope);
  }
}

export class ForBlock implements Block {
  constructor(
    private readonly variables: string[],
    private readonly iterable: Evaluator,
    private readonly body: Block[],
    private readonly elseBody: Block[],
    private readonly line?: number,
    private readonly file?: string,
  ) {}

  render(state: RenderState, scope: Scope): void {
    const value = this.iterable(scope.view);
    const duoed = this.variables.length > 1;
    let entries: Iterable<any> | null = null;
    let keyed = false;

    if (value === null || value === undefined) {
      entries = null;
    } else if (value instanceof Map) {
      entries = value.entries();
      keyed = true;
    } else if (value instanceof Set
      || Array.isArray(value)
      || typeof value === 'string'
      || typeof value[Symbol.iterator] === 'function'
    ) {
      if (duoed) {
        throw new TemplateError('for k, v requires a Map or plain object', this.line, this.file);
      }
      entries = value;
    } else if (isPlainObject(value)) {
      entries = Object.entries(value);
      keyed = true;
    } else {
      throw new TemplateError(`Non-iterable value in for`, this.line, this.file);
    }

    let hasItems = false;
    if (entries) {
      for (const item of entries) {
        hasItems = true;
        const child = createScope(Object.create(scope.data), state.globalData);
        if (duoed) {
          child.data[this.variables[0]] = (item as any[])[0];
          child.data[this.variables[1]] = (item as any[])[1];
        } else if (keyed) {
          child.data[this.variables[0]] = (item as any[])[0];
        } else {
          child.data[this.variables[0]] = item;
        }
        renderBlocks(this.body, state, child);
      }
    }

    if (!hasItems) {
      renderBlocks(this.elseBody, state, scope);
    }
  }
}

export class IncludeBlock implements Block {
  constructor(
    private readonly blocks: Block[],
    private readonly withExpr?: Evaluator,
  ) {}

  render(state: RenderState, scope: Scope): void {
    let target = scope;

    if (this.withExpr) {
      const value = this.withExpr(scope.view);
      const context = isPlainObject(value) ? value : {};
      target = createScope({ ...context }, state.globalData);
    }

    renderBlocks(this.blocks, state, target);
  }
}
