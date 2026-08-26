import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/ui/page';
import { evaluateExpression } from '../../src/policy/engine';
import type { DistributionModel, PolicyContext } from '../../src/types';

/**
 * トップページは、入力欄の前に**実測した結論を静的な HTML で**出している。
 *
 * 2026-08-21 に本物/合成の分離を入れてからの 6 日間、到達 38 件に対して
 * スキャン実行は 0 件だった。空のテキストエリアを先に置くと、見知らぬ製品の
 * ために誰もロックファイルを探さない。だから結論を先に見せることにした。
 *
 * **ここに書いた数字は、判定規則が変われば黙って嘘になる。**しかも静的な
 * 文字列なので型でも実行時でも検出できず、壊れたことは誰にも分からない。
 * 義務を過少に言わないことがこの製品の唯一の取り柄なので、看板で
 * それを破るのが最悪の失敗になる。掲示と規則をここで結びつけて固定する。
 *
 * 数値の出所: 2026-08-26、本番 /api/scan に実在の Gemfile.lock（344 依存）を
 * 全 5 配布形態で流した実測。internal-only は blocked 0、distributed-binary は
 * blocked 3。
 */
const ctx = (distributionModel: DistributionModel): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel,
});

/** 看板に名前を出している 3 件。式は実測時に上流が返したものそのまま */
const SHOWCASED = [
  { name: 'bundler-audit', version: '0.9.3', spdx: 'GPL-3.0-or-later' },
  { name: 'diff-lcs', version: '1.6.2', spdx: 'MIT AND Artistic-1.0-Perl AND GPL-2.0-or-later' },
  { name: 'rdoc', version: '8.0.0', spdx: 'Ruby AND GPL-2.0-only' },
] as const;

describe('トップの実測ブロックは判定規則と一致している', () => {
  for (const { name, spdx } of SHOWCASED) {
    // 「納品すると義務が出る」と書いている以上、規則もそう言わなければならない
    it(`${name} は納品時に blocked になる`, () => {
      expect(evaluateExpression(spdx, ctx('distributed-binary')).verdict).toBe('blocked');
    });

    /**
     * **差が出ることこそが主張。**両方 blocked になったら「配布形態で変わる」
     * という看板が崩れるが、掲示は静的なので気づけない。厳しい側だけを
     * 確かめると、この崩れ方をちょうど見逃す
     */
    it(`${name} は自社運用なら blocked にならない`, () => {
      expect(evaluateExpression(spdx, ctx('internal-only')).verdict).not.toBe('blocked');
    });
  }

  /**
   * 掲示が数えているのは **same-license**（成果物全体を同じライセンスで出す義務）で、
   * blocked の件数ではない。最初ここを「0 obligations」と書いていたが、
   * `diff-lcs` は MIT を含むので社内利用でも attribution が残る。
   * **判定件数から義務を断言すると、表が正しくても見出しだけが緩い側に外れる。**
   */
  it('社内利用では 3 件とも成果物全体への義務は出ない（掲示の「0 dependencies」）', () => {
    for (const { name, spdx } of SHOWCASED) {
      expect(evaluateExpression(spdx, ctx('internal-only')).obligations, name).not.toContain(
        'same-license',
      );
    }
  });

  it('納品時は 3 件とも成果物全体への義務が出る（掲示の「3 dependencies」）', () => {
    for (const { name, spdx } of SHOWCASED) {
      const obligations = evaluateExpression(spdx, ctx('distributed-binary')).obligations;
      expect(obligations, name).toContain('same-license');
      expect(obligations, name).toContain('source-disclosure');
    }
  });
});

describe('掲示そのものが消えていない', () => {
  /**
   * 規則が正しくても、ページから消えれば起動率の問題は元に戻る。
   * 消したことに気づけるようにしておく
   */
  it('3 件の名前と版が載っている', () => {
    const html = renderPage();
    for (const { name, version } of SHOWCASED) {
      expect(html, name).toContain(name);
      expect(html, name).toContain(version);
    }
  });

  it('式をそのまま載せている（要約して緩めない）', () => {
    const html = renderPage();
    for (const { name, spdx } of SHOWCASED) {
      expect(html, name).toContain(spdx);
    }
  });

  /** 入力欄より前に出ていなければ、見せる前に離脱するので意味がない */
  it('実測ブロックはマニフェスト入力欄より前にある', () => {
    const html = renderPage();
    expect(html.indexOf('class="proof"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="proof"')).toBeLessThan(html.indexOf('<textarea'));
  });

  /** クリックを挟むと 6 日間 0 回だった「例を見る」と同じ壁に戻る */
  it('クリックや取得を待たずに初回描画へ載っている', () => {
    const html = renderPage();
    const proof = html.slice(html.indexOf('class="proof"'), html.indexOf('<textarea'));
    expect(proof).not.toContain('hidden');
    expect(proof).not.toContain('addEventListener');
  });
});
