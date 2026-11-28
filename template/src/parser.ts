import {
  Block,
  ForBlock,
  IfBlock,
  IfGroup,
  IncludeBlock,
  SetBlock,
  TxtBlock,
  VarBlock,
} from './blocks';
import { compileExpr, TemplateError } from './expr';

export interface ParseOptions {
  /** 当前模板目录，include 相对它解析 */
  baseDir?: string;
  /** 安全根目录 */
  rootDir?: string;
  /** 当前模板文件路径（错误定位用） */
  file?: string;
  /** 惰性加载 Node 内置模块（include 用 fs/path） */
  loadModule?: (name: string) => any;
}

type TagKind = 'var' | 'dir' | 'comment';

interface TextToken {
  kind: 'text';
  start: number;
  end: number;
}

interface TagToken {
  kind: TagKind;
  start: number;
  end: number;
  content: string;
}

type Token = TextToken | TagToken;

function lineAt(source: string, index: number): number {
  let line = 1;
  const end = Math.min(index, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

function errorAt(source: string, index: number, options: ParseOptions, message: string): TemplateError {
  return new TemplateError(message, lineAt(source, index), options.file);
}

function dirName(content: string): string {
  const match = /^\s*([A-Za-z]+)/.exec(content);
  return match ? match[1] : '';
}

function skipString(source: string, index: number): number {
  const quote = source[index];
  let pos = index + 1;

  while (pos < source.length) {
    const ch = source[pos];
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    if (ch === quote) {
      return pos + 1;
    }
    pos++;
  }

  return pos;
}

function skipRegex(source: string, index: number): number {
  let pos = index + 1;
  let inClass = false;

  while (pos < source.length) {
    const ch = source[pos];
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    if (ch === '[') {
      inClass = true;
    } else if (ch === ']') {
      inClass = false;
    } else if (ch === '/' && !inClass) {
      return pos + 1;
    }
    pos++;
  }

  return pos;
}

function looksLikeExprStart(head: string): boolean {
  const trimmed = head.replace(/\s+$/, '');
  if (!trimmed) {
    return true;
  }
  const last = trimmed[trimmed.length - 1];
  if ('([{=,:;!&|?+-*%<>~^'.includes(last)) {
    return true;
  }
  return /(?:^|\s)(?:if|elif|for|in|with)$/.test(trimmed);
}

function scan(source: string, options: ParseOptions): { tokens: Token[]; tags: TagToken[] } {
  const tokens: Token[] = [];
  const tags: TagToken[] = [];
  let index = 0;
  let textStart = 0;

  while (index < source.length) {
    let next = -1;
    let kind: TagKind | undefined;

    const pick = (pos: number, type: TagKind) => {
      if (pos !== -1 && (next === -1 || pos < next)) {
        next = pos;
        kind = type;
      }
    };

    pick(source.indexOf('{{', index), 'var');
    pick(source.indexOf('{%', index), 'dir');
    pick(source.indexOf('{#', index), 'comment');

    if (next === -1) {
      break;
    }

    if (next > textStart) {
      tokens.push({ kind: 'text', start: textStart, end: next });
    }

    let end: number;
    if (kind === 'comment') {
      const close = source.indexOf('#}', next + 2);
      if (close === -1) {
        throw errorAt(source, next, options, 'Unclosed comments');
      }
      end = close + 2;
    } else {
      const term = kind === 'var' ? '}}' : '%}';
      let pos = next + 2;

      while (pos < source.length) {
        const ch = source[pos];
        if (ch === '"' || ch === "'" || ch === '`') {
          pos = skipString(source, pos);
          continue;
        }
        if (ch === '/') {
          const head = source.slice(next + 2, pos);
          if (looksLikeExprStart(head)) {
            pos = skipRegex(source, pos);
            continue;
          }
        }
        if (source[pos] === term[0] && source[pos + 1] === term[1]) {
          break;
        }
        pos++;
      }

      if (pos >= source.length) {
        throw errorAt(source, next, options, kind === 'var' ? 'Unclosed variable' : 'Unclosed directive');
      }
      end = pos + 2;
    }

    const tag: TagToken = {
      kind: kind as TagKind,
      start: next,
      end,
      content: source.slice(next + 2, end - 2),
    };

    tokens.push(tag);
    tags.push(tag);

    index = end;
    textStart = end;
  }

  if (textStart < source.length) {
    tokens.push({ kind: 'text', start: textStart, end: source.length });
  }

  return { tokens, tags };
}

/**
 * 独占一行的指令/注释整行移除（include 行保留换行）。
 * 返回逐字符标记，1 表示输出时丢弃。
 */
function computeDrops(source: string, tags: TagToken[]): Uint8Array {
  const mask = new Uint8Array(source.length);

  for (const tag of tags) {
    let type = 1;
    if (tag.kind === 'var') {
      type = 3;
    } else if (tag.kind === 'dir') {
      type = dirName(tag.content) === 'include' ? 2 : 1;
    }
    mask.fill(type, tag.start, tag.end);
  }

  const drop = new Uint8Array(source.length);
  let lineStart = 0;

  while (lineStart <= source.length) {
    let lineEnd = source.indexOf('\n', lineStart);
    const hasBreak = lineEnd !== -1;
    if (!hasBreak) {
      lineEnd = source.length;
    }

    let hasTag = false;
    let removable = true;

    for (let i = lineStart; i < lineEnd; i++) {
      const type = mask[i];
      if (type === 1) {
        hasTag = true;
        continue;
      }
      if (type === 2 || type === 3) {
        removable = false;
        break;
      }
      const ch = source[i];
      if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
        removable = false;
        break;
      }
    }

    if (removable && hasTag) {
      drop.fill(1, lineStart, hasBreak ? lineEnd + 1 : source.length);
    }

    if (!hasBreak) {
      break;
    }
    lineStart = lineEnd + 1;
  }

  return drop;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: Token[],
    private readonly drop: Uint8Array,
    private readonly options: ParseOptions,
  ) {}

  parseBlocks(stops: string[]): { blocks: Block[]; stop?: TagToken } {
    const blocks: Block[] = [];

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];

      if (token.kind === 'text') {
        const text = this.textOf(token);
        if (text) {
          blocks.push(new TxtBlock(text));
        }
        this.pos++;
        continue;
      }

      if (token.kind === 'comment') {
        this.pos++;
        continue;
      }

      if (token.kind === 'var') {
        const expr = token.content.trim();
        if (!expr) {
          throw this.error('Empty variable', token.start);
        }
        blocks.push(new VarBlock(this.compile(expr, token)));
        this.pos++;
        continue;
      }

      const name = dirName(token.content);
      if (stops.includes(name)) {
        return { blocks, stop: token };
      }

      switch (name) {
        case 'if':
          blocks.push(this.parseIf(token));
          break;
        case 'for':
          blocks.push(this.parseFor(token));
          break;
        case 'set':
          blocks.push(this.parseSet(token));
          break;
        case 'include':
          blocks.push(this.parseInclude(token));
          break;
        case 'elif':
        case 'else':
        case 'endif':
        case 'endfor':
          throw this.error(`Unexpected directive: ${name}`, token.start);
        default:
          throw this.error(`Unknown directive: ${token.content.trim()}`, token.start);
      }
    }

    return { blocks };
  }

  private parseIf(token: TagToken): IfBlock {
    const content = token.content.trim();
    const match = /^if\s*([\s\S]*)$/.exec(content);
    const expr = match ? match[1].trim() : '';
    if (!expr) {
      throw this.error('Missing condition for if', token.start);
    }

    const groups: IfGroup[] = [{
      condition: this.compile(expr, token),
      blocks: [],
    }];

    this.pos++;
    let result = this.parseBlocks(['elif', 'else', 'endif']);
    groups[0].blocks = result.blocks;

    while (result.stop && dirName(result.stop.content) === 'elif') {
      const stop = result.stop;
      const nextExpr = /^elif\s*([\s\S]*)$/.exec(stop.content.trim());
      const condition = nextExpr ? nextExpr[1].trim() : '';
      if (!condition) {
        throw this.error('Missing condition for elif', stop.start);
      }

      this.pos++;
      const next = this.parseBlocks(['elif', 'else', 'endif']);
      groups.push({ condition: this.compile(condition, stop), blocks: next.blocks });
      result = next;
    }

    let elseBlocks: Block[] = [];
    if (result.stop && dirName(result.stop.content) === 'else') {
      this.pos++;
      const next = this.parseBlocks(['endif']);
      elseBlocks = next.blocks;
      result = next;
    }

    if (!result.stop || dirName(result.stop.content) !== 'endif') {
      throw this.error('Unclosed if statement', token.start);
    }
    this.pos++;

    return new IfBlock(groups, elseBlocks);
  }

  private parseFor(token: TagToken): ForBlock {
    const content = token.content.trim();
    const match = /^for\s+([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\s+in\s+([\s\S]+)$/.exec(content);
    if (!match) {
      throw this.error(`Invalid for statement: ${content}`, token.start);
    }

    const variables = match[2] ? [match[1], match[2]] : [match[1]];

    this.pos++;
    let result = this.parseBlocks(['else', 'endfor']);
    const body = result.blocks;
    let elseBlocks: Block[] = [];

    if (result.stop && dirName(result.stop.content) === 'else') {
      this.pos++;
      const next = this.parseBlocks(['endfor']);
      elseBlocks = next.blocks;
      result = next;
    }

    if (!result.stop || dirName(result.stop.content) !== 'endfor') {
      throw this.error('Unclosed for statement', token.start);
    }
    this.pos++;

    return new ForBlock(
      variables,
      this.compile(match[3], token),
      body,
      elseBlocks,
      lineAt(this.source, token.start),
      this.options.file,
    );
  }

  private parseSet(token: TagToken): SetBlock {
    const content = token.content.trim();
    const match = /^set\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(content);
    if (!match) {
      throw this.error(`Invalid set statement: ${content}`, token.start);
    }
    this.pos++;
    return new SetBlock(match[1], this.compile(match[2], token));
  }

  private parseInclude(token: TagToken): IncludeBlock {
    const content = token.content.trim();
    const match = /^include\s+(['"])([\s\S]*?)\1(?:\s+with\s+([\s\S]+))?$/.exec(content);
    if (!match) {
      throw this.error(`Invalid include statement: ${content}`, token.start);
    }

    const baseDir = this.options.baseDir;
    if (!baseDir) {
      throw this.error('Include requires baseDir', token.start);
    }

    let path: any;
    let fs: any;
    try {
      const load = this.options.loadModule;
      if (!load) {
        throw new Error('no loader');
      }
      path = load('path');
      fs = load('fs');
    } catch (err) {
      throw this.error('Include requires Node.js fs/path', token.start);
    }

    const rootDir = this.options.rootDir || baseDir;
    const target = path.resolve(baseDir, match[2]);
    const relative = path.relative(rootDir, target);

    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw this.error(`Include path escapes rootDir: ${match[2]}`, token.start);
    }

    let childSource: string;
    try {
      childSource = fs.readFileSync(target, 'utf8');
    } catch (err) {
      throw this.error(`Template not found: ${match[2]}`, token.start);
    }

    const blocks = parseTemplate(childSource, {
      baseDir: path.dirname(target),
      rootDir,
      file: target,
      loadModule: this.options.loadModule,
    });
    const withExpr = match[3] ? this.compile(match[3], token) : undefined;

    this.pos++;
    return new IncludeBlock(blocks, withExpr);
  }

  private compile(expr: string, token: TagToken) {
    return compileExpr(expr, {
      line: lineAt(this.source, token.start),
      file: this.options.file,
    });
  }

  private error(message: string, index: number): TemplateError {
    return errorAt(this.source, index, this.options, message);
  }

  private textOf(token: TextToken): string {
    let text = '';
    for (let i = token.start; i < token.end; i++) {
      if (!this.drop[i]) {
        text += this.source[i];
      }
    }
    return text;
  }
}

export function parseTemplate(source: string, options: ParseOptions = {}): Block[] {
  const { tokens, tags } = scan(source, options);
  const drop = computeDrops(source, tags);
  const parser = new Parser(source, tokens, drop, options);
  return parser.parseBlocks([]).blocks;
}
