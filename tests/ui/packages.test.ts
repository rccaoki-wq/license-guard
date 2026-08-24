import { describe, expect, it } from 'vitest';
import { renderPackageIndex } from '../../src/ui/packages';
import { renderPackagePage } from '../../src/ui/pkg';
import { renderLicenseIndex } from '../../src/ui/license';
import { buildSitemap, type SitemapPackage } from '../../src/seo/sitemap';
import { SITE_ORIGIN } from '../../src/ui/layout';

const PACKAGES: SitemapPackage[] = [
  { ecosystem: 'npm', name: 'nodebb', spdx: 'GPL-3.0-only' },
  { ecosystem: 'npm', name: 'p5', spdx: 'LGPL-2.1-only' },
  { ecosystem: 'pypi', name: 'weblate', spdx: 'GPL-3.0-only' },
  // 許容ライセンス。どの配布モデルでも結論が変わらないので載せない
  { ecosystem: 'npm', name: 'left-pad', spdx: 'MIT' },
];

describe('renderPackageIndex', () => {
  it('結論が配布モデルで変わるパッケージだけを並べる', () => {
    const html = renderPackageIndex(PACKAGES);
    expect(html).toContain('/pkg/npm/nodebb');
    expect(html).toContain('/pkg/pypi/weblate');
    // MIT のパッケージページはライセンスページの言い直しにしかならない
    expect(html).not.toContain('/pkg/npm/left-pad');
  });

  it('sitemap に載る集合と一致する（一覧とサイトマップで食い違わせない）', () => {
    const html = renderPackageIndex(PACKAGES);
    const inSitemap = [...buildSitemap(PACKAGES).matchAll(/<loc>([^<]*\/pkg\/[^<]*)<\/loc>/g)].map(
      (m) => m[1]!.slice(SITE_ORIGIN.length),
    );
    expect(inSitemap.length).toBeGreaterThan(0);
    for (const path of inSitemap) expect(html).toContain(`href="${path}"`);
  });

  it('canonical と description を持つ', () => {
    const html = renderPackageIndex(PACKAGES);
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/packages">`);
    expect(html).toContain('<meta name="description"');
  });

  // 「結論が変わるから載せた」と書いた直後に「0 件で変わる」と出ていた。
  // 選定はリンク方式込みで判定し、件数はリンク方式抜きで数えていたのが原因。
  it('「0 of the 5」と書かない（載せた理由と矛盾する）', () => {
    const html = renderPackageIndex(PACKAGES);
    expect(html).not.toContain('0 of the 5');
  });

  it('リンク方式で結論が変わるものは、その理由を書く', () => {
    // npm は動的リンクが既定なので、LGPL は既定では義務が出ない。
    // 件数だけ出すと「載せる意味が無いもの」に見える
    const html = renderPackageIndex([{ ecosystem: 'npm', name: 'p5', spdx: 'LGPL-2.1-only' }]);
    expect(html).toMatch(/link|linked|linking/i);
  });

  it('エコシステムごとにまとめる', () => {
    const html = renderPackageIndex(PACKAGES);
    expect(html).toContain('npm');
    expect(html).toContain('PyPI');
  });

  it('1件も無くても壊れず、理由を書く', () => {
    const html = renderPackageIndex([]);
    expect(html).toContain('<h1>');
    expect(html).not.toContain('/pkg/');
    // 空の一覧をそのまま出すと薄いページになる。なぜ空なのかを本文で説明する
    expect(html.length).toBeGreaterThan(2000);
  });

  it('重複したパッケージを二重に出さない', () => {
    const dup: SitemapPackage[] = [
      { ecosystem: 'npm', name: 'nodebb', spdx: 'GPL-3.0-only' },
      { ecosystem: 'npm', name: 'nodebb', spdx: 'GPL-3.0-only' },
    ];
    const html = renderPackageIndex(dup);
    expect(html.split('href="/pkg/npm/nodebb"').length - 1).toBe(1);
  });

  it('パッケージ名を HTML エスケープする', () => {
    const html = renderPackageIndex([
      { ecosystem: 'npm', name: '<script>x</script>', spdx: 'GPL-3.0-only' },
    ]);
    expect(html).not.toContain('<script>x</script>');
  });
});

describe('/packages への到達経路', () => {
  // 一覧に親が無ければ、Google は sitemap で存在を知っても巡回しない。
  // 実際 /pkg/* の4枚は「検出 - インデックス未登録」のまま止まっていた。
  it('全ページの nav から辿れる', () => {
    for (const html of [renderPackageIndex(PACKAGES), renderLicenseIndex()]) {
      expect(html).toContain('<a href="/packages">');
    }
  });

  it('パッケージページから一覧へ戻れる', () => {
    const html = renderPackagePage({ ecosystem: 'npm', name: 'nodebb', spdx: 'GPL-3.0-only' });
    expect(html).toContain('href="/packages"');
  });
});
