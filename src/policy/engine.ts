import parse from 'spdx-expression-parse';
import { evaluateLicense } from './rules';
import { categorize } from './categories';
import { normalizeLicenseString } from './normalize';
import type { Obligation, PolicyContext, PolicyResult, Verdict } from '../types';

const SEVERITY: Record<Verdict, number> = {
  allowed: 0,
  review: 1,
  blocked: 2,
};

/**
 * リンクを通じたコピーレフトの伝播を、明示的に解除する例外。
 *
 * **入れてよいのは「リンクした側の成果物を同じライセンスにしなくてよい」と
 * 述べている例外だけ。** autoconf や bison の例外は、そのツールが生成した
 * 出力を自分の条件で配ってよいという話であり、依存として取り込むこととは
 * 関係が無い。ここに入れると、GPL のまま扱うべきものが allowed で返る。
 */
const LINKING_EXCEPTIONS = new Set<string>([
  'classpath-exception-2.0',
  'gcc-exception-3.1',
  'gcc-exception-2.0',
  'llvm-exception',
]);

/**
 * リンク例外を適用する。
 *
 * 例外が外すのは「リンクした側も同じライセンスにせよ」という部分に限られる。
 * 部品そのものを配る以上、その部品のソースを渡す義務は残るので、
 * `source-disclosure` は落とさない。結果として LGPL と同じ形になる。
 */
function applyLinkingException(
  licenseId: string,
  exception: string,
  base: PolicyResult,
): PolicyResult {
  // 伝播義務が無ければ、例外に外すものが無い。dev 依存などがここに入る。
  // 緩和処理が義務を作り出さないよう、そのまま返す
  if (!base.obligations.includes('same-license')) return base;

  // AGPL 13条はネットワーク越しに使わせた時点で発火する。
  // リンクは別の引き金なので、リンクの例外では外れない
  if (categorize(licenseId) === 'network-copyleft') {
    return {
      ...base,
      rationale: `${base.rationale} The ${exception} exception addresses linking. The network-use clause is triggered by making the software available to remote users, which is a separate condition, so it still applies.`,
    };
  }

  const obligations = base.obligations.filter((o) => o !== 'same-license');
  if (!obligations.includes('attribution')) obligations.push('attribution');

  return {
    verdict: 'allowed',
    obligations,
    rationale: `${licenseId} carries the ${exception} exception, which lifts the requirement that a work linking to it be licensed under ${licenseId}. The obligation to provide source for this component itself is unaffected.`,
  };
}

type Node =
  | { license: string; plus?: boolean; exception?: string }
  | { left: Node; conjunction: 'and' | 'or'; right: Node };

function mergeObligations(a: Obligation[], b: Obligation[]): Obligation[] {
  return [...new Set([...a, ...b])];
}

function evalNode(node: Node, ctx: PolicyContext): PolicyResult {
  if ('license' in node) {
    const base = evaluateLicense(node.license, ctx);
    if (node.exception && LINKING_EXCEPTIONS.has(node.exception.toLowerCase())) {
      return applyLinkingException(node.license, node.exception, base);
    }
    return base;
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
    // 式として読めなくても、識別子として分かることがある。
    // spdx-expression-parse は大小文字に厳密だが、Cargo や PyPI の
    // メタデータには小文字表記が実在する。ここで一律 review に積むと、
    // 判定できたはずのものが警告に埋もれて全体が無視される。
    //
    // 分類は既知の識別子に一致するか、より厳しい族へ倒す接頭辞規則にしか
    // 当たらないので、この経路が判定を緩める方向に働くことはない。
    //
    // ただし**単一の識別子に見えるものに限る**。`WITH` や `AND` を含む式が
    // 読めなかった場合にこれを通すと、接頭辞だけを見て残りを無視した答えを
    // 返してしまう（知らない例外が付いた GPL を、例外が無いものとして扱う等）
    if (!/[\s()]/.test(normalized) && categorize(normalized) !== 'unknown') {
      return evaluateLicense(normalized, ctx);
    }
    return {
      verdict: 'review',
      obligations: [],
      rationale: `The license string "${expression}" could not be parsed as an SPDX expression. The original license text needs individual review.`,
    };
  }

  return evalNode(ast, ctx);
}
