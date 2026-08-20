import { describe, expect, it } from 'vitest';
import { categorize } from '../../src/policy/categories';
import { evaluateLicense } from '../../src/policy/rules';
import type { PolicyContext } from '../../src/types';

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'saas',
  ...over,
});

describe('ファイル単位コピーレフトはリンク形態に依存しない', () => {
  it('MPL / EPL / CDDL を file-copyleft に分類する', () => {
    expect(categorize('MPL-2.0')).toBe('file-copyleft');
    expect(categorize('EPL-2.0')).toBe('file-copyleft');
    expect(categorize('EPL-1.0')).toBe('file-copyleft');
    expect(categorize('CDDL-1.0')).toBe('file-copyleft');
  });

  it('LGPL は library-copyleft のまま（リンク形態に依存する）', () => {
    expect(categorize('LGPL-3.0-only')).toBe('library-copyleft');
    expect(categorize('LGPL-2.1-only')).toBe('library-copyleft');
  });

  it('MPL-2.0 は静的リンクでも allowed（§3.3 が Larger Work を許す）', () => {
    for (const linkage of ['dynamic', 'static', 'separate-process'] as const) {
      const r = evaluateLicense('MPL-2.0', ctx({ linkage }));
      expect(r.verdict).toBe('allowed');
    }
  });

  it('MPL の理由に LGPL の再リンク論理を混ぜない', () => {
    const r = evaluateLicense('MPL-2.0', ctx({ linkage: 'static' }));
    expect(r.rationale).not.toContain('relinking');
    expect(r.rationale).not.toContain('object files');
    expect(r.rationale).toContain('file');
  });

  it('MPL は配布時も義務がファイル単位に留まる', () => {
    const r = evaluateLicense('MPL-2.0', ctx({ distributionModel: 'distributed-binary' }));
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toContain('source-disclosure');
  });

  it('LGPL は静的リンクで review のまま', () => {
    expect(evaluateLicense('LGPL-3.0-only', ctx({ linkage: 'static' })).verdict).toBe('review');
    expect(evaluateLicense('LGPL-3.0-only', ctx({ linkage: 'dynamic' })).verdict).toBe('allowed');
  });
});
