/**
 * 構造化データと Markdown 版。
 *
 * 見張りどころは 2 つ。
 *
 * 1. **`</script>` の閉じ込みを許さないこと。** パッケージ名は URL 由来の
 *    外部入力なので、JSON-LD にそのまま入る。エスケープを外すと任意の
 *    スクリプトを差し込める。
 * 2. **判定文がエンジンの出力そのままであること。** 構造化データ側で
 *    書き起こすと、表と JSON-LD で違うことを言う。
 */
import { describe, expect, it } from 'vitest';
import app from '../../src/index';
import { useOfflineUpstream } from '../helpers/offline';
import { faqJsonLd } from '../../src/ui/layout';
import { renderLicensePage } from '../../src/ui/license';
import { renderComparePage, COMPARE_PAIRS } from '../../src/ui/compare';
import { renderPackagePage } from '../../src/ui/pkg';
import { findLicense, LICENSE_CATALOG } from '../../src/seo/catalog';
import { verdictMatrix } from '../../src/policy/matrix';

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

/** ページから JSON-LD を取り出す */
function extract(html: string): any {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  return JSON.parse(m[1]!.replace(/\\u003c/g, '<'));
}

describe('faqJsonLd', () => {
  it('空なら何も出さない', () => {
    expect(faqJsonLd([])).toBe('');
  });

  it('FAQPage の形になる', () => {
    const out = faqJsonLd([{ question: 'Q?', answer: 'A.' }]);
    const j = JSON.parse(out.replace(/^<script[^>]*>|<\/script>$/g, ''));
    expect(j['@type']).toBe('FAQPage');
    expect(j.mainEntity[0].name).toBe('Q?');
    expect(j.mainEntity[0].acceptedAnswer.text).toBe('A.');
  });

  it('</script> を閉じ込められない（任意スクリプト差し込みの防止）', () => {
    const evil = '</script><script>alert(1)</script>';
    const out = faqJsonLd([{ question: evil, answer: evil }]);

    // script タグは 1 組だけ。閉じタグが本文中に現れていない
    expect(out.match(/<script/g)!.length).toBe(1);
    expect(out.match(/<\/script>/g)!.length).toBe(1);
    expect(out.slice(0, -'</script>'.length)).not.toContain('</script>');
    expect(out).toContain('\\u003c');
  });

  it('エスケープしても中身は復元できる（壊していない）', () => {
    const evil = '</script><b>x</b>';
    const out = faqJsonLd([{ question: evil, answer: 'ok' }]);
    const j = JSON.parse(
      out.replace(/^<script[^>]*>|<\/script>$/g, '').replace(/\\u003c/g, '<'),
    );
    expect(j.mainEntity[0].name).toBe(evil);
  });
});

describe('ライセンスページの構造化データ', () => {
  it('全ライセンスで出力され、配布モデル分の問いを含む', () => {
    for (const l of LICENSE_CATALOG) {
      const j = extract(renderLicensePage(l));
      expect(j, l.id).not.toBeNull();
      // 5 モデル + dev スコープ。静的リンクで結論が変わるものは、その問いが 1 つ増える
      const linkageMatters = verdictMatrix(l.id, 'runtime', 'static').some(
        (r, i) => r.verdict !== verdictMatrix(l.id, 'runtime')[i]!.verdict,
      );
      expect(j.mainEntity.length, l.id).toBe(linkageMatters ? 7 : 6);
    }
  });

  it('本文に無い問いを構造化データで主張しない', () => {
    // JSON-LD だけに Q&A があると、引用されたときページに無いことを答えたことになる
    for (const l of LICENSE_CATALOG) {
      const html = renderLicensePage(l);
      const j = extract(html);
      for (const q of j.mainEntity) {
        expect(html, `${l.id}: ${q.name}`).toContain(q.name.replace(/&/g, '&amp;'));
      }
    }
  });

  it('答えがエンジンの出力そのまま（表と食い違わない）', () => {
    const entry = findLicense('AGPL-3.0-only')!;
    const j = extract(renderLicensePage(entry));
    const answers = j.mainEntity.map((q: any) => q.acceptedAnswer.text);
    for (const r of verdictMatrix(entry.id)) {
      expect(answers).toContain(r.rationale);
    }
  });

  it('問いが実際に投げられる形になっている', () => {
    const j = extract(renderLicensePage(findLicense('AGPL-3.0-only')!));
    const qs = j.mainEntity.map((q: any) => q.name);
    expect(qs.some((q: string) => /Can I use AGPL-3\.0-only in hosted saas\?/i.test(q))).toBe(true);
    expect(qs.some((q: string) => /build-time or dev dependency/i.test(q))).toBe(true);
  });
});

describe('比較ページの構造化データ', () => {
  it('全対で「何が違うのか」の問いを含む', () => {
    for (const p of COMPARE_PAIRS) {
      const j = extract(renderComparePage(p)!);
      expect(j, `${p.a} vs ${p.b}`).not.toBeNull();
      const qs = j.mainEntity.map((q: any) => q.name);
      expect(qs[0]).toBe(`What is the difference between ${p.a} and ${p.b}?`);
    }
  });

  it('差がある対では、その差の理由が答えに入る', () => {
    const p = COMPARE_PAIRS.find((x) => x.a === 'AGPL-3.0-only' && x.b === 'GPL-3.0-only')!;
    const j = extract(renderComparePage(p)!);
    expect(j.mainEntity[0].acceptedAnswer.text).toContain('section 13');
  });
});

describe('パッケージページの構造化データ', () => {
  it('問いがページタイトルと一致する', () => {
    const j = extract(renderPackagePage({ ecosystem: 'npm', name: 'express', spdx: 'MIT' }));
    expect(j.mainEntity[0].name).toBe('Is express safe for commercial use?');
  });

  it('パッケージ名に仕込まれたスクリプトを無害化する', () => {
    const html = renderPackagePage({
      ecosystem: 'npm',
      name: '</script><script>alert(1)</script>',
      spdx: 'MIT',
    });
    // ld+json ブロックが 1 つだけで、そこから抜け出していない
    const blocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g)!;
    expect(blocks.length).toBe(1);
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('Markdown 版', () => {
  it('全ライセンスで取得できる', async () => {
    for (const l of LICENSE_CATALOG) {
      const res = await app.request(`/license/${encodeURIComponent(l.id)}.md`, {}, fakeEnv());
      expect(res.status, l.id).toBe(200);
      expect(res.headers.get('content-type'), l.id).toContain('text/markdown');
    }
  });

  it('HTML の飾りが混ざらない', async () => {
    const res = await app.request('/license/MIT.md', {}, fakeEnv());
    const md = await res.text();
    expect(md).not.toContain('<html');
    expect(md).not.toContain('<nav');
    expect(md.startsWith('# ')).toBe(true);
  });

  it('MCP のリソースと同じ中身（答えを2つ持たない）', async () => {
    const { renderLicenseResource } = await import('../../src/mcp/resources');
    const res = await app.request('/license/AGPL-3.0-only.md', {}, fakeEnv());
    expect(await res.text()).toBe(renderLicenseResource('AGPL-3.0-only'));
  });

  it('未知のライセンスは 404', async () => {
    expect((await app.request('/license/NOPE.md', {}, fakeEnv())).status).toBe(404);
  });

  it('HTML 版は従来どおり動く（.md 追加で壊していない）', async () => {
    const res = await app.request('/license/MIT', {}, fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html');
  });
});
