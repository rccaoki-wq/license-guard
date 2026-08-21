import { describe, expect, it } from 'vitest';
import { renderLicenseIndex, renderLicensePage } from '../../src/ui/license';
import { renderPackageNotFound, renderPackagePage, packagePath } from '../../src/ui/pkg';
import { LICENSE_CATALOG, findLicense } from '../../src/seo/catalog';
import { buildRobotsTxt, buildSitemap } from '../../src/seo/sitemap';
import { renderPage } from '../../src/ui/page';
import { SITE_ORIGIN } from '../../src/ui/layout';

describe('LICENSE_CATALOG', () => {
  it('SPDX ID が重複しない', () => {
    const ids = LICENSE_CATALOG.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('全エントリが固有の説明文を持つ（薄いコンテンツ回避）', () => {
    const summaries = LICENSE_CATALOG.map((l) => l.summary);
    expect(new Set(summaries).size).toBe(summaries.length);
    expect(summaries.every((s) => s.length > 80)).toBe(true);
  });

  it('findLicense は大文字小文字を無視する', () => {
    expect(findLicense('agpl-3.0-only')?.id).toBe('AGPL-3.0-only');
    expect(findLicense('nope')).toBeUndefined();
  });
});

describe('renderLicensePage', () => {
  const agpl = findLicense('AGPL-3.0-only')!;

  it('canonical と description を含む', () => {
    const html = renderLicensePage(agpl);
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('/license/AGPL-3.0-only');
    expect(html).toContain('<meta name="description"');
  });

  it('5つの配布モデルすべてを表に含む', () => {
    const html = renderLicensePage(agpl);
    for (const label of [
      'Hosted SaaS',
      'Distributed binary',
      'Delivered to customer',
      'Internal use only',
      'Published library',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('免責を含む', () => {
    expect(renderLicensePage(agpl)).toContain('not legal advice');
  });

  it('全カタログのページが生成できる', () => {
    for (const l of LICENSE_CATALOG) {
      const html = renderLicensePage(l);
      expect(html).toContain('<h1>');
      expect(html.length).toBeGreaterThan(1500);
    }
  });

  it('リンク形態で結論が変わるライセンスのみ静的リンク表を出す', () => {
    expect(renderLicensePage(findLicense('LGPL-3.0-only')!)).toContain('Static linking changes');
    expect(renderLicensePage(findLicense('MIT')!)).not.toContain('Static linking changes');
  });
});

describe('renderLicenseIndex', () => {
  it('全ライセンスへのリンクを含む', () => {
    const html = renderLicenseIndex();
    for (const l of LICENSE_CATALOG) {
      expect(html).toContain(`/license/${encodeURIComponent(l.id)}`);
    }
  });
});

describe('packagePath', () => {
  it('go はスラッシュを保持する', () => {
    expect(packagePath('go', 'github.com/gin-gonic/gin')).toBe('/pkg/go/github.com/gin-gonic/gin');
  });

  it('npm のスコープ名はエンコードする', () => {
    expect(packagePath('npm', '@types/node')).toBe('/pkg/npm/%40types%2Fnode');
  });
});

describe('renderPackagePage', () => {
  it('タイトルが検索意図に一致する', () => {
    const html = renderPackagePage({ ecosystem: 'npm', name: 'express', spdx: 'MIT' });
    expect(html).toContain('<title>Is express safe for commercial use?');
  });

  it('既知ライセンスへ内部リンクする', () => {
    const html = renderPackagePage({ ecosystem: 'npm', name: 'foo', spdx: 'AGPL-3.0-only' });
    expect(html).toContain('/license/AGPL-3.0-only');
  });

  it('義務が発生する数を見出しに反映する', () => {
    const agpl = renderPackagePage({ ecosystem: 'npm', name: 'foo', spdx: 'AGPL-3.0-only' });
    expect(agpl).toContain('4 of the 5');
    const mit = renderPackagePage({ ecosystem: 'npm', name: 'foo', spdx: 'MIT' });
    expect(mit).toContain('no source-disclosure obligation');
  });

  it('Go は静的リンク前提であることを明示する', () => {
    const html = renderPackagePage({ ecosystem: 'go', name: 'github.com/a/b', spdx: 'MIT' });
    expect(html).toContain('linked statically');
  });

  it('未知ライセンスでもページを生成できる', () => {
    const html = renderPackagePage({ ecosystem: 'pypi', name: 'foo', spdx: 'Weird-1.0' });
    expect(html).toContain('<h1>');
    expect(html).toContain('/licenses');
  });

  it('パッケージ名の HTML を必ずエスケープする', () => {
    const html = renderPackagePage({
      ecosystem: 'npm',
      name: '<script>alert(1)</script>',
      spdx: 'MIT',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderPackageNotFound', () => {
  it('「宣言がない」と断定しない', () => {
    const html = renderPackageNotFound('npm', 'mystery');
    expect(html).toContain('cannot tell them apart');
    expect(html).toContain('all rights reserved');
  });
});

describe('buildSitemap', () => {
  it('トップとライセンスページを含む', () => {
    const xml = buildSitemap([]);
    // URL を直書きするとドメインを移すたびに落ちる。意味は「正規の出所を指すこと」
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`);
    expect(xml).toContain('/license/AGPL-3.0-only');
  });

  it('渡されたパッケージを含む', () => {
    const xml = buildSitemap([{ ecosystem: 'npm', name: 'left-pad' }]);
    expect(xml).toContain('/pkg/npm/left-pad');
  });

  it('シードと重複するパッケージを二重に出さない', () => {
    const xml = buildSitemap([{ ecosystem: 'npm', name: 'express' }]);
    const count = xml.split('/pkg/npm/express<').length - 1;
    expect(count).toBe(1);
  });

  it('XML として妥当な形をしている', () => {
    const xml = buildSitemap([]);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});

describe('buildRobotsTxt', () => {
  it('sitemap を指し API を除外する', () => {
    const txt = buildRobotsTxt();
    expect(txt).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    expect(txt).toContain('Disallow: /api/');
  });
});

describe('renderPage（ツール）', () => {
  it('英語で提供される', () => {
    const html = renderPage();
    expect(html).toContain('lang="en"');
    expect(html).toContain('Check licenses');
    expect(html).toContain('not legal advice');
  });

  it('配布モデルの選択肢を全て含む', () => {
    const html = renderPage();
    for (const v of [
      'saas',
      'distributed-binary',
      'on-prem-delivery',
      'internal-only',
      'library-published',
    ]) {
      expect(html).toContain(`value="${v}"`);
    }
  });

  it('有料レポートCTAを含む', () => {
    expect(renderPage()).toContain('id="cta-paid-report"');
  });
});
