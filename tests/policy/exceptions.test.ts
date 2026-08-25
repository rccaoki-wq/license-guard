import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/policy/engine';
import type { PolicyContext } from '../../src/types';

/**
 * SPDX の `WITH` 例外の扱い。
 *
 * ここを独立したファイルにしている理由。例外は「コピーレフトを緩めるもの」で
 * ひとくくりにされやすいが、実際には別々のことを述べている。緩和の対象を
 * 取り違えると、義務が残っているものが `allowed` で返る。誤答の向きが
 * 「安全側に厳しい」ではなく「危険側に緩い」なので、単体で固定しておく。
 */
const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'distributed-binary',
  ...over,
});

describe('リンク例外は伝播だけを解除する', () => {
  it('Classpath 例外つき GPL は、部品自身のソース提供義務を残す', () => {
    // 例外が外すのは「リンクした側も GPL にせよ」の部分。GPL の部品を
    // バイナリで配る以上、その部品のソースを渡す義務は残る。LGPL と同じ形
    const r = evaluateExpression(
      'GPL-2.0-only WITH Classpath-exception-2.0',
      ctx({ linkage: 'static' }),
    );
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toContain('source-disclosure');
    expect(r.obligations).not.toContain('same-license');
  });

  it('GCC / LLVM のランタイム例外も同じ扱いになる', () => {
    for (const e of ['GPL-3.0-only WITH GCC-exception-3.1', 'GPL-3.0-only WITH LLVM-exception']) {
      const r = evaluateExpression(e, ctx({ linkage: 'static' }));
      expect(r.verdict, e).toBe('allowed');
      expect(r.obligations, e).toContain('source-disclosure');
    }
  });

  it('配布しないスコープでは義務を足さない', () => {
    // 例外の有無に関わらず dev 依存は成果物に入らない。
    // 緩和処理が義務を作り出してはいけない
    const r = evaluateExpression('GPL-2.0-only WITH Classpath-exception-2.0', ctx({ scope: 'dev' }));
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toEqual([]);
  });
});

describe('リンクを緩めない例外は緩和しない', () => {
  // autoconf / bison の例外が述べているのは「生成物」を自分の条件で
  // 配ってよいということ。依存として取り込む話とは無関係で、
  // リンクした側のコピーレフトを外す根拠にはならない
  it.each([
    'GPL-3.0-only WITH Autoconf-exception-3.0',
    'GPL-3.0-only WITH Bison-exception-2.2',
    'GPL-3.0-only WITH Font-exception-2.0',
    'GPL-3.0-only WITH Qt-GPL-exception-1.0',
  ])('%s は GPL のまま扱う', (expression) => {
    expect(evaluateExpression(expression, ctx()).verdict).toBe('blocked');
  });

  it('知らない例外は緩和せず review にする', () => {
    const r = evaluateExpression('GPL-3.0-only WITH Totally-Made-Up-exception-9.9', ctx());
    expect(r.verdict).toBe('review');
  });
});

describe('ネットワークコピーレフトはリンク例外では外れない', () => {
  // AGPL 13条はネットワーク越しに使わせた時点で発火する。
  // リンクの例外は別の引き金の話なので、何が付いていても消えない
  it.each([
    'AGPL-3.0-only WITH Classpath-exception-2.0',
    'AGPL-3.0-only WITH GCC-exception-3.1',
    'AGPL-3.0-only WITH LLVM-exception',
    'AGPL-3.0-only WITH Autoconf-exception-3.0',
  ])('%s は allowed にしない', (expression) => {
    const r = evaluateExpression(expression, ctx({ distributionModel: 'saas' }));
    expect(r.verdict).not.toBe('allowed');
  });

  it('SaaS の AGPL は例外の有無で判定が変わらない', () => {
    const bare = evaluateExpression('AGPL-3.0-only', ctx({ distributionModel: 'saas' }));
    const withException = evaluateExpression(
      'AGPL-3.0-only WITH Classpath-exception-2.0',
      ctx({ distributionModel: 'saas' }),
    );
    expect(withException.verdict).toBe(bare.verdict);
    expect(withException.obligations).toEqual(bare.obligations);
  });
});
