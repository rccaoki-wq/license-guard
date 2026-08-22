/**
 * Phase 0 の判断ロジック。**表示と入出力から切り離してある。**
 *
 * ここを分けた理由。この判断は今のところ「作り続けるか、買い手仮説を
 * 捨てるか」を決める唯一の道具なのに、レポート本体に直書きされていて
 * 一度もテストされていなかった。そして実際に 2 回、誤った断定を出した。
 *
 *   1. 適合性テスト（同一秒に 6 回叩いて 5 回失敗）を「初の実利用」と数えた
 *   2. 人間の到達 1 件・判定 0 件で「入口の問題」と断定した
 *
 * どちらも動作は正常で、例外も出ない。**間違った答えを自信を持って返す**
 * のが失敗の形なので、テストでしか捕まらない。
 */

/**
 * 断定に必要な最小標本。
 *
 * **レポートの両側でこの 1 個を使う。** 以前は Web の診断が「1 件」で
 * 断定する一方、同じレポートの Phase 0 判定は「30 件に満たないので
 * 判断できません」と言っていた。同じ紙の上で証拠の基準が 2 つあると、
 * 声の大きいほうの行に従ってしまう。
 *
 * 30 の根拠。「到達しているのに 0 件しか進まない」が異常だと言うには、
 * 0 が偶然では説明できない必要がある。仮に本当の通過率が 10% でも、
 * 10 件中 0 件は 35% の確率で起きる（0.9^10）。30 件中 0 件なら 4%。
 * つまり 10 件では何も言えず、30 件でようやく「0」が意味を持ちはじめる。
 */
export const MIN_SAMPLE = 30;

/**
 * 巡回ボット・採点サービスの判別。
 *
 * 完全な名簿は作れない（毎日新しいものが現れる）ので、名前の癖で拾う。
 * 取りこぼしたものは「実利用」に混ざるため、判定は**厳しめに倒す**。
 * 実需要を過大評価するより過小評価するほうが、判断を誤りにくい。
 */
export const PROBE_PATTERNS = [
  /probe/i, /crawler/i, /\bbot\b/i, /scanner/i, /scan\b/i, /registry/i,
  /grader/i, /grade/i, /census/i, /inspector/i, /monitor/i, /catalog/i,
  /index/i, /observatory/i, /health/i, /verify/i, /spike/i, /benchmark/i,
  /marketplace/i, /directory/i, /search/i, /glama/i, /lobehub/i, /e2e/i, /test/i,
  /beat/i, /connect/i, /\bcomp\b/i, /extractor/i, /smithery/i, /check/i,
];

/** 名前が無い相手も巡回側に倒す。名乗らないものを需要に数えない */
export const nameLooksLikeProbe = (name) =>
  !name || PROBE_PATTERNS.some((re) => re.test(name));

/**
 * **接続しただけの相手は利用者ではない。**
 *
 * 名前で弾く方式だけでは追いつかない。初日に来たクライアント名は 33 種、
 * 翌日にはさらに増え、毎回新しい名前が現れる。名簿の保守はいずれ破綻する。
 *
 * ふるまいで見れば名前に依存しない。initialize だけしてツールを一度も
 * 呼ばずに去るのは、名前が何であれ生存確認か棚卸しであって、需要ではない。
 *
 * **「呼んだ」だけでは足りない。** 実際に来た `sasame-audit` は、各ツールを
 * 引数なしと `"test"` で 2 回ずつ、同一秒に 6 回叩いて 5 回失敗させて去った。
 * 当初 calls > 0 で実利用に数え、「初の実利用」と誤って報告しかけた。
 * ok > 0 に直してもまだ通った（6 回中 1 回は偶然成功していた）。
 * **成功が過半数に届かないなら、使っているのではなく試している。**
 *
 * 半々（`ok * 2 === calls`）も通さない。半分失敗する相手を「使えている」と
 * 数えるのは、実需要を過小評価する側に倒すという方針と合わない。本物の
 * 利用者はここで落ちても、日をまたいだ再訪（継続）のほうで見分けがつく。
 *
 * 経験則であって証明ではない。取りこぼす可能性はあるが、方向は
 * 「実需要を過小評価する」側に倒してある。
 */
