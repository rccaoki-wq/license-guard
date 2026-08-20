import parse from 'spdx-expression-parse';
import { evaluateLicense } from './rules';
import { normalizeLicenseString } from './normalize';
import type { Obligation, PolicyContext, PolicyResult, Verdict } from '../types';

const SEVERITY: Record<Verdict, number> = {
  allowed: 0,
  review: 1,
  blocked: 2,
};

/**
 * コピーレフト義務を緩和することが明示されている例外。
 * これらが付与されたライセンスは permissive 相当として扱う。
 */
const RELAXING_EXCEPTIONS = new Set<string>([
  'classpath-exception-2.0',
  'gcc-exception-3.1',
  'gcc-exception-2.0',
  'llvm-exception',
  'autoconf-exception-3.0',
  'bison-exception-2.2',
]);

type Node =
  | { license: string; plus?: boolean; exception?: string }
  | { left: Node; conjunction: 'and' | 'or'; right: Node };

function mergeObligations(a: Obligation[], b: Obligation[]): Obligation[] {
  return [...new Set([...a, ...b])];
}

function evalNode(node: Node, ctx: PolicyContext): PolicyResult {
  if ('license' in node) {
    if (node.exception && RELAXING_EXCEPTIONS.has(node.exception.toLowerCase())) {
      return {
        verdict: 'allowed',
        obligations: ['attribution'],
        rationale: `${node.license} carries the ${node.exception} exception, which lifts the copyleft obligation that linking would otherwise trigger.`,
      };
    }
    return evaluateLicense(node.license, ctx);
  }

  const left = evalNode(node.left, ctx);
  const right = evalNode(node.right, ctx);

  if (node.conjunction === 'or') {
    // 利用者がいずれかを選択できるため、緩い方を採る
    const chosen = SEVERITY[left.verdict] <= SEVERITY[right.verdict] ? left : right;
    return {
      verdict: chosen.verdict,
      obligations: chosen.obligations,
      rationale: `This package offers a choice of licenses. The least restrictive option is shown. ${chosen.rationale}`,
    };
  }

  // AND: 全てが適用されるため、厳しい方を採り義務を合算する
  const stricter = SEVERITY[left.verdict] >= SEVERITY[right.verdict] ? left : right;
  return {
    verdict: stricter.verdict,
    obligations: mergeObligations(left.obligations, right.obligations),
    rationale: `Multiple licenses apply at once. ${left.rationale} / ${right.rationale}`,
  };
}

/**
 * SPDX ライセンス式を評価する。純粋関数。
 * null（ライセンス不明）は全権利留保として blocked を返す。
 */
export function evaluateExpression(
  expression: string | null,
  ctx: PolicyContext,
): PolicyResult {
  if (expression === null || expression.trim() === '') {
    return evaluateLicense('', ctx);
  }

  // 旧 npm 表記（"MIT/X11" 等）は SPDX として解釈できないため先に寄せる
  const normalized = normalizeLicenseString(expression);

  let ast: Node;
  try {
    ast = parse(normalized) as Node;
  } catch {
    return {
      verdict: 'review',
      obligations: [],
      rationale: `The license string "${expression}" could not be parsed as an SPDX expression. The original license text needs individual review.`,
    };
  }

  return evalNode(ast, ctx);
}
