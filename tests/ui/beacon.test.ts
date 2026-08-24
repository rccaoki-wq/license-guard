/**
 * 到達ビーコンがすべてのページに入っていること。
 *
 * **実際に壊れていた形の回帰テスト。** ビーコンはレイアウトの任意 `script`
 * に相乗りしていて、渡していたのはトップページだけだった。検索向けに
 * 874 枚を用意しておきながら、そこへの着地は 1 件も記録していなかった。
 * それでもレポートは「到達 14 件」と出し続け、私はそれを
 * サイト全体の数字として読んでいた。**壊れても例外は出ない。**
 */
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/ui/page';
import { renderLicenseIndex, renderLicensePage } from '../../src/ui/license';
import { renderCompareIndex, renderComparePage, findPair } from '../../src/ui/compare';
import { renderPackagePage } from '../../src/ui/pkg';
import { findLicense } from '../../src/seo/catalog';

const pages: Array<[string, string]> = [
  ['トップ', renderPage()],
  ['ライセンス一覧', renderLicenseIndex()],
  ['ライセンス詳細', renderLicensePage(findLicense('MIT')!)],
  ['比較一覧', renderCompareIndex()],
  ['比較詳細', renderComparePage(findPair('mit', 'apache-2.0')!)!],
  ['パッケージ', renderPackagePage({ ecosystem: 'npm', name: 'express', spdx: 'MIT' })],
];

describe('全ページに到達計測が入る', () => {
  it.each(pages)('%s', (_name, html) => {
    expect(html).toContain('/api/track');
    expect(html).toContain("__lgTrack('landed')");
  });
});

describe('セッションは訪問者ごとに1つ', () => {
  it('トップページでセッション ID を2重に採らない', () => {
    // 別々に採ると同じ訪問者が2セッションに割れ、到達（分母）と
    // 判定完了（分子）が別人になって率が壊れる
    const html = renderPage();
    expect(html.match(/__lgSid\s*=/g) ?? []).toHaveLength(1);
    // ページ側が自前のセッション変数を作り直していないこと
    expect(html).not.toMatch(/\bconst\s+sid\s*=/);
  });

  it('到達を2回送らない', () => {
    expect(renderPage().match(/'landed'/g) ?? []).toHaveLength(1);
  });

  it('ツールページは共有のセッションを使う', () => {
    expect(renderPage()).toContain('window.__lgTrack');
  });
});

describe('計測が本文を壊さない', () => {
  it.each(pages)('%s は script を閉じたまま', (_name, html) => {
    expect(html.match(/<script/g)?.length).toBe(html.match(/<\/script>/g)?.length);
  });
});
