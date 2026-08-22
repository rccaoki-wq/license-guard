/**
 * Phase 0 の判断ロジック。
 *
 * この道具は「作り続けるか、買い手仮説を捨てるか」を決める唯一の根拠なのに、
 * 一度もテストが無く、実際に 2 回、**例外も出さずに間違った断定**を返した。
 * ここに書いてあるのは主に、その 2 件と同じ形の誤りが戻らないことの確認。
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_SAMPLE,
  classifySessions,
  diagnoseWeb,
  isProbe,
  nameLooksLikeProbe,
  phaseVerdict,
  // @ts-expect-error -- 判断ロジックは素の .mjs（レポート script と共有）
} from '../scripts/verdict.mjs';

type Session = { client: string | null; calls: number; ok: number };

describe('実利用かどうかの判別', () => {
  it('適合性テストを実利用に数えない（実際に誤報した形）', () => {
    // sasame-audit: 各ツールを引数なしと "test" で 2 回ずつ、同一秒に 6 回。
    // 5 回失敗し 1 回だけ偶然成功した。ok > 0 だけで見ると通ってしまう
    expect(isProbe({ client: 'sasame-audit', calls: 6, ok: 1 })).toBe(true);
  });

  it('成功が過半数に届かなければ試用とみなす', () => {
    expect(isProbe({ client: 'unknown-client', calls: 10, ok: 4 })).toBe(true);
    expect(isProbe({ client: 'unknown-client', calls: 10, ok: 5 })).toBe(true); // 半々も通さない
    expect(isProbe({ client: 'unknown-client', calls: 10, ok: 6 })).toBe(false);
  });

  it('接続だけして帰った相手は利用者ではない', () => {
    expect(isProbe({ client: 'some-new-thing', calls: 0, ok: 0 })).toBe(true);
  });

  it('名乗らない相手は需要に数えない', () => {
    expect(nameLooksLikeProbe(null)).toBe(true);
    expect(nameLooksLikeProbe('')).toBe(true);
    expect(isProbe({ client: null, calls: 5, ok: 5 })).toBe(true);
  });

  it('既知の巡回・採点サービスを弾く', () => {
    for (const n of ['glama-crawler', 'smithery-check', 'mcp-registry-probe', 'health-monitor']) {
      expect(nameLooksLikeProbe(n), n).toBe(true);
    }
  });

  it('素直に使った相手は実利用に残る', () => {
    expect(isProbe({ client: 'claude-ai', calls: 3, ok: 3 })).toBe(false);
  });
});

describe('内訳', () => {
  const sessions: Session[] = [
    { client: 'glama-crawler', calls: 0, ok: 0 },
    { client: 'quiet-one', calls: 0, ok: 0 },
    { client: 'sasame-audit', calls: 6, ok: 1 },
    { client: 'claude-ai', calls: 4, ok: 4 },
  ];

  it('4 つに分ける', () => {
    const c = classifySessions(sessions);
    expect(c.real.map((s: Session) => s.client)).toEqual(['claude-ai']);
    expect(c.namedProbes).toHaveLength(1);
    expect(c.silent.map((s: Session) => s.client)).toEqual(['quiet-one']);
    expect(c.errored.map((s: Session) => s.client)).toEqual(['sasame-audit']);
  });

  it('除外した相手は必ずどこかに現れる', () => {
    // 内訳に出さずに落とすと、誤分類に気づく手段が無くなる
    const c = classifySessions(sessions);
    const shown = new Set(
      [...c.real, ...c.namedProbes, ...c.silent, ...c.errored].map((s: Session) => s.client),
    );
    for (const s of sessions) expect(shown.has(s.client), s.client ?? 'null').toBe(true);
  });
});

describe('Web の入口診断', () => {
  it('人間 1 件で「入口の問題」と断定しない（実際に誤報した形）', () => {
    const v = diagnoseWeb({ humans: 1, humanScanned: 0, landed: 10 });
    expect(v.code).toBe('too-few');
    expect(v.message).toMatch(/入口の問題とは言えない/);
  });

  it('標本が足りないことを黙らずに数字で言う', () => {
    const v = diagnoseWeb({ humans: 1, humanScanned: 0, landed: 10 });
    expect(v.message).toContain('1');
    expect(v.message).toContain(String(MIN_SAMPLE));
  });

  it('MIN_SAMPLE 未満は一律で断定しない', () => {
    for (const humans of [1, 5, 15, MIN_SAMPLE - 1]) {
      expect(diagnoseWeb({ humans, humanScanned: 0, landed: humans }).code, `humans=${humans}`).toBe(
        'too-few',
      );
    }
  });

  it('MIN_SAMPLE に達して 0 件なら入口の問題', () => {
    expect(diagnoseWeb({ humans: MIN_SAMPLE, humanScanned: 0, landed: 99 }).code).toBe('entrance');
  });

  it('通過していれば人間どうしで突き合わせる', () => {
    // 以前は分母だけ種別で絞り分子は全種別だったので、
    // 「人間 1 件のうち 2 件が通過」という数字が出うる形になっていた
    const v = diagnoseWeb({ humans: 40, humanScanned: 3, landed: 120 });
    expect(v.code).toBe('converting');
    expect(v.message).toContain('40');
    expect(v.message).toContain('3');
  });

  it('ボットだけの到達を人間の到達として扱わない', () => {
    expect(diagnoseWeb({ humans: 0, humanScanned: 0, landed: 500 }).code).toBe('bots-only');
  });

  it('到達 0 は流入の段階', () => {
    expect(diagnoseWeb({ humans: 0, humanScanned: 0, landed: 0 }).code).toBe('no-traffic');
  });

  it('引数なしでも壊れない', () => {
    expect(diagnoseWeb().code).toBe('no-traffic');
  });
});

describe('Phase 0 の go / no-go', () => {
  it('標本不足では判断しない', () => {
    expect(phaseVerdict({ scanned: 0, realCount: 0, emailed: 0 }).code).toBe('insufficient');
    expect(phaseVerdict({ scanned: 29, realCount: 29, emailed: 0 }).code).toBe('insufficient');
  });

  it('分母 0 を「率 0%」として仮説否定に使わない', () => {
    // 判定完了が 0 件なのに MCP 側が 30 を超えただけで
    // 「買い手仮説を捨てろ」という最も重い結論が出ていた
    const v = phaseVerdict({ scanned: 0, realCount: 50, emailed: 0 });
    expect(v.code).toBe('no-denominator');
    expect(v.code).not.toBe('pivot');
  });

  it('分母があって分子が 0 のときだけ仮説を疑う', () => {
    expect(phaseVerdict({ scanned: 40, realCount: 0, emailed: 0 }).code).toBe('pivot');
  });

  it('率で段階を分ける', () => {
    expect(phaseVerdict({ scanned: 100, realCount: 0, emailed: 5 }).code).toBe('phase1');
    expect(phaseVerdict({ scanned: 100, realCount: 0, emailed: 1 }).code).toBe('retune');
    expect(phaseVerdict({ scanned: 100, realCount: 0, emailed: 0 }).code).toBe('pivot');
  });

  it('引数なしでも壊れない', () => {
    expect(phaseVerdict().code).toBe('insufficient');
  });
});

describe('証拠の基準はレポート全体で 1 つ', () => {
  it('Web 診断と Phase 0 判定が同じ閾値を使う', () => {
    // 以前は Web が 1 件で断定し、同じ紙の Phase 0 は
    // 「30 件に満たないので判断できません」と言っていた。
    // 同じレポートに基準が 2 つあると、声の大きい行に従ってしまう
    const n = MIN_SAMPLE - 1;
    expect(diagnoseWeb({ humans: n, humanScanned: 0, landed: n }).code).toBe('too-few');
    expect(phaseVerdict({ scanned: n, realCount: n, emailed: 0 }).code).toBe('insufficient');
  });
});
