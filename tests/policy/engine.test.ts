import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/policy/engine';
import { verdictMatrix } from '../../src/policy/matrix';
import type { PolicyContext } from '../../src/types';

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'saas',
  ...over,
});

describe('evaluateExpression', () => {
  it('単一ライセンスをそのまま判定する', () => {
    expect(evaluateExpression('MIT', ctx()).verdict).toBe('allowed');
  });

  it('OR は最も緩い判定を採る', () => {
    expect(
      evaluateExpression('(MIT OR GPL-3.0-only)', ctx({ distributionModel: 'distributed-binary' }))
        .verdict,
    ).toBe('allowed');
  });

  it('AND は最も厳しい判定を採る', () => {
    expect(evaluateExpression('(MIT AND AGPL-3.0-only)', ctx()).verdict).toBe('blocked');
  });

  it('AND の義務は合算される', () => {
    const r = evaluateExpression('(MIT AND Apache-2.0)', ctx());
    expect(r.obligations).toContain('attribution');
    expect(r.obligations).toContain('notice-file');
  });

  it('GPL-2.0+ のような plus 記法を扱える', () => {
    expect(
      evaluateExpression('GPL-2.0+', ctx({ distributionModel: 'distributed-binary' })).verdict,
    ).toBe('blocked');
  });

  it('Classpath 例外つき GPL は静的リンクでも blocked にしない', () => {
    const r = evaluateExpression(
      'GPL-2.0-only WITH Classpath-exception-2.0',
      ctx({ distributionModel: 'distributed-binary', linkage: 'static' }),
    );
    expect(r.verdict).not.toBe('blocked');
  });

  it('パース不能な式は review にする', () => {
    const r = evaluateExpression('!!! not an spdx expression !!!', ctx());
    expect(r.verdict).toBe('review');
  });

  it('null は blocked（ライセンス不明＝全権利留保）', () => {
    const r = evaluateExpression(null, ctx());
    expect(r.verdict).toBe('blocked');
  });
});

describe('版を欠く総称は、補ったことを言う', () => {
  it('LGPL は判定を変えずに、補ったことを構造化して返す', () => {
    const bare = evaluateExpression('LGPL', ctx({ distributionModel: 'distributed-binary' }));
    const explicit = evaluateExpression(
      'LGPL-3.0-only',
      ctx({ distributionModel: 'distributed-binary' }),
    );

    // 判定・義務・説明はそのまま。足すのは「補った」という事実だけ
    expect(bare.verdict).toBe(explicit.verdict);
    expect(bare.obligations).toEqual(explicit.obligations);
    expect(bare.rationale).toBe(explicit.rationale);

    expect(bare.assumption).toEqual({ declared: 'LGPL', assumed: 'LGPL-3.0-only' });
  });

  it('GPL / AGPL / BSD / Apache / MPL / EPL も同じ扱い', () => {
    for (const [declared, assumed] of [
      ['GPL', 'GPL-3.0-only'],
      ['AGPL', 'AGPL-3.0-only'],
      ['BSD', 'BSD-3-Clause'],
      ['Apache', 'Apache-2.0'],
      ['MPL', 'MPL-2.0'],
      ['EPL', 'EPL-2.0'],
    ] as const) {
      const r = evaluateExpression(declared, ctx({ distributionModel: 'distributed-binary' }));
      expect(r.assumption).toEqual({ declared, assumed });
    }
  });

  it('版まで宣言されているものには何も足さない', () => {
    for (const declared of ['MIT', 'Apache-2.0', 'GPL-3.0-only', 'BSD-3-Clause', 'LGPL-2.1-only']) {
      const r = evaluateExpression(declared, ctx({ distributionModel: 'distributed-binary' }));
      expect(r.assumption).toBeUndefined();
    }
  });

  it('大小文字が違っても拾う（PyPI は "bsd" と書く）', () => {
    expect(evaluateExpression('bsd', ctx()).assumption).toEqual({
      declared: 'bsd',
      assumed: 'BSD-3-Clause',
    });
  });

  it('表は全行に同じ断りを載せる（1 行だけ見て描いても落ちない）', () => {
    const rows = verdictMatrix('LGPL', 'runtime', 'dynamic');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.assumption).toEqual({ declared: 'LGPL', assumed: 'LGPL-3.0-only' });
    }
    // 表の Why に定型文を 5 回並べない
    for (const row of rows) {
      expect(row.rationale).not.toContain('does not name a specific version');
    }
  });
});
