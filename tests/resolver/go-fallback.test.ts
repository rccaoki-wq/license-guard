import { describe, expect, it, vi } from 'vitest';
import { fetchGoVersions, sortSemverDesc } from '../../src/resolver/goproxy';
import { fetchGoLicense } from '../../src/resolver/clearlydefined';

describe('sortSemverDesc', () => {
  it('セマンティックバージョンとして新しい順に並べる', () => {
    expect(sortSemverDesc(['v1.2.0', 'v1.10.0', 'v1.9.0', 'v1.11.1'])).toEqual([
      'v1.11.1', 'v1.10.0', 'v1.9.0', 'v1.2.0',
    ]);
  });

  it('プレリリースを除外する', () => {
    expect(sortSemverDesc(['v1.0.0', 'v2.0.0-rc1', 'v1.1.0'])).toEqual(['v1.1.0', 'v1.0.0']);
  });

  it('不正な行を無視する', () => {
    expect(sortSemverDesc(['', 'garbage', 'v1.0.0'])).toEqual(['v1.0.0']);
  });
});

describe('fetchGoVersions', () => {
  it('@v/list を新しい順で返す', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('https://proxy.golang.org/github.com/a/b/@v/list');
      return { ok: true, text: async () => 'v1.0.0\nv1.2.0\nv1.1.0\n' };
    }) as unknown as typeof fetch;
    expect(await fetchGoVersions('github.com/a/b', f)).toEqual(['v1.2.0', 'v1.1.0', 'v1.0.0']);
  });

  it('取得できなければ空配列', async () => {
    const f = vi.fn(async () => ({ ok: false, text: async () => '' })) as unknown as typeof fetch;
    expect(await fetchGoVersions('github.com/a/b', f)).toEqual([]);
  });
});

describe('未収録の最新版からのフォールバック', () => {
  it('最新版が未収録なら収録済みの旧版を使う', async () => {
    // ClearlyDefined は最新版を harvest していないことが多い
    const f = vi.fn(async (url: string) => {
      if (url.includes('@latest')) return { ok: true, json: async () => ({ Version: 'v1.12.1' }) };
      if (url.includes('@v/list')) return { ok: true, text: async () => 'v1.9.0\nv1.10.0\nv1.12.1\n' };
      if (url.includes('/v1.12.1')) return { ok: true, json: async () => ({ licensed: {} }) };
      if (url.includes('/v1.10.0')) return { ok: true, json: async () => ({ licensed: { declared: 'MIT' } }) };
      return { ok: true, json: async () => ({ licensed: { declared: 'MIT' } }) };
    }) as unknown as typeof fetch;

    const r = await fetchGoLicense('github.com/stretchr/testify', null, f);
    expect(r.spdx).toBe('MIT');
    // 要求した版とは別の版から採ったことを示す
    expect(r.fromLatest).toBe(true);
  });

  it('固定版が指定されている場合は別の版で代用しない', async () => {
    // 「この版のライセンスは？」に別の版の答えを返してはいけない
    const f = vi.fn(async (url: string) => {
      if (url.includes('@v/list')) throw new Error('版一覧を引いてはいけない');
      return { ok: true, json: async () => ({ licensed: {} }) };
    }) as unknown as typeof fetch;

    expect((await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).spdx).toBeNull();
  });

  it('どの版でも解決できなければ null', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('@latest')) return { ok: true, json: async () => ({ Version: 'v1.0.0' }) };
      if (url.includes('@v/list')) return { ok: true, text: async () => 'v1.0.0\n' };
      return { ok: true, json: async () => ({ licensed: {} }) };
    }) as unknown as typeof fetch;

    expect((await fetchGoLicense('github.com/a/b', null, f)).spdx).toBeNull();
  });
});

describe('pickCandidates', () => {
  it('件数が少なければそのまま返す', async () => {
    const { pickCandidates } = await import('../../src/resolver/clearlydefined');
    expect(pickCandidates(['a', 'b'], 6)).toEqual(['a', 'b']);
  });

  it('新しい側を優先しつつ古い側からも拾う', async () => {
    const { pickCandidates } = await import('../../src/resolver/clearlydefined');
    const versions = Array.from({ length: 50 }, (_, i) => `v0.${50 - i}.0`);
    const picked = pickCandidates(versions, 6);
    expect(picked).toHaveLength(6);
    expect(picked.slice(0, 3)).toEqual(['v0.50.0', 'v0.49.0', 'v0.48.0']);
    // 古い側にも届いていること（直近だけに偏っていない）
    const oldest = picked[picked.length - 1]!;
    expect(Number(/v0\.(\d+)\.0/.exec(oldest)![1])).toBeLessThan(25);
  });
});

describe('Go の特許追加許諾', () => {
  it('golang.org/x/* の複合式が要確認にならない', async () => {
    const { evaluateExpression } = await import('../../src/policy/engine');
    const r = evaluateExpression(
      'BSD-3-Clause AND LicenseRef-scancode-google-patent-license-golang',
      { scope: 'runtime', linkage: 'static', distributionModel: 'saas' },
    );
    expect(r.verdict).toBe('allowed');
  });
});
