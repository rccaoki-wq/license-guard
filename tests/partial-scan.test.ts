import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan';
import { MAX_LOOKUPS } from '../src/manifests';
import type { CacheLike } from '../src/resolver';

const noopCache: CacheLike = { async get() { return null; }, async put() {} };
const allMit = {
  npm: async () => ({ spdx: 'MIT' }),
  pypi: async () => ({ spdx: null }),
  go: async () => ({ spdx: null }),
  cargo: async () => ({ spdx: null }),
  rubygems: async () => ({ spdx: null }),
  nuget: async () => ({ spdx: null }),
};

function bigLock(n: number) {
  const packages: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) packages[`node_modules/p${i}`] = { version: '1.0.0' };
  return JSON.stringify({ lockfileVersion: 3, packages });
}

describe('上限を超えたときの部分的な結果', () => {
  it('拒否せず、確認できたものは返す', async () => {
    const r = await scan(bigLock(MAX_LOOKUPS + 100), 'saas', noopCache, allMit);
    expect(r.summary.total).toBe(MAX_LOOKUPS + 100);
  });

  it('上流照会は上限までしか行わない（費用の上限は維持する）', async () => {
    let calls = 0;
    const counting = {
      npm: async () => { calls++; return { spdx: 'MIT' }; },
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
      cargo: async () => ({ spdx: null }),
      rubygems: async () => ({ spdx: null }),
      nuget: async () => ({ spdx: null }),
    };
    await scan(bigLock(MAX_LOOKUPS + 100), 'saas', noopCache, counting);
    expect(calls).toBeLessThanOrEqual(MAX_LOOKUPS);
  });

  it('未確認のものを allowed にしない', async () => {
    // 不完全なスキャンが「問題なし」に見えることは許されない
    const r = await scan(bigLock(MAX_LOOKUPS + 100), 'saas', noopCache, allMit);
    const notChecked = r.findings.filter((f) => f.resolvedFrom === 'not-checked');
    expect(notChecked).toHaveLength(100);
    expect(notChecked.every((f) => f.verdict === 'review')).toBe(true);
  });

  it('未確認である理由を明示する', async () => {
    const r = await scan(bigLock(MAX_LOOKUPS + 100), 'saas', noopCache, allMit);
    const nc = r.findings.find((f) => f.resolvedFrom === 'not-checked')!;
    expect(nc.rationale).toContain('not checked');
    expect(nc.spdxExpression).toBeNull();
  });

  it('未確認の件数を limitations に出す', async () => {
    const r = await scan(bigLock(MAX_LOOKUPS + 100), 'saas', noopCache, allMit);
    expect(r.limitations.some((l) => l.includes('100 dependencies were not checked'))).toBe(true);
  });

  it('上限内なら未確認は生じない', async () => {
    const r = await scan(bigLock(10), 'saas', noopCache, allMit);
    expect(r.findings.some((f) => f.resolvedFrom === 'not-checked')).toBe(false);
    expect(r.limitations.some((l) => l.includes('not checked'))).toBe(false);
  });

  it('キャッシュ済みのものは上限を消費しない', async () => {
    let calls = 0;
    const warm: CacheLike = {
      async get() { return { spdx: 'MIT', source: 'registry' }; },
      async put() {},
      async getMany(deps) {
        return new Map(deps.map((d) => [`${d.ecosystem}|${d.name}|${d.version}`,
          { spdx: 'MIT', source: 'registry' }]));
      },
    };
    const counting = {
      npm: async () => { calls++; return { spdx: 'MIT' }; },
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
      cargo: async () => ({ spdx: null }),
      rubygems: async () => ({ spdx: null }),
      nuget: async () => ({ spdx: null }),
    };
    const r = await scan(bigLock(MAX_LOOKUPS + 300), 'saas', warm, counting);
    expect(calls).toBe(0);
    expect(r.findings.some((f) => f.resolvedFrom === 'not-checked')).toBe(false);
  });
});
