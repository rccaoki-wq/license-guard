import { describe, expect, it } from 'vitest';
import { evaluateLicense } from '../../src/policy/rules';
import type { PolicyContext } from '../../src/types';

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'saas',
  ...over,
});

describe('evaluateLicense', () => {
  it('MIT は常に allowed で表示義務のみ', () => {
    const r = evaluateLicense('MIT', ctx());
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toEqual(['attribution']);
  });

  it('Apache-2.0 は NOTICE と特許条項の義務を持つ', () => {
    const r = evaluateLicense('Apache-2.0', ctx());
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toContain('notice-file');
    expect(r.obligations).toContain('patent-grant');
  });

  it('AGPL-3.0 は SaaS で blocked', () => {
    const r = evaluateLicense('AGPL-3.0-only', ctx({ distributionModel: 'saas' }));
    expect(r.verdict).toBe('blocked');
    expect(r.obligations).toContain('source-disclosure');
  });

  it('AGPL-3.0 は社内利用のみなら allowed', () => {
    const r = evaluateLicense(
      'AGPL-3.0-only',
      ctx({ distributionModel: 'internal-only' }),
    );
    expect(r.verdict).toBe('allowed');
  });

  it('AGPL-3.0 でも devDependency なら allowed（差別化の中核）', () => {
    const r = evaluateLicense('AGPL-3.0-only', ctx({ scope: 'dev' }));
    expect(r.verdict).toBe('allowed');
    expect(r.rationale).toContain('not part of the artifact');
  });

  it('GPL-3.0 は SaaS では allowed だが将来の配布リスクを説明する', () => {
    const r = evaluateLicense('GPL-3.0-only', ctx({ distributionModel: 'saas' }));
    expect(r.verdict).toBe('allowed');
    expect(r.rationale).toContain('on distribution');
  });

  it('GPL-3.0 はバイナリ配布で blocked', () => {
    const r = evaluateLicense(
      'GPL-3.0-only',
      ctx({ distributionModel: 'distributed-binary' }),
    );
    expect(r.verdict).toBe('blocked');
  });

  it('GPL-3.0 は顧客納品で blocked', () => {
    const r = evaluateLicense(
      'GPL-3.0-only',
      ctx({ distributionModel: 'on-prem-delivery' }),
    );
    expect(r.verdict).toBe('blocked');
  });

  it('LGPL は動的リンクなら allowed', () => {
    const r = evaluateLicense('LGPL-3.0-only', ctx({ linkage: 'dynamic' }));
    expect(r.verdict).toBe('allowed');
  });

  it('LGPL は静的リンクなら review', () => {
    const r = evaluateLicense('LGPL-3.0-only', ctx({ linkage: 'static' }));
    expect(r.verdict).toBe('review');
  });

  it('SSPL は SaaS で review（条項の個別確認が必要）', () => {
    const r = evaluateLicense('SSPL-1.0', ctx({ distributionModel: 'saas' }));
    expect(r.verdict).toBe('review');
  });

  it('CC-BY-NC は商用利用で blocked', () => {
    const r = evaluateLicense('CC-BY-NC-4.0', ctx());
    expect(r.verdict).toBe('blocked');
  });

  it('未知のライセンスは blocked ではなく review', () => {
    const r = evaluateLicense('WTF-9000', ctx());
    expect(r.verdict).toBe('review');
  });

  it('ライセンス表記なしは blocked（全権利留保のため）', () => {
    const r = evaluateLicense('', ctx());
    expect(r.verdict).toBe('blocked');
    expect(r.rationale).toContain('all rights reserved');
  });

  it('rationale に助言的表現を含めない', () => {
    const r = evaluateLicense('AGPL-3.0-only', ctx());
    expect(r.rationale).not.toContain('you should');
    expect(r.rationale).not.toContain('we recommend');
  });
});

describe('evaluateLicense — 根拠条項の正確性', () => {
  it('AGPL の SaaS は第13条（ネットワーク条項）を根拠にする', () => {
    const r = evaluateLicense('AGPL-3.0-only', ctx({ distributionModel: 'saas' }));
    expect(r.rationale).toContain('section 13');
    expect(r.rationale).toContain('network');
  });

  it('AGPL のバイナリ配布は第13条を根拠にしない（配布条項が根拠）', () => {
    for (const model of ['distributed-binary', 'on-prem-delivery', 'library-published'] as const) {
      const r = evaluateLicense('AGPL-3.0-only', ctx({ distributionModel: model }));
      expect(r.verdict).toBe('blocked');
      expect(r.rationale).not.toContain('section 13');
      expect(r.rationale).toContain('distribut');
    }
  });

  it('AGPL の internal-only は第13条が適用されない旨を述べる', () => {
    const r = evaluateLicense('AGPL-3.0-only', ctx({ distributionModel: 'internal-only' }));
    expect(r.rationale).toContain('section 13');
  });
});
