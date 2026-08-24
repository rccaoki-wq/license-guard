/**
 * 到達を記録するかどうかの判断。
 *
 * この層の失敗は静かに起きる。数えすぎれば流入があるように見え、
 * 数え落とせば「誰も来ていない」と読んでしまう。どちらも例外は出ない。
 */
import { describe, expect, it } from 'vitest';
import { buildPageView, utcDay } from '../src/page-views';
import { BOT_NAMES } from '../src/bot-name';

const SELF = 'license-guard.rcc-aoki.workers.dev';
const AT = Date.UTC(2026, 7, 24, 15, 30);

const req = (o: Partial<{ path: string; status: number; contentType: string | null }> = {}) => ({
  path: '/license/MIT',
  status: 200,
  contentType: 'text/html; charset=utf-8',
  ...o,
});
const hdr = (o: Partial<{ userAgent: string | null; referer: string | null; synthetic: boolean }> = {}) => ({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  referer: null,
  synthetic: false,
  ...o,
});

describe('記録する到達', () => {
  it('SEO ページを数える（これが入っていなかったので作った）', () => {
    const row = buildPageView(req(), hdr(), SELF, AT);
    expect(row).not.toBeNull();
    expect(row!.page).toBe('license:MIT');
    expect(row!.clientKind).toBe('browser');
  });

  it('Markdown 版も数える', () => {
    const row = buildPageView(
      req({ path: '/license/MIT.md', contentType: 'text/markdown; charset=utf-8' }),
      hdr(),
      SELF,
      AT,
    );
    expect(row?.page).toBe('license:MIT');
  });

  it('JS を実行しないクローラーも数える', () => {
    // ビーコン方式では原理的に取れない。索引されているかはここでしか分からない
    const row = buildPageView(req(), hdr({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }), SELF, AT);
    expect(row?.clientKind).toBe('bot');
  });

  it('どのクローラーかを残す', () => {
    // 「ボットが 16 回来た」では AI 検索に載っているかを判定できない
    const row = buildPageView(
      req(),
      hdr({ userAgent: 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)' }),
      SELF,
      AT,
    );
    expect(row?.bot).toBe('oai-searchbot');
  });

  it('人間の行は bot を none にする', () => {
    // 'other' にすると、あとから人間とボットを足し合わせてしまう
    expect(buildPageView(req(), hdr(), SELF, AT)!.bot).toBe('none');
  });

  it('日付は UTC で切る', () => {
    // 実行環境のタイムゾーンで境界が動くと、日次の比較が静かにずれる
    expect(buildPageView(req(), hdr(), SELF, AT)!.day).toBe('2026-08-24');
    expect(utcDay(Date.UTC(2026, 7, 24, 23, 59))).toBe('2026-08-24');
    expect(utcDay(Date.UTC(2026, 7, 25, 0, 0))).toBe('2026-08-25');
  });
});

describe('記録しない到達', () => {
  it('404 を到達に数えない', () => {
    expect(buildPageView(req({ status: 404 }), hdr(), SELF, AT)).toBeNull();
  });

  it('JSON API を人の到達に数えない', () => {
    expect(buildPageView(req({ path: '/api/scan', contentType: 'application/json' }), hdr(), SELF, AT)).toBeNull();
  });

  it('資産と計測経路を数えない', () => {
    for (const p of ['/favicon.svg', '/robots.txt', '/sitemap.xml', '/api/track']) {
      expect(buildPageView(req({ path: p, contentType: 'text/html' }), hdr(), SELF, AT), p).toBeNull();
    }
  });

  it('content-type が無ければ数えない', () => {
    expect(buildPageView(req({ contentType: null }), hdr(), SELF, AT)).toBeNull();
  });
});

describe('自分の検証を実需要から外す', () => {
  it('印のあるリクエストに synthetic を立てる', () => {
    expect(buildPageView(req(), hdr({ synthetic: true }), SELF, AT)!.synthetic).toBe(1);
    expect(buildPageView(req(), hdr(), SELF, AT)!.synthetic).toBe(0);
  });
});

describe('保存する値の制約', () => {
  it('パッケージ名を行に残さない', () => {
    const row = buildPageView(req({ path: '/pkg/npm/acme-internal-billing' }), hdr(), SELF, AT);
    expect(JSON.stringify(row)).not.toContain('acme-internal');
    expect(row?.page).toBe('pkg');
  });

  it('User-Agent の原文を行に残さない', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36';
    const row = buildPageView(req(), hdr({ userAgent: ua }), SELF, AT);
    expect(JSON.stringify(row)).not.toContain('Mozilla');
    expect(['bot', 'browser', 'unknown']).toContain(row!.clientKind);
  });

  it('クローラー名も有限の集合に潰す。原文を通さない', () => {
    const ua = 'Mozilla/5.0 (compatible; SomeInternalCrawler/1.0; +https://corp.example/secret-project)';
    const row = buildPageView(req(), hdr({ userAgent: ua }), SELF, AT);
    expect(JSON.stringify(row)).not.toContain('secret-project');
    expect(JSON.stringify(row)).not.toContain('SomeInternalCrawler');
    expect(BOT_NAMES).toContain(row!.bot);
  });

  it('検索語を行に残さない', () => {
    const row = buildPageView(req(), hdr({ referer: 'https://www.google.com/search?q=secret-thing' }), SELF, AT);
    expect(JSON.stringify(row)).not.toContain('secret-thing');
    expect(row?.source).toBe('search');
  });
});
