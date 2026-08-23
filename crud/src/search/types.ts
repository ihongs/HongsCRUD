// AI 注意：我有对齐强迫症，不要删除用于对齐的空格

// Chaser（ES 检索组件）的类型声明，经 subpath 'hongs-crud/search' 导出；
// 主入口 hongs-crud 不含本目录，用不到搜索的项目无需安装 @elastic/elasticsearch。
// 同步选项见 docs/plan-crud-search.md 5.2，Schema 扩展选项与字段扩展项见 1.1。

/* ---------- 同步选项与结果 ---------- */

export interface SyncOpts {
  refresh?: boolean | 'wait_for';   // 默认 false，测试或写后即读时传 'wait_for'
}

export interface SyncFindOpts extends SyncOpts {
  batch?: number;                   // 每批文档数，默认 1000
  purge?: boolean;                  // 仅全量（不传 find）时有效，默认 true
}

export interface SyncPurgeOpts extends SyncOpts {
  since : Date;                     // 水位，删除同步戳早于此时间的文档，必传
}

export interface SyncStat {
  total  : number;   // 扫描到的文档数
  indexed: number;   // 写入数
  deleted: number;   // 删除数
  failed : number;   // 失败数
  errors : any[];    // 失败明细（截断保留前 N 条）
}

/* ---------- Schema 扩展选项与字段扩展项 ---------- */

/** Schema 级扩展选项：ES 索引与同步的可调项，随 new Schema(definition, options) 传入 */
export interface EsSchemaOpts {
  /** ES 索引名，默认取 collection */
  esIndex?: string;
  /** 合并搜索字段名，wd 的查询目标，默认 'fullText' */
  esFullText?: string;
  /** 同步戳字段名，每次写入 ES 时置为当前时间，默认 'syntTime' */
  esSyntTime?: string;
  /** 索引内所有 text 字段（含合并字段）的默认分词器，可被字段级 analyzer 覆盖，默认不设（ES 的 standard） */
  esAnalyzer?: string;
  /** 写入（add / set / putAll / delAll）后是否自动同步 ES，默认 true；false 则完全交给定时 syncFind */
  esAutoSync?: boolean;
  /** 同步失败回调，默认 console.error */
  esSyncError?: (err: any, info: Record<string, any>) => void;
}

/** 字段级扩展项：是否入索引 / 并入全文、nested 与分词器，随字段定义传入 */
export interface EsFieldOpts {
  /** 是否纳入 ES 索引，默认 true；false 则该字段（容器字段则整棵子树）不进 ES，find / wd / sort 均不可用 */
  canSync?: boolean;
  /** 是否并入全文合并字段，默认 true；false 仍进索引、仍可单独 find / sort，供备注等长文本使用 */
  canText?: boolean;
  /** 数组子文档声明 nested 才保留元素关联（映射为 ES nested），默认按扁平模式 */
  nested?: boolean;
  /** 字段级分词器，覆盖 Schema 级 esAnalyzer，只对映射为 text 的字段有效 */
  analyzer?: string;
  /** text 的 keyword 子字段截断阈值：默认 256；0 不声明子字段（只搜不精确匹配，等值 / 排序 / 聚合不可用）；-1 不限 */
  cutText?: number;
}

/** Schema 扩展选项的规范化形式（默认值已填，见 1.1） */
export interface EsOpts {
  esIndex    : string;
  esFullText : string;
  esSyntTime : string;
  esAnalyzer?: string;
  esAutoSync : boolean;
  esSyncError: (err: any, info: Record<string, any>) => void;
}

/** 叶子字段的推导结果：ES 类型、分词器与清单归属 */
export interface EsLeaf {
  name     : string;                          // 完整点号路径
  kind     : 'text' | 'keyword' | 'double' | 'boolean' | 'date';
  analyzer?: string;                          // 字段级 analyzer > Schema 级 esAnalyzer，仅 text 有效
  textsize?: number;                          // text 的 keyword 子字段截断阈值，见 leafMapping
  textable : boolean;                         // kind = text 且未标 canText: false
  countable: boolean;                         // 字段定义项标了 countable: true
}
