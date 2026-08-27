/**
 * 有料監査の提示ページ。
 *
 * **この製品には、実利用者が到達できる「買う口」が一度も無かった。**
 * $199 のレポート CTA は結果画面の下にあり、スキャンを実行しなければ
 * 現れない。2026-08-21 に本物/合成を分離してからの 6 日間で、
 * 到達 38 件・スキャン 0 件。つまり値段はどこにも書かれていないのと
 * 同じ状態が続いていた。
 *
 * ここで固定するのは 3 つ。**買う口が全ページから 1 クリックで届くこと**、
 * **掲示の金額と構造化データの金額がずれないこと**、そして
 * **看板に書いた実測が判定規則と一致していること**。
 * どれも壊れても例外は出ず、型でも実行時でも検出できない。
 */
import { describe, expect, it } from 'vitest';
import { AUDIT_DEP_LIMIT, AUDIT_PRICE_USD, REAUDIT_PRICE_USD, renderAuditPage } from '../../src/ui/audit';
import { renderPage } from '../../src/ui/page';
import { renderLicenseIndex, renderLicensePage } from '../../src/ui/license';
import { renderCompareIndex } from '../../src/ui/compare';
import { renderPackagePage } from '../../src/ui/pkg';
import { findLicense } from '../../src/seo/catalog';
import { buildSitemap } from '../../src/seo/sitemap';
import { classifyPath } from '../../src/page-class';
import { TRACKED_EVENTS } from '../../src/index';
import { evaluateExpression } from '../../src/policy/engine';
import type { DistributionModel, PolicyContext } from '../../src/types';

const ctx = (distributionModel: DistributionModel): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel,
});

/** 提示ページが名前を出している 3 件。トップの掲示と同じ実測 */
const SHOWCASED = [
  { name: 'bundler-audit', spdx: 'GPL-3.0-or-later' },
  { name: 'diff-lcs', spdx: 'MIT AND Artistic-1.0-Perl AND GPL-2.0-or-later' },
  { name: 'rdoc', spdx: 'Ruby AND GPL-2.0-only' },
] as const;

/** JSON-LD を取り出す。掲示と別に持っている唯一の金額なのでここを見る */
function jsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    out.push(JSON.parse(m[1]!.replace(/\\u003c/g, '<')));
  }
  return out;
}

describe('買う口がどのページからも 1 クリックで届く', () => {
  const pages: Array<[string, string]> = [
    ['トップ', renderPage()],
    ['ライセンス一覧', renderLicenseIndex()],
    ['ライセンス詳細', renderLicensePage(findLicense('MIT')!)],
    ['比較一覧', renderCompareIndex()],
    // 到達の大半が落ちるのはここ。874 枚から届かないなら書いていないのと同じ
    ['パッケージ', renderPackagePage({ ecosystem: 'npm', name: 'express', spdx: 'MIT' })],
  ];

  it.each(pages)('%s から /audit へ行ける', (_name, html) => {
    expect(html).toContain('href="/audit"');
  });
});

describe('金額は 1 箇所から出ている', () => {
  it('掲示の金額と構造化データの金額が一致する', () => {
    const html = renderAuditPage();
    const service = jsonLd(html).find(
      (d): d is { '@type': string; offers: { price: string; priceCurrency: string } } =>
        typeof d === 'object' && d !== null && (d as { '@type'?: unknown })['@type'] === 'Service',
    );

    // 構造化データは人間の目に触れないので、片方だけ古い値のまま
    // 何日も外へ配られる。**壊れ方が静かなので突き合わせる**
    expect(service, 'Service の JSON-LD が無い').toBeDefined();
    expect(service!.offers.price).toBe(String(AUDIT_PRICE_USD));
    expect(service!.offers.priceCurrency).toBe('USD');
    expect(html).toContain('$' + AUDIT_PRICE_USD.toLocaleString('en-US'));
  });

  it('再監査と上限件数も掲示に出ている', () => {
    const html = renderAuditPage();
    expect(html).toContain('$' + REAUDIT_PRICE_USD.toLocaleString('en-US'));
    expect(html).toContain(AUDIT_DEP_LIMIT.toLocaleString('en-US'));
  });

  it('再監査は本監査より安い', () => {
    // 逆転しても型では落ちない。値段の意味が壊れていることは掲示にしか出ない
    expect(REAUDIT_PRICE_USD).toBeLessThan(AUDIT_PRICE_USD);
  });
});

describe('提示に書いた実測が判定規則と一致する', () => {
  for (const { name, spdx } of SHOWCASED) {
    it(`${name} は納品時にだけ成果物全体への義務が出る`, () => {
      expect(evaluateExpression(spdx, ctx('internal-only')).obligations, name).not.toContain(
        'same-license',
      );
      expect(evaluateExpression(spdx, ctx('distributed-binary')).obligations, name).toContain(
        'same-license',
      );
    });
  }

  it('3 件の名前と式をそのまま載せている', () => {
    const html = renderAuditPage();
    for (const { name, spdx } of SHOWCASED) {
      expect(html, name).toContain(name);
      expect(html, name).toContain(spdx);
    }
  });
});

describe('売る側の境界を提示から外さない', () => {
  it('法的助言ではないと書いてある', () => {
    // 金額のページだけ免責が緩むと、緩んだ側が引用される
    expect(renderAuditPage()).toContain('not legal advice');
  });

  it('コピーされたコード片は検出しないと書いてある', () => {
    // 買う前に分かるべき最大の限界。売り文句のために落とすと詐欺になる
    const html = renderAuditPage();
    expect(html).toContain('copied into your own source');
    expect(html).toContain('ScanCode');
  });

  it('依頼フォームでマニフェストを貼らせない', () => {
    // 「貼ったものは保存しない」という公開の約束を、金を受け取る口で崩さない
    expect(renderAuditPage()).toContain('Do not paste a manifest');
  });
});

describe('提示ページの計測が成立している', () => {
  it('依頼の送信が受け付けられる事象名である', () => {
    // ページ側が送っていて集合に無いと、例外も 4xx も出ないまま永久に 0 件
    const html = renderAuditPage();
    const sent = [...html.matchAll(/track\('([a-z_]+)'\)/g)].map((m) => m[1]!);
    expect(sent).toContain('audit_request_submitted');
    for (const name of sent) {
      expect(TRACKED_EVENTS.has(name), name).toBe(true);
    }
  });

  it('/audit の到達が other に潰れない', () => {
    // 依頼 0 件を「見られていない」と「見られて断られた」に分ける唯一の分母
    expect(classifyPath('/audit')).toBe('audit');
    expect(classifyPath('/audit/')).toBe('audit');
  });

  it('sitemap に載っている', () => {
    expect(buildSitemap([])).toContain('/audit</loc>');
  });
});
