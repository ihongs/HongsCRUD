/** 分词器：输入文本，返回词条数组 */
export type CsSegmenter = (text: string) => string[];

/** Schema 级扩展选项：CS 检索的可调项，随 new Schema(definition, options) 传入 */
export interface CsSchemaOpts {
  /** 分词器，默认 intlSegmenter；可换 buildJiebaSegmenter / 自定义 */
  csSegmenter?: CsSegmenter;
  /** 是否由组件自动建 text 索引，默认 false；自行创建索引时保持不设 / false */
  csAutoIndex?: boolean;
  /** 全文字段名，默认 '_text' */
  csFullText?: string;
  /** 打分字段名，默认 '_score' */
  csScoreKey?: string;
}

/** Schema 搜索配置项 */
export interface CsOpts {
  segmenter: CsSegmenter;
  fullText : string;
  scoreKey : string;
}
