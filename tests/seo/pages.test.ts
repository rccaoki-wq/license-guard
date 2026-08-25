import { describe, expect, it } from 'vitest';
import { renderLicenseIndex, renderLicensePage } from '../../src/ui/license';
import { renderPackageNotFound, renderPackagePage, packagePath } from '../../src/ui/pkg';
import { LICENSE_CATALOG, findLicense } from '../../src/seo/catalog';
import { buildRobotsTxt, buildSitemap, packagePageSaysSomething } from '../../src/seo/sitemap';
import { verdictMatrix } from '../../src/policy/matrix';
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

  // Search Console の所有権トークン。Google は一度確認して終わりではなく
  // 定期的に取りに来るので、消えるとプロパティが確認解除され、
  // インデックス状況もサイトマップの結果も見えなくなる。静かに壊れる類なので固定する。
  it('Search Console の所有権トークンを出す', () => {
    const html = renderLicensePage(agpl);
    expect(html).toContain(
      '<meta name="google-site-verification" content="ZNgNlJSyDWMr0feWYipRDqgs_HhYsrITbT0YVUv1A4M">',
    );
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
    expect(renderLicensePage(findLicense('LGPL-3.0-only')!)).toContain('Does static linking change');
    expect(renderLicensePage(findLicense('MIT')!)).not.toContain('Does static linking change');
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

  it('配布モデルで結論が変わるパッケージを含む', () => {
    const xml = buildSitemap([{ ecosystem: 'npm', name: 'left-pad', spdx: 'AGPL-3.0-only' }]);
    expect(xml).toContain('/pkg/npm/left-pad');
  });

  // 許容ライセンスのパッケージページは、名前以外がライセンスページの言い直しになる。
  // 843件そういうページを自分から提出すると、サイト全体が薄いと判断される。
  it('どの配布モデルでも結論が同じパッケージは載せない', () => {
    const xml = buildSitemap([
      { ecosystem: 'npm', name: 'left-pad', spdx: 'MIT' },
      { ecosystem: 'npm', name: 'glob-parent', spdx: 'ISC' },
      { ecosystem: 'pypi', name: 'requests', spdx: 'Apache-2.0' },
    ]);
    expect(xml).not.toContain('/pkg/npm/left-pad');
    expect(xml).not.toContain('/pkg/npm/glob-parent');
    expect(xml).not.toContain('/pkg/pypi/requests');
  });

  it('リンク方式で結論が変わる LGPL は載せる', () => {
    const xml = buildSitemap([{ ecosystem: 'npm', name: 'somelib', spdx: 'LGPL-3.0-only' }]);
    expect(xml).toContain('/pkg/npm/somelib');
  });

  it('解釈できないライセンスは載せない', () => {
    const xml = buildSitemap([{ ecosystem: 'npm', name: 'weird', spdx: 'NOT-A-LICENSE' }]);
    expect(xml).not.toContain('/pkg/npm/weird');
  });

  it('同じパッケージを二重に出さない', () => {
    const xml = buildSitemap([
      { ecosystem: 'npm', name: 'ghostscript', spdx: 'AGPL-3.0-only' },
      { ecosystem: 'npm', name: 'ghostscript', spdx: 'AGPL-3.0-only' },
    ]);
    const count = xml.split('/pkg/npm/ghostscript<').length - 1;
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

describe('パッケージページを提出するかの判断', () => {
  it('結論が変わらなくても、義務があれば載せる', () => {
    // MPL / EPL / CDDL はどの配布モデルでも allowed で、**義務も配布モデルで
    // 変わらない**。だから「結論が分かれるか」でも「義務が分かれるか」でも
    // 引っ掛からず、1 件も載っていなかった。
    //
    // だが同じ allowed でも中身が MIT とは違う。表示を残すだけの MIT に対し、
    // こちらは改変したファイルのソースを渡す義務が付く。**そこが知りたくて
    // 調べに来る。** mdbook・syncthing・Consul・Vault・pikepdf・jointjs――
    // 許容ライセンスの次に多い層が丸ごと落ちていた
    for (const id of ['MPL-2.0', 'EPL-2.0', 'CDDL-1.0', 'MS-PL']) {
      const rows = verdictMatrix(id, 'runtime', 'dynamic');
      expect(new Set(rows.map((r) => r.verdict)).size, id).toBe(1);
      expect(new Set(rows.map((r) => r.obligations.join('+'))).size, id).toBe(1);
      expect(packagePageSaysSomething(id), id).toBe(true);
    }
  });

  it('許容ライセンスは載せない', () => {
    // 義務が attribution だけ＝表示を残す以外にすることが無い。
    // ページの中身はライセンスページの言い直しになる
    for (const id of ['MIT', 'BSD-3-Clause', 'ISC', 'Apache-2.0', 'Unlicense', '0BSD']) {
      expect(packagePageSaysSomething(id), id).toBe(false);
    }
  });

  it('コピーレフトは引き続き載せる', () => {
    for (const id of ['GPL-3.0-only', 'AGPL-3.0-only', 'LGPL-3.0-only']) {
      expect(packagePageSaysSomething(id), id).toBe(true);
    }
  });

  it('ソース利用可型は載せる', () => {
    // 全モデル review・義務なしで並ぶので、行列だけを見ると
    // 「解釈できなかった文字列」と完全に同じ形をしている。
    // 分類表に載っていることで区別する
    for (const id of ['BUSL-1.1', 'SSPL-1.0', 'Elastic-2.0']) {
      expect(packagePageSaysSomething(id), id).toBe(true);
    }
  });

  it('UNLICENSED は載せない（非公開パッケージの名前になる）', () => {
    // 実際に npm の color-name が MIT と unlicensed の両方で記録されていた。
    // 同名の私物が誰かの lockfile に入っていたということで、どちらの行を
    // 見るかで判定が変わる。公開されている MIT のパッケージについて
    // 「許諾は無い」と書いたページを提出する側に倒れうる。
    // 加えて、非公開パッケージの名前を検索結果に出すこと自体をしない
    expect(packagePageSaysSomething('UNLICENSED')).toBe(false);
    expect(packagePageSaysSomething('unlicensed')).toBe(false);
    // Unlicense（パブリックドメインへの放棄）は 1 文字違いの別物。
    // こちらは義務が無いので、いずれにせよ載らない
    expect(packagePageSaysSomething('Unlicense')).toBe(false);
  });

  it('読めない文字列は載せない', () => {
    // 上と同じ「全モデル review・義務なし」でも、こちらは分類できない。
    // ページは「分かりません」としか言わないので、検索から来た人の役に立たない。
    // npm の "SEE LICENSE IN ..." や ClearlyDefined の NOASSERTION が該当する
    for (const junk of [
      'SEE LICENSE IN LICENSE.md',
      'Commercial',
      'https://example.com/license',
      'NOASSERTION',
    ]) {
      expect(packagePageSaysSomething(junk), junk).toBe(false);
    }
  });
});
