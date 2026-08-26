import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { useOfflineUpstream } from './helpers/offline';
import { detectAndParse, MAX_LOOKUPS } from '../src/manifests';
import { scan } from '../src/scan';
import type { CacheLike } from '../src/resolver';

function fakeEnv() {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return null;
              },
              async run() {
                return { success: true };
              },
            };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database,
  };
}

const noopCache: CacheLike = {
  async get() {
    return null;
  },
  async put() {},
};

// 上流レジストリへ出ない。名前検証を第三者の応答時間に依存させないため
useOfflineUpstream();

describe('監査#3 照会が必要な依存数の上限', () => {
  it('上限を超えても黙って切り詰めず、未確認として明示する', async () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i <= MAX_LOOKUPS; i++) deps[`pkg-${i}`] = '1.0.0';
    const r = await scan(JSON.stringify({ dependencies: deps }), 'saas', noopCache, {
      npm: async () => ({ spdx: 'MIT' }),
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
      cargo: async () => ({ spdx: null }),
      rubygems: async () => ({ spdx: null }),
    });
    // 全件が結果に含まれ、未確認分は allowed でなく review になる
    expect(r.summary.total).toBe(MAX_LOOKUPS + 1);
    expect(r.findings.filter((f) => f.resolvedFrom === 'not-checked').length).toBe(1);
    // ちょうど1件なので単数形になる（tests/limitation-wording）
    expect(r.limitations.some((l) => l.includes('1 dependency was not checked'))).toBe(true);
  });

  it('上限ちょうどは通す', () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < MAX_LOOKUPS; i++) deps[`pkg-${i}`] = '1.0.0';
    expect(detectAndParse(JSON.stringify({ dependencies: deps })).dependencies).toHaveLength(
      MAX_LOOKUPS,
    );
  });

  it('ロックファイルは照会不要なので上限に掛からない', () => {
    // 費用がかかるのは外部照会であって依存の総数ではない
    const packages: Record<string, unknown> = {};
    for (let i = 0; i < MAX_LOOKUPS * 5; i++) {
      packages[`node_modules/pkg-${i}`] = { version: '1.0.0', license: 'MIT' };
    }
    const parsed = detectAndParse(JSON.stringify({ lockfileVersion: 3, packages }));
    expect(parsed.dependencies).toHaveLength(MAX_LOOKUPS * 5);
  });

  // アプリ層で同じ検証をすると実レジストリへ 200 回問い合わせることになり、
  // オフラインで走らない。ふるまいは scan 層（tests/partial-scan.test.ts）で
  // フェッチャを差し替えて検証している。
});

describe('監査#4 不正なURLエンコードで 500 にしない', () => {
  it('/pkg/go/% は 404', async () => {
    expect((await app.request('/pkg/go/%', {}, fakeEnv())).status).toBe(404);
  });

  it('/api/pkg/go/%E0%A4%A は 400', async () => {
    const res = await app.request('/api/pkg/go/%E0%A4%A', {}, fakeEnv());
    expect(res.status).toBe(400);
  });
});

describe('監査#5 Goモジュール名の検証', () => {
  it('スキーム付きの入力を拒否する', async () => {
    const res = await app.request('/api/pkg/go/https://evil.com/x', {}, fakeEnv());
    expect(res.status).toBe(400);
  });

  it('正当なモジュールパスは通す（400にしない）', async () => {
    const res = await app.request('/api/pkg/go/github.com/gin-gonic/gin', {}, fakeEnv());
    expect(res.status).not.toBe(400);
  });

  it('HTMLページ側もスキーム付きを 404 にする', async () => {
    const res = await app.request('/pkg/go/https://evil.com/x', {}, fakeEnv());
    expect(res.status).toBe(404);
  });
});

describe('監査#6 機械可読出力の免責', () => {
  it('/api/scan に disclaimer がある', async () => {
    const res = await app.request(
      '/api/scan',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: JSON.stringify({ dependencies: { a: '1.0.0' } }),
          distributionModel: 'saas',
        }),
      },
      fakeEnv(),
    );
    const body = (await res.json()) as { disclaimer?: string };
    expect(body.disclaimer).toContain('not legal advice');
  });
});

describe('監査#1 最新版フォールバックの開示', () => {
  const fetchers = {
    npm: async () => ({ spdx: 'MIT', fromLatest: true }),
    pypi: async () => ({ spdx: null }),
    go: async () => ({ spdx: null }),
    cargo: async () => ({ spdx: null }),
    rubygems: async () => ({ spdx: null }),
  };

  it('判定は出しつつ、固定版由来でないことを理由文に明示する', async () => {
    const r = await scan(
      JSON.stringify({ dependencies: { express: '1.0.0' } }),
      'saas',
      noopCache,
      fetchers,
    );
    expect(r.findings[0]!.verdict).toBe('allowed');
    expect(r.findings[0]!.resolvedFrom).toBe('registry-latest');
    expect(r.findings[0]!.rationale).toContain('not read from the exact version requested');
  });

  it('limitations にも記す', async () => {
    const r = await scan(
      JSON.stringify({ dependencies: { express: '1.0.0' } }),
      'saas',
      noopCache,
      fetchers,
    );
    expect(r.limitations.some((l) => l.includes('resolved against the latest release'))).toBe(
      true,
    );
  });

  it('固定版由来のときは注記を付けない', async () => {
    const r = await scan(
      JSON.stringify({ dependencies: { chalk: '1.0.0' } }),
      'saas',
      noopCache,
      { ...fetchers, npm: async () => ({ spdx: 'MIT' }) },
    );
    expect(r.findings[0]!.rationale).not.toContain('not read from the exact version requested');
    expect(r.limitations.some((l) => l.includes('latest release'))).toBe(false);
  });
});
