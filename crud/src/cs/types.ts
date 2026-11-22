/** 分词器：输入文本，返回词条数组 */
export type Segmenter = (text: string) => string[];

/** Schema 搜索配置项 */
export interface SearchConf {
  fullText : string;
  scoreKey : string;
  segmenter: Segmenter;
}

/** Schema 搜索扩展项 */
export interface SearchOpts {
  /** 全文字段名，默认 'fullText' */
  fullText?: string;
  /** 打分字段名，默认 '_score' */
  scoreKey?: string;
  /** 自定义分词器函数，默认使用 Intl.Segmenter */
  segmenter?: Segmenter;
}

/** jieba 分词器配置 */
export interface JiebaOpts {
  /** 分词模式：cut 精确分词模式（默认），search 搜索引擎模式（含子词，召回更高，但结果更长） */
  mode?: 'cut' | 'search';
  /** 是否启用 HMM 新词发现，缺省用 jieba 自身默认值 */
  hmm?: boolean;
}