export const isProbe = (s) =>
  nameLooksLikeProbe(s.client) || s.ok === 0 || s.ok * 2 <= s.calls;

/** セッション一覧を 4 つに分ける。内訳を出さないと誤分類に気づけない */
export function classifySessions(sessions) {
  const named = (s) => nameLooksLikeProbe(s.client);
  return {
    real: sessions.filter((s) => !isProbe(s)),
    namedProbes: sessions.filter(named),
    silent: sessions.filter((s) => !named(s) && s.calls === 0),
    errored: sessions.filter((s) => !named(s) && s.calls > 0 && isProbe(s)),
  };
}

/**
 * Web の入口を診断する。
 *
 * **人間の到達と、人間による判定完了を突き合わせる。** 以前は分母だけ
 * 種別で絞り、分子は全種別のままだったので「人間 1 件のうち 2 件が通過」
 * のような数字が出うる形になっていた。
 *
 * 断定するのは `MIN_SAMPLE` に達してからだけ。それ未満は「まだ言えない」
 * と明示する。黙るのではなく、言えない理由を数字で見せる。
 */
export function diagnoseWeb({ humans = 0, humanScanned = 0, landed = 0 } = {}) {
  if (humanScanned > 0) {
    return {
      code: 'converting',
      message: `人間の到達 ${humans} 件のうち ${humanScanned} 件が判定まで到達。`,
    };
  }
  if (humans >= MIN_SAMPLE) {
    return {
      code: 'entrance',
      message: `人間が ${humans} 件到達して判定は 0 件。偶然では説明できない。入口の問題。`,
    };
  }
  if (humans > 0) {
    return {
      code: 'too-few',
      message: `人間の到達 ${humans} 件、判定 0 件。${MIN_SAMPLE} 件に満たないので入口の問題とは言えない。`,
    };
  }
  if (landed > 0) {
    return {
      code: 'bots-only',
      message: '到達はあるが、人間とみなせるものは 0。まだ流入の段階。',
    };
  }
  return {
    code: 'no-traffic',
    message: '到達が 0。入口を直しても意味がない。流入を作る段階。',
  };
}

/**
 * Phase 0 の go / no-go。
 *
 * **興味表明率は判定完了を分母に取る。** 判定が 0 件のときに率を 0% と
 * みなすと、「MCP 側のセッションが 30 を超えた」だけで「買い手仮説を
 * 捨てろ」という最も重い結論が出てしまう。分母が無いことと、分母が
 * あって分子が 0 であることは別の事実で、後者だけが仮説を否定する。
 */
export function phaseVerdict({ scanned = 0, realCount = 0, emailed = 0 } = {}) {
  if (scanned < MIN_SAMPLE && realCount < MIN_SAMPLE) {
    return {
      code: 'insufficient',
      message: [
        '判断できません。標本が足りません。',
        `判定完了セッションかツール利用セッションが ${MIN_SAMPLE} を超えるまでは、`,
        '比率を読んでも偶然と区別できません。',
      ],
    };
  }
  if (scanned === 0) {
    return {
      code: 'no-denominator',
      message: [
        `ツール利用は ${realCount} 件あるが、Web の判定完了が 0 件。`,
        '興味表明率は分母が無いので計算できない。',
        '→ MCP 側の利用者を Web の判定まで運ぶ経路を先に作る。',
      ],
    };
  }
  const rate = (emailed / scanned) * 100;
  if (rate >= 5) {
    return { code: 'phase1', message: [`興味表明率 ${rate.toFixed(1)}%`, '→ Phase 1（GitHub App）に進む水準'] };
  }
  if (rate >= 1) {
    return { code: 'retune', message: [`興味表明率 ${rate.toFixed(1)}%`, '→ 訴求文と価格を作り直して再測定'] };
  }
  return { code: 'pivot', message: [`興味表明率 ${rate.toFixed(1)}%`, '→ 買い手仮説の切り替えを検討する'] };
}
