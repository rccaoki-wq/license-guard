/**
 * 比較ページ。
 *
 * 一番の見張りどころは、**ツールの答えと食い違わないこと**。
 * 比較ページで文章を書き起こすと、同じ問いに 2 つの答えが生まれる。
 * 判定は必ず verdictMatrix() から来ていることを固定する。
 */
import { describe, expect, it } from 'vitest';
import app from '../../src/index';
import { useOfflineUpstream } from '../helpers/offline';
import {
  COMPARE_PAIRS,
  comparePath,
  findPair,
  renderCompareIndex,
  renderComparePage,
} from '../../src/ui/compare';
import { verdictMatrix } from '../../src/policy/matrix';
import { findLicense } from '../../src/seo/catalog';
import { buildSitemap } from '../../src/seo/sitemap';

function fakeEnv() {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return { async first() { return null; }, async run() { return { success: true }; } };
          },
          async all() { return { results: [] }; },
        };
      },
    } as unknown as D1Database,
  };
}

useOfflineUpstream();

const VERDICT_LABEL: Record<string, string> = {
  allowed: 'No obligation',
  review: 'Needs review',
  blocked: 'Obligation triggered',
};

describe('比較対の定義', () => {
  it('両側ともカタログに実在する（存在しないIDを並べない）', () => {
    for (const p of COMPARE_PAIRS) {
      expect(findLicense(p.a), p.a).toBeDefined();
      expect(findLicense(p.b), p.b).toBeDefined();
    }
  });

  it('同じ対を二度出さない（順序違いも含む）', () => {
    const keys = COMPARE_PAIRS.map((p) => [p.a, p.b].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('自分自身と比較しない', () => {
    for (const p of COMPARE_PAIRS) expect(p.a).not.toBe(p.b);
  });

  it('なぜ並ぶのかが書いてある', () => {
    for (const p of COMPARE_PAIRS) expect(p.why.length, `${p.a} vs ${p.b}`).toBeGreaterThan(30);
  });

  it('URL が一意', () => {
    const paths = COMPARE_PAIRS.map(comparePath);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('findPair', () => {
  const p = COMPARE_PAIRS[0]!;

  it('順序を問わず引ける', () => {
    expect(findPair(p.a, p.b)).toBe(p);
    expect(findPair(p.b, p.a)).toBe(p);
  });

  it('大文字小文字を問わない', () => {
    expect(findPair(p.a.toUpperCase(), p.b.toLowerCase())).toBe(p);
  });

  it('未定義の対は undefined', () => {
    expect(findPair('MIT', 'Zlib')).toBeUndefined();
    expect(findPair('nope', 'nope2')).toBeUndefined();
  });
});

describe('判定がエンジンと一致する（同じ問いに2つの答えを持たせない）', () => {
  it('全対・全配布モデルで verdictMatrix の結論がページに載る', () => {
    for (const p of COMPARE_PAIRS) {
      const html = renderComparePage(p)!;
      expect(html, `${p.a} vs ${p.b}`).toBeTruthy();

      for (const rows of [verdictMatrix(p.a), verdictMatrix(p.b)]) {
        for (const r of rows) {
          expect(html, `${p.a} vs ${p.b} / ${r.model}`).toContain(VERDICT_LABEL[r.verdict]!);
        }
      }
    }
  });

  it('差の件数がエンジンの計算と一致する', () => {
    for (const p of COMPARE_PAIRS) {
      const a = verdictMatrix(p.a);
      const b = verdictMatrix(p.b);
      const n = a.filter((ra, i) => ra.verdict !== b[i]!.verdict).length;
      const html = renderComparePage(p)!;

      if (n === 0) {
        expect(html, `${p.a} vs ${p.b}`).toContain('reach the same verdict');
      } else {
        expect(html, `${p.a} vs ${p.b}`).toContain(`differ in ${n} of the ${a.length}`);
      }
    }
  });

  it('AGPL と GPL の SaaS での差が実際に示される（製品の中核主張）', () => {
    const p = findPair('AGPL-3.0-only', 'GPL-3.0-only')!;
    const html = renderComparePage(p)!;
    expect(html).toContain('Hosted SaaS');
    // AGPL は blocked、GPL は allowed。両方の語がページに出る
    expect(html).toContain('Obligation triggered');
    expect(html).toContain('No obligation');
    // 差の理由として第13条が引かれる
    expect(html).toContain('section 13');
  });
});

describe('ページの体裁', () => {
  it('title と description を持ち、canonical が対の URL を指す', () => {
    for (const p of COMPARE_PAIRS) {
      const html = renderComparePage(p)!;
      expect(html).toContain('<title>');
      expect(html).toContain('<meta name="description"');
      expect(html).toContain(comparePath(p));
    }
  });

  it('免責を含む', () => {
    expect(renderComparePage(COMPARE_PAIRS[0]!)!).toContain('not legal advice');
  });

  it('両ライセンスの個別ページへ内部リンクする', () => {
    const p = COMPARE_PAIRS[0]!;
    const html = renderComparePage(p)!;
    expect(html).toContain(`/license/${encodeURIComponent(p.a)}`);
    expect(html).toContain(`/license/${encodeURIComponent(p.b)}`);
  });

  it('dev スコープの免除に触れる（表だけ読んで誤解させない）', () => {
    expect(renderComparePage(COMPARE_PAIRS[0]!)!).toContain('build-time-only');
  });

  it('索引が全対へリンクする', () => {
    const html = renderCompareIndex();
    for (const p of COMPARE_PAIRS) expect(html).toContain(comparePath(p));
  });
});

describe('ルーティング', () => {
  it('/compare が索引を返す', async () => {
    const res = await app.request('/compare', {}, fakeEnv());
    expect(res.status).toBe(200);
  });

  it('定義済みの対を返す', async () => {
    for (const p of COMPARE_PAIRS) {
      const res = await app.request(comparePath(p), {}, fakeEnv());
      expect(res.status, comparePath(p)).toBe(200);
    }
  });

  it('逆順の URL でも同じページを返す', async () => {
    const p = COMPARE_PAIRS[0]!;
    const reversed = `/compare/${p.b.toLowerCase()}-vs-${p.a.toLowerCase()}`;
    const res = await app.request(reversed, {}, fakeEnv());
    expect(res.status).toBe(200);
  });

  it('未定義の対は 404（無限のURL空間を作らない）', async () => {
    expect((await app.request('/compare/mit-vs-zlib', {}, fakeEnv())).status).toBe(404);
    expect((await app.request('/compare/nope-vs-nope2', {}, fakeEnv())).status).toBe(404);
  });

  it('-vs- を含まない入力は 404', async () => {
    expect((await app.request('/compare/garbage', {}, fakeEnv())).status).toBe(404);
  });

  it('壊れた入力で 500 にしない', async () => {
    for (const u of ['/compare/-vs-', '/compare/a-vs-', '/compare/-vs-b', '/compare/%']) {
      const res = await app.request(u, {}, fakeEnv());
      expect([404, 400], u).toContain(res.status);
    }
  });
});

describe('sitemap', () => {
  it('比較ページを載せる（載せなければ索引されない）', () => {
    const xml = buildSitemap([]);
    expect(xml).toContain('/compare<');
    for (const p of COMPARE_PAIRS) expect(xml).toContain(comparePath(p));
  });
});
