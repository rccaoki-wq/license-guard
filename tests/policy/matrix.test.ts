import { describe, expect, it } from 'vitest';
import { ALL_DISTRIBUTION_MODELS, verdictMatrix } from '../../src/policy/matrix';

describe('ALL_DISTRIBUTION_MODELS', () => {
  it('5つの配布モデルを網羅する', () => {
    expect(ALL_DISTRIBUTION_MODELS).toEqual([
      'saas',
      'distributed-binary',
      'on-prem-delivery',
      'internal-only',
      'library-published',
    ]);
  });
});

describe('verdictMatrix', () => {
  it('全配布モデル分の行を返す', () => {
    const rows = verdictMatrix('MIT');
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.verdict === 'allowed')).toBe(true);
  });

  it('AGPL は internal-only のみ allowed', () => {
    const rows = verdictMatrix('AGPL-3.0-only');
    const allowed = rows.filter((r) => r.verdict === 'allowed').map((r) => r.model);
    expect(allowed).toEqual(['internal-only']);
  });

  it('GPL は saas と internal-only が allowed', () => {
    const rows = verdictMatrix('GPL-3.0-only');
    const allowed = rows.filter((r) => r.verdict === 'allowed').map((r) => r.model);
    expect(allowed).toEqual(['saas', 'internal-only']);
  });

  it('各行に理由と義務を含む', () => {
    const row = verdictMatrix('Apache-2.0')[0]!;
    expect(row.rationale.length).toBeGreaterThan(0);
    expect(row.obligations).toContain('notice-file');
  });

  it('linkage を指定できる', () => {
    const dynamic = verdictMatrix('LGPL-3.0-only', 'runtime', 'dynamic');
    const staticLink = verdictMatrix('LGPL-3.0-only', 'runtime', 'static');
    expect(dynamic[0]!.verdict).toBe('allowed');
    expect(staticLink[0]!.verdict).toBe('review');
  });

  it('dev スコープでは全モデルが allowed', () => {
    const rows = verdictMatrix('AGPL-3.0-only', 'dev');
    expect(rows.every((r) => r.verdict === 'allowed')).toBe(true);
  });
});
