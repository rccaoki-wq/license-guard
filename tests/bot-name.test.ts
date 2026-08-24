import { describe, it, expect } from 'vitest';
import { BOT_NAMES, classifyBot, isAiIndexer, isLiveAiFetch, type BotName } from '../src/bot-name';

/** 実物の User-Agent。ここを想像で書くと、判定は本番だけ外れる */
const REAL: ReadonlyArray<readonly [string, BotName]> = [
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    'chatgpt-user',
  ],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    'oai-searchbot',
  ],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot', 'gptbot'],
  ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'claudebot'],
  ['Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)', 'claude-user'],
  ['Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'perplexitybot'],
  ['Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)', 'perplexity-user'],
  ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'bingbot'],
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'googlebot'],
  ['Mozilla/5.0 (compatible; Google-Extended/1.0)', 'google-extended'],
  ['Mozilla/5.0 (compatible; CCBot/2.0; https://commoncrawl.org/faq/)', 'ccbot'],
  ['Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)', 'bytespider'],
  ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', 'meta-externalagent'],
  ['Mozilla/5.0 (compatible; DuckDuckBot/1.1; +http://duckduckgo.com/duckduckbot.html)', 'duckduckbot'],
  ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'yandexbot'],
  ['Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)', 'amazonbot'],
  ['Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)', 'applebot'],
  ['Mozilla/5.0 (compatible; Applebot-Extended/0.1; +http://www.apple.com/go/applebot)', 'applebot-extended'],
  ['Mozilla/5.0 (compatible; SeznamBot/4.0; +http://napoveda.seznam.cz/en/seznambot-intro/)', 'seznambot'],
];

describe('classifyBot', () => {
  for (const [ua, expected] of REAL) {
    it(`${expected} を見分ける`, () => {
      expect(classifyBot(ua, true)).toBe(expected);
    });
  }

  it('ボットでなければ none。UA が何であれ名前を付けない', () => {
    expect(classifyBot('Mozilla/5.0 ... Chrome/120.0.0.0 Safari/537.36', false)).toBe('none');
    expect(classifyBot('Mozilla/5.0 (compatible; GPTBot/1.2)', false)).toBe('none');
  });

  it('名乗らないボットは other。捨てない', () => {
    expect(classifyBot('curl/8.4.0', true)).toBe('other');
    expect(classifyBot(null, true)).toBe('other');
    expect(classifyBot('', true)).toBe('other');
  });

  it('異常に長い UA は other。正規表現を長文に当て続けない', () => {
    expect(classifyBot('GPTBot ' + 'x'.repeat(600), true)).toBe('other');
  });

  it('返す値は必ず BOT_NAMES の中にある。生の UA が漏れない', () => {
    const inputs = [...REAL.map(([ua]) => ua), 'curl/8.4.0', 'Secret-Internal-Agent/9', '', null];
    for (const ua of inputs) {
      expect(BOT_NAMES).toContain(classifyBot(ua, true));
    }
  });

  it('接頭辞が重なる組を取り違えない', () => {
    // Google-Extended を Googlebot に落とすと「学習収集」と「検索索引」が混ざる
    expect(classifyBot('Mozilla/5.0 (compatible; Google-Extended/1.0)', true)).not.toBe('googlebot');
    // Applebot-Extended も同じ
    expect(classifyBot('Mozilla/5.0 (compatible; Applebot-Extended/0.1)', true)).not.toBe('applebot');
    // ChatGPT-User を GPTBot に落とすと、引用の証拠が学習収集に紛れる
    expect(classifyBot('Mozilla/5.0 (compatible; ChatGPT-User/1.0)', true)).not.toBe('gptbot');
  });
});

describe('用途の区別', () => {
  it('実時間フェッチだけが引用の証拠', () => {
    expect(isLiveAiFetch('chatgpt-user')).toBe(true);
    expect(isLiveAiFetch('claude-user')).toBe(true);
    expect(isLiveAiFetch('perplexity-user')).toBe(true);
    // 学習収集は来ても引用されたことにならない
    expect(isLiveAiFetch('gptbot')).toBe(false);
    expect(isLiveAiFetch('claudebot')).toBe(false);
    expect(isLiveAiFetch('oai-searchbot')).toBe(false);
  });

  it('索引クローラーは前提条件であって引用ではない', () => {
    expect(isAiIndexer('oai-searchbot')).toBe(true);
    expect(isAiIndexer('bingbot')).toBe(true);
    expect(isAiIndexer('gptbot')).toBe(false);
    expect(isAiIndexer('none')).toBe(false);
  });

  it('人間が AI 由来に数えられることはない', () => {
    expect(isLiveAiFetch('none')).toBe(false);
    expect(isAiIndexer('none')).toBe(false);
  });
});
