/**
 * 打ち切り（not-checked）の告知と、待ち時間の表示。
 *
 * どちらも**沈黙が誤解を生む**箇所。limits は findings の後ろにあり、
 * 依存が数百件あると誰も辿り着かない。実物の go.sum（299件）では
 * 276 件が未確認でも、画面上部には「Needs review 285」としか出ず、
 * なぜそうなったかは最下部にしか無かった。
 *
 * 待ち時間の方も同じ。上流の照会が律速で 20 秒近くかかるのに
 * 「Checking...」のまま無言なので、壊れていると判断されて離脱する。
 */
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/ui/page';

describe('部分的な結果の告知', () => {
  const html = renderPage();

  it('告知の枠が findings より前にある', () => {
    const notice = html.indexOf('id="notice"');
    const findings = html.indexOf('id="findings"');
    expect(notice).toBeGreaterThan(-1);
    expect(findings).toBeGreaterThan(-1);
    // 後ろに置くと、まさに告知が必要な「依存が多い場合」に読まれなくなる
    expect(notice).toBeLessThan(findings);
  });

  it('not-checked の件数を数えて告知する', () => {
    expect(html).toContain("f.resolvedFrom === 'not-checked'");
    expect(html).toContain('were not checked');
  });

  it('未確認を「問題なし」と混同させない文言である', () => {
    expect(html).toContain('rather than as clear');
  });
});

describe('待ち時間の表示', () => {
  const html = renderPage();

  it('経過秒を出し、終了時に必ず止める', () => {
    expect(html).toContain('id="progress"');
    expect(html).toContain("btn.textContent = 'Checking... '");
    // 止め忘れるとタイマーが残り、次のスキャンで二重に動く
    expect(html).toContain('clearInterval(ticker)');
  });

  it('なぜ待たされるかを説明する', () => {
    expect(html).toContain('fetched from public registries');
  });
});
