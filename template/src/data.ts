export type DataBag = Record<string, any>;

/**
 * 纯对象判断：非 null、非数组，原型为 Object.prototype 或 null。
 */
export function isPlainObject(value: any): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function tplIsValid(value: any): boolean {
  if (value === null || value === undefined || value === false || value === 0) {
    return false;
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return false;
  }
  if (value === '') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Set || value instanceof Map) {
    return value.size > 0;
  }
  if (value instanceof Range) {
    return value.length > 0;
  }
  if (isPlainObject(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function tplCount(value: any): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length;
  }
  if (value instanceof Set || value instanceof Map) {
    return value.size;
  }
  if (value instanceof Range) {
    return value.length;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length;
  }
  return 0;
}

function tplRange(start: any, end: any, step: any = 1): Range {
  const from = Number(start ?? 0);
  const to = Number(end ?? 0);
  const gap = Number(step ?? 1);
  if (gap === 0) {
    throw new Error('Range step can not be 0');
  }
  return new Range(from, to, gap);
}

/**
 * 可重复迭代的区间对象：每次 for 都返回新的迭代器，不预先分配数组。
 */
class Range implements Iterable<number> {
  readonly length: number;

  constructor(
    readonly start: number,
    readonly end: number,
    readonly step: number,
  ) {
    if (step > 0) {
      this.length = start < end ? Math.ceil((end - start) / step) : 0;
    } else {
      this.length = start > end ? Math.ceil((start - end) / -step) : 0;
    }
  }

  *[Symbol.iterator](): Iterator<number> {
    if (this.step > 0) {
      for (let i = this.start; i < this.end; i += this.step) {
        yield i;
      }
    } else {
      for (let i = this.start; i > this.end; i += this.step) {
        yield i;
      }
    }
  }

  toArray(): number[] {
    return [...this];
  }
}

function tplIndent(text: any, ind: any = '\t'): string {
  const src = text === null || text === undefined ? '' : String(text);
  if (!src) {
    return '';
  }
  return src.replace(/^/gm, String(ind ?? ''));
}

/**
 * printf 子集：%s %d %i %f %.Nf %j %x %X %%，支持宽度与左对齐。
 * 纯 JS 实现，浏览器与 Node 行为一致；%j 用 JSON.stringify。
 */
function tplFormat(fmt: any, ...args: any[]): string {
  const text = String(fmt ?? '');
  let index = 0;

  return text.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdifjxX%])/g,
    (_all, flags: string, width: string, precision: string, type: string) => {
      if (type === '%') {
        return '%';
      }
      if (index >= args.length) {
        return _all;
      }
      const value = args[index++];
      let out: string;

      switch (type) {
        case 's':
          out = String(value);
          break;
        case 'd':
        case 'i':
          out = String(Math.trunc(Number(value)));
          break;
        case 'f': {
          const digits = precision === undefined ? 6 : Number(precision);
          out = Number(value).toFixed(digits);
          break;
        }
        case 'j':
          try {
            out = JSON.stringify(value);
          } catch (err) {
            out = '[Circular]';
          }
          break;
        case 'x':
          out = (Number(value) >>> 0).toString(16);
          break;
        case 'X':
          out = (Number(value) >>> 0).toString(16).toUpperCase();
          break;
        default:
          out = String(value);
      }

      if (width !== undefined) {
        const size = Number(width);
        const pad = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
        out = flags.includes('-') ? out.padEnd(size, ' ') : out.padStart(size, pad);
      }
      return out;
    });
}

/**
 * dayjs 风格：YYYY YY MM M DD D HH H mm m ss s SSS，方括号内为字面量。
 */
function tplFormatDate(fmt: any, time: any, timeZone?: string): string {
  if (time === null || time === undefined || time === '') {
    return '';
  }

  const date = toDate(time);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${time}`);
  }

  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  let second: number;

  if (!timeZone) {
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
    hour = date.getHours();
    minute = date.getMinutes();
    second = date.getSeconds();
  } else {
    let dtf: Intl.DateTimeFormat;
    try {
      dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      } as any);
    } catch (err) {
      throw new Error(`Invalid timeZone: ${timeZone}`);
    }
    const parts = dtf.formatToParts(date);
    const values: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        values[part.type] = part.value;
      }
    }
    year = Number(values.year);
    month = Number(values.month);
    day = Number(values.day);
    hour = Number(values.hour);
    minute = Number(values.minute);
    second = Number(values.second);
  }

  const tokens: Array<[string, string]> = [
    ['YYYY', String(year)],
    ['YY', pad2(year % 100)],
    ['MM', pad2(month)],
    ['M', String(month)],
    ['DD', pad2(day)],
    ['D', String(day)],
    ['HH', pad2(hour)],
    ['H', String(hour)],
    ['mm', pad2(minute)],
    ['m', String(minute)],
    ['ss', pad2(second)],
    ['s', String(second)],
    ['SSS', pad3(date.getMilliseconds())],
  ];

  const pattern = String(fmt ?? '');
  let out = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        out += pattern.slice(i);
        break;
      }
      out += pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }

    let matched = false;
    for (const [token, value] of tokens) {
      if (pattern.startsWith(token, i)) {
        out += value;
        i += token.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += ch;
      i++;
    }
  }

  return out;
}

function toDate(time: any): Date {
  if (time instanceof Date) {
    return time;
  }
  if (typeof time === 'number') {
    return new Date(time);
  }
  if (typeof time === 'string') {
    const text = time.trim();
    if (!text) {
      return new Date(NaN);
    }
    if (/^-?\d+(\.\d+)?$/.test(text)) {
      return new Date(Number(text));
    }
    return new Date(text.replace(' ', 'T'));
  }
  return new Date(NaN);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad3(n: number): string {
  return n < 100 ? `0${pad2(n)}` : String(n);
}

/**
 * 模板全局数据：预置函数与可直接使用的 JS 内建值。
 * render 时与调用方数据浅合并，data 优先。
 */
export const GLOBAL: DataBag = {
  $isObject: isPlainObject,
  $isValid: tplIsValid,
  $count: tplCount,
  $range: tplRange,
  $indent: tplIndent,
  $format: tplFormat,
  $formatDate: tplFormatDate,

  JSON,
  Math,
  Intl,
  Date,
  Object,
  Array,
  Number,
  String,
  Boolean,
  RegExp,
  isNaN,
  isFinite,
  parseInt,
  parseFloat,
  encodeURI,
  decodeURI,
  encodeURIComponent,
  decodeURIComponent,
  NaN: NaN,
  Infinity: Infinity,
  undefined: undefined,
};
