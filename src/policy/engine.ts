import parse from 'spdx-expression-parse';
import { evaluateLicense } from './rules';
import { categorize } from './categories';
import {
  assumedFromFamily,
  normalizeExpressionOperands,
  normalizeLicenseString,
} from './normalize';
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

/**
 * 読めなかった要素を式の中に残しておくための印。
 *
 * 落とさずに置き換えるのが要点。**取り除いてしまうと、読めた部分だけで
 * 出した答えが「式全体の答え」として返る。** `LicenseRef-` はパーサが
 * 識別子として受け取るので、この印のまま通常の評価に載せられる。
 * 分類は unknown → review になり、AND では義務が合算され、
 * OR では（下の分岐で）選ばれない。
 */
const UNREADABLE = 'LicenseRef-lg-unreadable';

function isUnreadableMarker(licenseId: string): boolean {
  return licenseId.toLowerCase() === UNREADABLE.toLowerCase();
}

function mergeObligations(a: Obligation[], b: Obligation[]): Obligation[] {
  return [...new Set([...a, ...b])];
}

/** 評価結果に、OR の比較で使うライセンス自体の強さを添えたもの */
interface Ranked {
  result: PolicyResult;
  /** 文脈に依らない強さ。AND は強い方、OR は選んだ方を引き継ぐ */
  rank: number;
  /** 読めなかった要素を含むか。OR で「選べない選択肢」を選ばないために使う */
  unreadable: boolean;
}

function evalNode(node: Node, ctx: PolicyContext): Ranked {
  if ('license' in node) {
    const unreadable = isUnreadableMarker(node.license);
    const base = evaluateLicense(node.license, ctx);
    const rank = CATEGORY_RANK[categorize(node.license)];
    if (node.exception && LINKING_EXCEPTIONS.has(node.exception.toLowerCase())) {
      return {
        result: applyLinkingException(node.license, node.exception, base),
        rank,
        unreadable,
      };
    }
    return { result: base, rank, unreadable };
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
    /**
     * **読めなかった選択肢は選ばない。** 読めないものは review・義務ゼロ
     * として評価されるため、判定の軽さだけで比べると
     * `AGPL-3.0 OR NOASSERTION` で「読めない方」が最も緩い選択肢に
     * なってしまう。選べない選択肢を選んだことにするのは過小警告。
     */
    const chosen =
      left.unreadable !== right.unreadable
        ? (left.unreadable ? right : left)
        : compareForChoice(left, right) <= 0
          ? left
          : right;
    return {
      result: {
        verdict: chosen.result.verdict,
        obligations: chosen.result.obligations,
        rationale: `This package offers a choice of licenses. The least restrictive option is shown. ${chosen.result.rationale}`,
      },
      rank: chosen.rank,
      unreadable: chosen.unreadable,
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
    unreadable: left.unreadable || right.unreadable,
  };
}

/**
 * 式として読めなかったものを、読めた要素と読めなかった要素に分ける。
 *
 * 演算子を含む式が `parse()` に落ちたとき、以前は**式ごと捨てて
 * review・義務ゼロ**を返していた。読める側が緩ければ過剰警告になり、
 * 読める側が厳しければ過小警告になる。mattermost-server の
 * `AGPL-3.0 AND ... AND NOASSERTION` は、NOASSERTION が読めないという
 * 理由だけで **AGPL に一言も触れない答え**を返していた。
 *
 * 救済できないときは null を返す（呼び出し側で従来どおり review）。
 */
function salvageUnreadableOperands(
  normalized: string,
): { expression: string; unreadable: string[] } | null {
  /**
   * **`WITH` を含む式は救済しない。**
   *
   * WITH の右側は例外 ID であってライセンスではない。ここを「読めない要素」
   * として印に置き換えると、知らない例外が付いた GPL を、例外の効果を
   * 判断したかのような形で返しかねない。式ごと review に落とす。
   */
  if (/\sWITH\s/i.test(normalized)) return null;

  const parts = normalized.split(/(\s+(?:AND|OR)\s+|[()])/i);
  const unreadable: string[] = [];
  let readable = 0;

  const rebuilt = parts
    .map((part) => {
      const operand = part.trim();
      if (operand === '' || operand === '(' || operand === ')') return part;
      if (/^(AND|OR)$/i.test(operand)) return part;

      if (canParse(operand)) {
        readable += 1;
        return part;
      }
      unreadable.push(operand);
      return part.replace(operand, UNREADABLE);
    })
    .join('');

  // 読めた要素が無いなら救済する材料が無い。読めない要素が無いのに
  // 全体が落ちたのは構造の問題なので、こちらも触らない
  if (readable === 0 || unreadable.length === 0) return null;
  return { expression: rebuilt, unreadable };
}

function canParse(expression: string): boolean {
  try {
    parse(expression);
    return true;
  } catch {
    return false;
  }
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

    /**
     * 式の形は正しいのに、要素の綴りだけが SPDX と違うことがある
     * （`"BSD 3-Clause OR Apache-2.0"`）。`normalizeLicenseString` は
     * 式を見つけると丸ごと素通しするので、**単体なら直せる綴りが
     * 式の中では直らない。** 要素ごとに寄せ直してからもう一度読む。
     * 版の補完はしないので、判定が緩む方向には働かない。
     */
    const spelled = normalizeExpressionOperands(normalized);
    if (spelled !== normalized) {
      try {
        return withNote(evalNode(parse(spelled) as Node, ctx).result);
      } catch {
        // 綴りを寄せてもなお読めない。下の救済に回す
      }
    }

    /**
     * 演算子を含む式でも、読めた要素の答えは残す。
     * 読めなかった要素は取り除かず印に置き換えたまま評価するので、
     * AND では義務が合算され、OR では選ばれない。
     * **落とした事実は必ず文章で述べる。**
     */
    const salvaged = salvageUnreadableOperands(spelled);
    if (salvaged !== null) {
      try {
        const result = evalNode(parse(salvaged.expression) as Node, ctx).result;
        const names = salvaged.unreadable.map((u) => `"${u}"`).join(', ');
        return withNote({
          ...result,
          rationale: `${result.rationale} Part of the declared expression could not be read as SPDX (${names}), so it is not reflected above; that part still needs individual review.`,
        });
      } catch {
        // 印を入れてもなお読めないなら、従来どおり式全体を review に落とす
      }
    }

    return {
      verdict: 'review',
      obligations: [],
      rationale: `The license string "${expression}" could not be parsed as an SPDX expression. The original license text needs individual review.`,
    };
  }

  return withNote(evalNode(ast, ctx).result);
}
