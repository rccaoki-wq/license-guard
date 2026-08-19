/**
 * spdx-expression-parse は型定義を同梱していないため、必要な形だけを宣言する。
 * 返り値は再帰的な AST で、葉が license ノード、節が conjunction ノードになる。
 */
declare module 'spdx-expression-parse' {
  export interface LicenseNode {
    license: string;
    plus?: boolean;
    exception?: string;
  }

  export interface ConjunctionNode {
    left: ParsedSpdx;
    conjunction: 'and' | 'or';
    right: ParsedSpdx;
  }

  export type ParsedSpdx = LicenseNode | ConjunctionNode;

  /** 不正な式では例外を投げる */
  export default function parse(expression: string): ParsedSpdx;
}
