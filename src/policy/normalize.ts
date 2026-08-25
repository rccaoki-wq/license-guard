import { categorize } from './categories';

/**
 * SPDX として解釈できない歴史的な表記を SPDX 識別子に寄せる。
 *
 * npm の license フィールドが SPDX 式に統一されたのは 2014 年頃で、
 * それ以前の "MIT/X11" や "BSD" といった表記が今も残っている。
 * これらを未知として扱うと、実際には permissive なパッケージが
 * 「要確認」に積み上がり、警告全体が無視されるようになる。
 *
 * 族の総称（"GPL" のようにバージョンを欠くもの）は、その族に共通する
 * 最も制約の強い性質に倒す。permissive と誤って判定するより、
 * 過剰に慎重な側で誤る方が損害が小さいため。
 */
const LEGACY_ALIASES: Record<string, string> = {
  // 旧 npm のスラッシュ表記
  'mit/x11': 'MIT',
  'mit / x11': 'MIT',
  x11: 'X11',
  'bsd*': 'BSD-3-Clause',

  // バージョンを欠く族の総称
  bsd: 'BSD-3-Clause',
  'new bsd': 'BSD-3-Clause',
  'new bsd license': 'BSD-3-Clause',
  'simplified bsd': 'BSD-2-Clause',
  'bsd license': 'BSD-3-Clause',
  apache: 'Apache-2.0',
  'apache 2': 'Apache-2.0',
  'apache 2.0': 'Apache-2.0',
  'apache license': 'Apache-2.0',
  'apache software license': 'Apache-2.0',
  'asl 2.0': 'Apache-2.0',
  mit: 'MIT',
  'mit license': 'MIT',
  isc: 'ISC',

  // 版・条項数まで書いてあるのに綴りが SPDX と違うもの。
  // **完全一致のみ。** 「〜 License を落とす」のような規則にすると、
  // ライセンス本文がまるごと入っている欄（pandas は BSD 3-Clause の
  // 全文を書いている）から接頭辞だけ拾ってしまう
  'apache license 2.0': 'Apache-2.0',
  'apache 2.0 license': 'Apache-2.0',
  '3-clause bsd license': 'BSD-3-Clause',
  '2-clause bsd license': 'BSD-2-Clause',
  'isc license': 'ISC',
  gpl: 'GPL-3.0-only',
  'gpl-2': 'GPL-2.0-only',
  'gpl-3': 'GPL-3.0-only',
  lgpl: 'LGPL-3.0-only',
  agpl: 'AGPL-3.0-only',
  mpl: 'MPL-2.0',
  epl: 'EPL-2.0',
  zlib: 'Zlib',

  // パブリックドメイン表明
  //
  // **"unlicensed" をここに入れないこと。** npm の `"license": "UNLICENSED"` は
  // 「ライセンスを与えない」という宣言であり、パブリックドメインへ放棄する
  // `Unlicense` とは正反対の意味になる。以前ここで CC0-1.0 に寄せていたため、
  // 非公開パッケージが「条件なしで利用可」と返っていた。
  // 分類は categories.ts の EXACT で 'none' に落とす
  'public domain': 'CC0-1.0',
  'public-domain': 'CC0-1.0',
  cc0: 'CC0-1.0',
  wtfpl: 'WTFPL',
};

/**
 * 版や条項数を欠く総称。厳しい側に倒すのは方針として妥当だが、
 * **倒したことを黙ってはいけない。**
 *
 * psycopg2-binary は `LGPL` としか宣言していないのに、ページには
 * 「LGPL-3.0-only requires ...」と書かれていた。宣言に無い版を、
 * 宣言されたかのように書いている。LGPL-2.1 と 3.0 は条件が違うので、
 * 読んだ人はどちらを確かめればいいのか分からないまま確信だけ持つ。
 *
 * 判定は変えない（厳しい側のままでよい）。**補ったことを言う**だけ。
 */
const FAMILY_ASSUMPTIONS: ReadonlySet<string> = new Set([
  'bsd',
  'bsd*',
  'bsd license',
  'new bsd',
  'new bsd license',
  'simplified bsd',
  'apache',
  'apache license',
  'apache software license',
  'gpl',
  'lgpl',
  'agpl',
  'mpl',
  'epl',
]);

/**
 * 総称から版を補った場合に、その事実を返す。補っていなければ null。
 * 判定文に添えるためだけに使う。
 */
export function assumedFromFamily(raw: string): { declared: string; assumed: string } | null {
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase();
  if (!FAMILY_ASSUMPTIONS.has(key)) return null;
  const assumed = LEGACY_ALIASES[key];
  if (assumed === undefined || assumed === trimmed) return null;
  return { declared: trimmed, assumed };
}

/**
 * 式の中の各要素の**綴りだけ**を SPDX に寄せる。
 *
 * uritemplate は `"BSD 3-Clause OR Apache-2.0"` と宣言している。式としては
 * 正しく、要素の綴りがハイフンでなく空白なだけ。ところが
 * `normalizeLicenseString` は式を見つけると丸ごと素通しするので、
 * **単体なら直せる綴りが、式の中に入った途端に直らなくなり**、
 * 式全体が読めないものとして捨てられていた。
 *
 * **版を補う正規化はここでは採らない。** `GPL` → `GPL-3.0-only` は
 * 綴りの修正ではなく、宣言に無い版を名乗る主張になる。単体なら
 * 「補った」と欄で開示できるが、式の中には開示する場所が無い。
 * 族の総称はそのまま残し、読めなかったものとして扱わせる。
 *
 * `WITH` の右側は例外 ID なので触らない（既知の識別子に一致しない限り
 * `normalizeLicenseString` は文字列を変えないため、自然にそうなる）。
 */
export function normalizeExpressionOperands(raw: string): string {
  return raw
    .split(/(\s+(?:AND|OR|WITH)\s+|[()])/i)
    .map((part) => {
      const operand = part.trim();
      if (operand === '' || operand === '(' || operand === ')') return part;
      if (/^(AND|OR|WITH)$/i.test(operand)) return part;

      // 版を欠く総称は綴りの問題ではない。ここで版を決めない
      if (assumedFromFamily(operand) !== null) return part;

      const normalized = normalizeLicenseString(operand);
      return normalized === operand ? part : part.replace(operand, normalized);
    })
    .join('');
}

/**
 * 単一のライセンス表記を正規化する。
 * SPDX 式（OR / AND / WITH を含むもの）はパーサに任せるため触らない。
 * 未知の文字列はそのまま返す。勝手に決めつけない。
 */
export function normalizeLicenseString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return trimmed;

  // 式として書かれているものは分解せずパーサへ渡す
  if (/[()]|\s(OR|AND|WITH)\s/i.test(trimmed)) return trimmed;

  const alias = LEGACY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  // Cargo は SPDX 式を採用する前、"/" を OR の意味で使っていた
  // （"MIT/Apache-2.0"）。両側が既知の識別子のときだけ OR として解釈する。
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/').map((x) => x.trim());
    if (parts.length >= 2 && parts.every((x) => x !== '' && categorize(x) !== 'unknown')) {
      return `(${parts.join(' OR ')})`;
    }
  }

  // "BSD 2-Clause" のようにハイフンを空白で書いたもの。区切りを揃えた結果が
  // 既知の識別子になる場合のみ採用し、そうでなければ元の文字列を保つ。
  const hyphenated = trimmed.replace(/\s+/g, '-');
  if (hyphenated !== trimmed && categorize(hyphenated) !== 'unknown') {
    return hyphenated;
  }

  return trimmed;
}
