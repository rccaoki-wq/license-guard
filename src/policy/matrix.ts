import { evaluateExpression } from './engine';
import type { DistributionModel, Linkage, Obligation, Scope, Verdict } from '../types';

export const ALL_DISTRIBUTION_MODELS: readonly DistributionModel[] = [
  'saas',
  'distributed-binary',
  'on-prem-delivery',
  'internal-only',
  'library-published',
];

export interface MatrixRow {
  model: DistributionModel;
  verdict: Verdict;
  obligations: Obligation[];
  rationale: string;
  /** 宣言が版を欠いていて補った場合のみ。全行で同じ値になる */
  assumption?: { declared: string; assumed: string };
}

/**
 * 1つのライセンス式を全配布モデルで評価する。
 *
 * 「同じライセンスでも使い方で結論が変わる」という本製品の中核主張を
 * 1枚の表で示すために使う。純粋関数。
 */
export function verdictMatrix(
  expression: string,
  scope: Scope = 'runtime',
  linkage: Linkage = 'dynamic',
): MatrixRow[] {
  return ALL_DISTRIBUTION_MODELS.map((model) => {
    const r = evaluateExpression(expression, { scope, linkage, distributionModel: model });
    return {
      model,
      verdict: r.verdict,
      obligations: r.obligations,
      rationale: r.rationale,
      ...(r.assumption ? { assumption: r.assumption } : {}),
    };
  });
}
