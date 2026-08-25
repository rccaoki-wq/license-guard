import parse from 'spdx-expression-parse';
import { evaluateLicense } from './rules';
import { categorize } from './categories';
import { assumedFromFamily, normalizeLicenseString } from './normalize';
import type { LicenseCategory, Obligation, PolicyContext, PolicyResult, Verdict } from '../types';

const SEVERITY: Record<Verdict, number> = {
  allowed: 0,
  review: 1,
  blocked: 2,
};

/**
 * ライセンスそのものの強さ。**文脈に依らない。**
 *
 * OR の選択で、判定が並んだときの比較に使う。判定（`SEVERITY`）は
 * 配布形態ごとに動くので、それだけで選ぶと**行ごとに違うライセンスを
 * 選んでしまう**。`GPL-3.0-only OR MIT` は saas と internal-only では
 * GPL（その用途では義務が発火しないので義務ゼロ）、distributed-binary
 * では MIT が選ばれていた。行ごとには正しいが、**どの単一の選択でも
 * 再現できない表**になる。読み手は 1 つを選んで全用途で使う。
 */
const CATEGORY_RANK: Record<LicenseCategory, number> = {
  'public-domain': 0,
  permissive: 1,
  'file-copyleft': 2,
  'library-copyleft': 3,
  'strong-copyleft': 4,
  'network-copyleft': 5,
  'source-available': 6,
  'no-derivatives': 7,
  'non-commercial': 8,
  none: 9,
  // 読めなかったものは最後。読めた選択肢があるならそちらを採る
  unknown: 10,
};

/**
 * 同じ強さの中での手間の比較。
 *
 * **`patent-grant` は数えない。** これは利用者が負う義務ではなく、
 * 寄稿者から利用者への特許許諾＝受け取る側の利得で、
 * 情報として義務欄に並べているだけ（rules.ts の Apache-2.0 の項）。
 * 手間として数えると、実際には軽い方を重いと判断してしまう。
 */
function burden(obligations: Obligation[]): number {
  return obligations.filter((o) => o !== 'patent-grant').length;
}

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

/** 評価結果に、OR の比較で使うライセンス自体の強さを添えたもの */
interface Ranked {
  result: PolicyResult;
  /** 文脈に依らない強さ。AND は強い方、OR は選んだ方を引き継ぐ */
  rank: number;
}

function evalNode(node: Node, ctx: PolicyContext): Ranked {
  if ('license' in node) {
    const base = evaluateLicense(node.license, ctx);
    const rank = CATEGORY_RANK[categorize(node.license)];
    if (node.exception && LINKING_EXCEPTIONS.has(node.exception.toLowerCase())) {
      return { result: applyLinkingException(node.license, node.exception, base), rank };
    }
    return { result: base, rank };
  }

  const left = evalNode(node.left, ctx);
  const right = evalNode(node.right, ctx);

  if (node.conjunction === 'or') {
    /**
     * 利用者がいずれかを選択できるため、緩い方を採る。
     *
     * **判定が並んだときに宣言順で決めてはいけない。** 以前は左が残って
     * いたので、`Apache-2.0 OR MIT`（上位 300 クレート中 23 件。
     * `MIT OR Apache-2.0` と同じ意味）で、MIT を選べば要らない
     * `notice-file` と `patent-grant` を「least restrictive option」と
     * 称して出していた。書き方が違うだけの同じライセンスに、
     * 違う答えを返していたことになる。
     *
     * 判定は今も第一基準（緩い側が blocked なら選ばない）。並んだときだけ、
     * ライセンス自体の強さ → 手間の順で比べる。どちらも文脈に依らないので、
     * 配布形態が変わっても**同じライセンスが選ばれる**。
     */
    const chosen =
      compareForChoice(left, right) <= 0
        ? left
        : right;
    return {
      result: {
        verdict: chosen.result.verdict,
        obligations: chosen.result.obligations,
        rationale: `This package offers a choice of licenses. The least restrictive option is shown. ${chosen.result.rationale}`,
      },
      rank: chosen.rank,
    };
  }

  // AND: 全てが適用されるため、厳しい方を採り義務を合算する
  const stricter =
    SEVERITY[left.result.verdict] >= SEVERITY[right.result.verdict] ? left : right;
  return {
    result: {
      verdict: stricter.result.verdict,
      obligations: mergeObligations(left.result.obligations, right.result.obligations),
      rationale: `Multiple licenses apply at once. ${left.result.rationale} / ${right.result.rationale}`,
    },
    rank: Math.max(left.rank, right.rank),
  };
}

/** 負なら左、正なら右。0 なら宣言順（左）のまま */
function compareForChoice(left: Ranked, right: Ranked): number {
  const byVerdict = SEVERITY[left.result.verdict] - SEVERITY[right.result.verdict];
  if (byVerdict !== 0) return byVerdict;

  const byRank = left.rank - right.rank;
  if (byRank !== 0) return byRank;

  return burden(left.result.obligations) - burden(right.result.obligations);
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

  /**
   * 総称に版を補ったなら、それを判定文の先頭で言う。
   *
   * 補った版を宣言されたかのように書くと、**宣言に無い事実を断言する**
   * ことになる。psycopg2-binary は `LGPL` としか宣言していないのに、
   * ページには「LGPL-3.0-only requires ...」と出ていた。LGPL-2.1 と 3.0 は
   * 条件が違うので、読んだ人はどちらを確かめればいいのか分からないまま
   * 確信だけ持って帰る。
   *
   * **判定は変えない。** 厳しい側に倒すのは方針として妥当。
   * 補ったという事実だけを渡す。
   *
   * 文章に前置きすると、5 つの配布形態すべてに同じ一文が付く。
   * 5 回並んだ定型文は読み飛ばされるので、**構造化して 1 つの欄に持つ**。
   * 表示側が 1 度だけ出し、API は文字列を解析せずに受け取れる。
   */
  const assumed = assumedFromFamily(expression);
  const withNote = (r: PolicyResult): PolicyResult =>
    assumed === null ? r : { ...r, assumption: assumed };

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
      return withNote(evaluateLicense(normalized, ctx));
    }
    return {
      verdict: 'review',
      obligations: [],
      rationale: `The license string "${expression}" could not be parsed as an SPDX expression. The original license text needs individual review.`,
    };
  }

  return withNote(evalNode(ast, ctx).result);
}
