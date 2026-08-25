import { describe, expect, it } from 'vitest';
import { renderPackageIndex } from '../../src/ui/packages';
import { renderPackagePage } from '../../src/ui/pkg';
import { verdictMatrix } from '../../src/policy/matrix';
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

  // MPL・EPL・CDDL は全モデル allowed だが、リンク方式を変えても答えは
  // 変わらない。ここに LGPL 向けの「静的リンクなら話が違う」を出すと、
  // 読者は義務が無い前提で静的リンクを避けるという逆の対処をする
  it('リンク方式で変わらないものに「リンク方式次第」と書かない', () => {
    for (const spdx of ['MPL-2.0', 'EPL-2.0', 'CDDL-1.0']) {
      const html = renderPackageIndex([{ ecosystem: 'npm', name: 'somelib', spdx }]);
      expect(html, spdx).toContain('/pkg/npm/somelib');
      // JSON-LD にも同じ経路が出るので、一覧の <li> だけを取り出して見る
      const li = /<li><a href="\/pkg\/npm\/somelib">.*?<\/li>/s.exec(html)?.[0] ?? '';
      expect(li, spdx).not.toMatch(/linked dynamically|how it is linked/);
      // 代わりに、何をしなければならないかを書く
      expect(li, spdx).toMatch(/source/i);
    }
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

describe('見出しは表と同じ向きを向く', () => {
  /**
   * **緩い方に外れるのは、この製品が最もしてはいけない誤り。**
   *
   * blocked の有無だけで見出しを分けていたとき、BUSL-1.1 のような
   * ソース利用可型は 1 つも blocked にならないので、5 行すべてが
   * 「要確認」の表の真上に「どの配布形態でもソース開示義務は生じません」と
   * 出ていた。表を読まずに見出しだけ見た人は、配って良いと受け取る。
   */
  it('要確認しか無いライセンスに「開示義務なし」で締めない', () => {
    const html = renderPackagePage({
      ecosystem: 'go',
      name: 'github.com/hashicorp/vault',
      spdx: 'BUSL-1.1',
    });
    expect(html).toContain('Needs review');
    expect(html).not.toContain('no source-disclosure obligation in any of the shipping models');
    // 何を確かめるべきかを言う
    expect(html).toContain('restrict how the software may be used');
  });

  /**
   * 判定と義務は別の軸。MPL-2.0 と EPL-2.0 は全行 allowed だが
   * `source-disclosure` を持つ。評価器が返している義務を、その出力を
   * 描いている見出しが否定してはならない。
   */
  it('全行 allowed でも、開示義務があるなら「無い」と言わない', () => {
    for (const spdx of ['MPL-2.0', 'EPL-2.0']) {
      const rows = verdictMatrix(spdx, 'runtime', 'static');
      expect(rows.every((r) => r.verdict === 'allowed')).toBe(true);
      expect(rows.some((r) => r.obligations.includes('source-disclosure'))).toBe(true);

      const html = renderPackagePage({ ecosystem: 'go', name: 'github.com/x/y', spdx });
      expect(html).not.toContain('no source-disclosure obligation');
      expect(html).toContain('carries a source-disclosure obligation');
    }
  });

  it('本当に緩いものには、残る義務だけを添える', () => {
    const html = renderPackagePage({ ecosystem: 'npm', name: 'express', spdx: 'MIT' });
    expect(html).toContain('no source-disclosure obligation in any of the shipping models');
    // 「開示義務が無い」は「義務が無い」ではない
    expect(html).toContain('Attribution still applies.');
  });

  it('コピーレフトはこれまでどおり件数で言う', () => {
    const html = renderPackagePage({ ecosystem: 'npm', name: 'nodebb', spdx: 'GPL-3.0-only' });
    expect(html).toMatch(/triggers obligations in \d of the 5 common shipping models/);
  });
});

describe('版を補ったときは、ページでそう言う', () => {
  it('LGPL としか宣言していないなら、3.0 を断りなく書かない', () => {
    const html = renderPackagePage({
      ecosystem: 'pypi',
      name: 'psycopg2-binary',
      spdx: 'LGPL',
    });

    // 表の Why は補った後の識別子で書かれている。だから断りが要る
    expect(html).toContain('LGPL-3.0-only');
    expect(html).toContain('&quot;LGPL&quot; does not name a specific version');
    expect(html).toContain('confirm the actual version');

    // 出る場所は「本文の要約」「FAQ」「JSON-LD」の 3 つだけ。
    // 表の 5 行に混ぜると同じ一文が 5 回並び、定型文として読み飛ばされる
    expect(html.split('does not name a specific version').length - 1).toBe(3);
    expect(html).not.toContain(
      '<td>&quot;LGPL&quot; does not name a specific version',
    );
  });

  it('版まで宣言されているものに断りを足さない', () => {
    for (const spdx of ['MIT', 'Apache-2.0', 'AGPL-3.0-only']) {
      const html = renderPackagePage({ ecosystem: 'npm', name: 'x', spdx });
      expect(html).not.toContain('does not name a specific version');
    }
  });
});
