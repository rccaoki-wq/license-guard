/**
 * クライアント種別の分類。
 *
 * 一番避けたい誤りは **ボットを人間に数えること**。需要を過大評価して
 * 判断を誤る。逆に人間を unknown に落としても、過小評価に倒れるだけで
 * 判断は誤らない。テストもその非対称性に合わせてある。
 */
import { describe, expect, it } from 'vitest';
import { classifyClient } from '../src/client-kind';

describe('実ブラウザ', () => {
  const browsers = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  ];

  it('browser と判定する', () => {
    for (const ua of browsers) expect(classifyClient(ua), ua.slice(0, 40)).toBe('browser');
  });
});

describe('ボット', () => {
  const bots = [
    // AI 検索のクローラー。ここを人間に数えると到達を読み違える
    'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; YandexBot/3.0)',
    'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl)',
    // 自動化ブラウザ。E2E や描画チェックがここに来る
    'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Puppeteer',
    // 素のHTTPクライアント
    'curl/8.4.0',
    'Wget/1.21.3',
    'python-requests/2.31.0',
    'Go-http-client/2.0',
    'node-fetch/1.0',
    'axios/1.6.0',
  ];

  it('bot と判定する（人間に数えない）', () => {
    for (const ua of bots) expect(classifyClient(ua), ua.slice(0, 45)).toBe('bot');
  });

  it('Mozilla を名乗るボットもブラウザにしない', () => {
    // 多くのボットは Mozilla/5.0 を名乗ったうえで自分の名前を足す。
    // ブラウザ判定を先に通すと全部ブラウザになってしまう
    expect(classifyClient('Mozilla/5.0 (compatible; GPTBot/1.2) Chrome/120.0.0.0 Safari/537.36')).toBe('bot');
  });
});

describe('判断できないものは unknown', () => {
  it('欠落・空・非文字列', () => {
    expect(classifyClient(null)).toBe('unknown');
    expect(classifyClient(undefined)).toBe('unknown');
    expect(classifyClient('')).toBe('unknown');
    expect(classifyClient('   ')).toBe('unknown');
    expect(classifyClient(42 as unknown as string)).toBe('unknown');
  });

  it('見覚えのない文字列', () => {
    expect(classifyClient('SomeThingEntirelyNew/1.0')).toBe('unknown');
  });

  it('異常に長い値は相手にしない', () => {
    expect(classifyClient('Chrome/120 ' + 'x'.repeat(600))).toBe('unknown');
  });

  it('unknown は人間ではない（集計側の前提）', () => {
    // 迷ったら unknown に落とす設計なので、unknown を browser に
    // 寄せてはいけない。過大評価より過小評価を選ぶ
    expect(classifyClient('???')).not.toBe('browser');
  });
});

describe('戻り値は3値のみ', () => {
  it('どんな入力でも 3 値のいずれか', () => {
    const inputs = ['', 'x', 'curl/8', 'Chrome/1', null, undefined, 'a'.repeat(1000)];
    for (const i of inputs) {
      expect(['bot', 'browser', 'unknown']).toContain(classifyClient(i as string));
    }
  });
});
