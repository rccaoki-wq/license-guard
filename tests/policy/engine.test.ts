import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/policy/engine';
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
