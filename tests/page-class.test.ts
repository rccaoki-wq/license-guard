/**
 * 到達したページと参照元の分類。
 *
 * ここで一番重い誤りは **利用者が何を調べたかを保存してしまうこと**。
 * `/pkg/npm/<package>` をそのまま記録すると「パッケージ名を保存しない」
 * という約束を破る。壊れても例外は出ないので、テストでしか捕まらない。
 */
import { describe, expect, it } from 'vitest';
import { classifyPath, classifySource, isTrackablePath } from '../src/page-class';

describe('パッケージ名を保存しない', () => {
  it('/pkg 以下は名前を落とす', () => {
    for (const p of [
      '/pkg/npm/express',
      '/pkg/npm/@types/node',
      '/pkg/pypi/requests',
      '/pkg/go/github.com/some/private-thing',
      '/pkg/cargo/serde',
    ]) {
      expect(classifyPath(p), p).toBe('pkg');
    }
  });

  it('戻り値にパッケージ名が残らない', () => {
    // 「分類しているつもりで素通ししていた」を防ぐ。上の toBe と重複して
    // 見えるが、こちらは分類を足したときに壊れて知らせる側
    const secret = 'acme-internal-billing';
    expect(classifyPath(`/pkg/npm/${secret}`)).not.toContain(secret);
    expect(classifyPath(`/api/pkg/npm/${secret}`)).not.toContain(secret);
  });

  it('見覚えのない経路は other に潰す', () => {
    // 素通しすると、いつか個人に紐づく文字列が混ざる
    expect(classifyPath('/u/rcc-aoki/private')).toBe('other');
    expect(classifyPath('/search?q=secret')).toBe('other');
  });
});

describe('経路の分類', () => {
  it('主要ページ', () => {
    expect(classifyPath('/')).toBe('home');
    expect(classifyPath('/licenses')).toBe('licenses');
    expect(classifyPath('/compare')).toBe('compare-index');
  });

  it('ライセンスページは ID を残す（どれに人が来るか知りたい）', () => {
    expect(classifyPath('/license/MIT')).toBe('license:MIT');
    expect(classifyPath('/license/AGPL-3.0-only')).toBe('license:AGPL-3.0-only');
  });

  it('.md 版は HTML 版と同じ扱い', () => {
    // 内容が同じで経路だけ違う。分けると同じページの数字が 2 つに割れる
    expect(classifyPath('/license/MIT.md')).toBe('license:MIT');
  });

  it('比較ページはスラッグを残す', () => {
    expect(classifyPath('/compare/mit-vs-apache-2.0')).toBe('compare:mit-vs-apache-2.0');
  });

  it('末尾スラッシュで別ページにしない', () => {
    expect(classifyPath('/licenses/')).toBe('licenses');
    expect(classifyPath('/')).toBe('home');
  });

  it('ライセンス ID の形をしていなければ潰す', () => {
    expect(classifyPath('/license/' + 'x'.repeat(300))).toBe('license:other');
    expect(classifyPath('/license/%E4%B8%8D%E6%AD%A3')).toBe('license:other');
  });

  it('壊れたパーセント符号化で例外を出さない', () => {
    expect(() => classifyPath('/license/%E0%A4%A')).not.toThrow();
    expect(classifyPath('/license/%E0%A4%A')).toBe('license:other');
  });

  it('戻り値は必ず有限の集合に収まる', () => {
    const allowed = /^(home|licenses|compare-index|pkg|other|license:[^\s]+|compare:[^\s]+)$/;
    for (const p of ['/', '/x', '/pkg/npm/a', '/license/MIT', '/compare/a-vs-b', '//', '/../..']) {
      expect(classifyPath(p), p).toMatch(allowed);
    }
  });
});

describe('記録の対象', () => {
  it('API と資産は数えない', () => {
    for (const p of ['/api/scan', '/api/track', '/favicon.svg', '/robots.txt', '/sitemap.xml', '/llms.txt', '/healthz', '/mcp']) {
      expect(isTrackablePath(p), p).toBe(false);
    }
  });

  it('ページは数える', () => {
    for (const p of ['/', '/licenses', '/license/MIT', '/compare/a-vs-b', '/pkg/npm/x']) {
      expect(isTrackablePath(p), p).toBe(true);
    }
  });
});

describe('参照元の分類', () => {
  const SELF = 'license-guard.rcc-aoki.workers.dev';

  it('検索から来たかどうかが分かる（SEO の成否はここでしか測れない）', () => {
    for (const r of [
      'https://www.google.com/',
      'https://google.co.jp/search?q=agpl',
      'https://www.bing.com/search?q=x',
      'https://duckduckgo.com/',
      'https://search.yahoo.co.jp/search',
    ]) {
      expect(classifySource(r, SELF), r).toBe('search');
    }
  });

  it('AI を検索と混ぜない（打ち手が違う）', () => {
    for (const r of ['https://chatgpt.com/', 'https://claude.ai/chat/x', 'https://www.perplexity.ai/']) {
      expect(classifySource(r, SELF), r).toBe('ai');
    }
  });

  it('gemini.google.com は検索ではなく AI', () => {
    // google. の前方一致に引っかけると AI 流入が検索に化ける
    expect(classifySource('https://gemini.google.com/app', SELF)).toBe('ai');
  });

  it('自サイト内の移動を新規到達に数えない', () => {
    expect(classifySource(`https://${SELF}/licenses`, SELF)).toBe('internal');
  });

  it('参照元なしは direct', () => {
    expect(classifySource(null, SELF)).toBe('direct');
    expect(classifySource(undefined, SELF)).toBe('direct');
    expect(classifySource('', SELF)).toBe('direct');
  });

  it('壊れた Referer を direct に混ぜない', () => {
    // direct は「直接来た」という意味を持つ。解釈できなかったものを
    // そこに入れると、流入の読み方を静かに歪める
    expect(classifySource('not a url', SELF)).toBe('other');
  });

  it('SNS と技術コミュニティ', () => {
    for (const r of ['https://news.ycombinator.com/', 'https://www.reddit.com/r/x', 'https://zenn.dev/a']) {
      expect(classifySource(r, SELF), r).toBe('social');
    }
  });

  it('戻り値は 6 値のみ', () => {
    const allowed = ['direct', 'internal', 'search', 'ai', 'social', 'other'];
    for (const r of [null, '', 'x', 'https://example.com/', 'https://google.com/', `https://${SELF}/`]) {
      expect(allowed).toContain(classifySource(r, SELF));
    }
  });

  it('検索語を保存しない', () => {
    // ホスト名だけ見て分類し、分類結果しか残さない
    expect(classifySource('https://www.google.com/search?q=my-secret-package', SELF)).toBe('search');
  });
});
