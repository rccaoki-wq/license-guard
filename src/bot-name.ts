/**
 * クローラーの名前を、**有限の集合**に潰して返す。
 *
 * なぜ必要か。到達記録は bot / browser / unknown の 3 値しか持っておらず、
 * 「ボットが 16 回来た」までは言えるのに「AI 検索のクローラーが来たか」が
 * 一切分からない。AI 検索に引っかかっているかを判定したいのに、
 * その判定に使える観測が無い状態だった。
 *
 * **索引クローラーと実時間フェッチを分ける。** ここが肝心。
 *   - `GPTBot` / `ClaudeBot` / `CCBot` — 学習用の収集。来ても引用は増えない
 *   - `OAI-SearchBot` / `PerplexityBot` — 検索索引の構築。引用の前提条件
 *   - `ChatGPT-User` / `Claude-User` / `Perplexity-User` — **利用者の質問に答えるための取得**
 *
 * 最後の 1 群が出た時点で「誰かが AI に聞き、AI がこのサイトを開いた」が確定する。
 * それが施策の成否を示す唯一の直接証拠なので、他と混ぜない。
 *
 * 生の User-Agent は保存しない方針は変えない。ここが返すのは
 * 下の BOT_NAMES に列挙した固定の語だけで、未知は 'other' に落ちる。
 */

/** 記録しうる値。ここに無い文字列は絶対に出さない */
export const BOT_NAMES = [
  // 利用者の質問に答えるための実時間フェッチ（＝引用が起きている証拠）
  'chatgpt-user',
  'claude-user',
  'perplexity-user',
  // AI 検索の索引クローラー
  'oai-searchbot',
  'perplexitybot',
  'bingbot',
  'duckduckbot',
  // 学習コーパスの収集
  'gptbot',
  'claudebot',
  'ccbot',
  'google-extended',
  'bytespider',
  'meta-externalagent',
  'amazonbot',
  'applebot-extended',
  // 従来の検索
  'googlebot',
  'yandexbot',
  'applebot',
  'seznambot',
  'naver',
  // それ以外
  'other',
  'none',
] as const;

export type BotName = (typeof BOT_NAMES)[number];

/**
 * 判定順に意味がある。**長い名前・具体的な名前を先に置く。**
 * `ChatGPT-User` は文字列として `GPTBot` を含まないが、`Applebot-Extended` は
 * `Applebot` を含み、`Google-Extended` と `Googlebot` は接頭辞が重なる。
 * 先に一般名を当てると、区別したかった方が永久に現れなくなる。
 */
const PATTERNS: ReadonlyArray<readonly [RegExp, BotName]> = [
  [/ChatGPT-User/i, 'chatgpt-user'],
  [/Claude-User/i, 'claude-user'],
  [/Perplexity-User/i, 'perplexity-user'],
  [/OAI-SearchBot/i, 'oai-searchbot'],
  [/PerplexityBot/i, 'perplexitybot'],
  [/GPTBot/i, 'gptbot'],
  [/ClaudeBot|anthropic-ai/i, 'claudebot'],
  [/CCBot/i, 'ccbot'],
  [/Google-Extended/i, 'google-extended'],
  [/Applebot-Extended/i, 'applebot-extended'],
  [/Bytespider/i, 'bytespider'],
  [/meta-externalagent|FacebookBot/i, 'meta-externalagent'],
  [/Amazonbot/i, 'amazonbot'],
  [/bingbot|BingPreview|adidxbot/i, 'bingbot'],
  [/DuckDuckBot|DuckAssistBot/i, 'duckduckbot'],
  [/Googlebot|Google-InspectionTool|Storebot-Google/i, 'googlebot'],
  [/YandexBot|YandexRenderResourcesBot/i, 'yandexbot'],
  [/SeznamBot/i, 'seznambot'],
  [/Yeti\/|NaverBot/i, 'naver'],
  [/Applebot/i, 'applebot'],
];

/**
 * ボットでないクライアントには 'none' を返す。
 * 呼び出し側で `clientKind === 'bot'` の分岐を書かせないため、
 * 判定はこの関数の中だけに置く。
 */
export function classifyBot(userAgent: string | null | undefined, isBot: boolean): BotName {
  if (!isBot) return 'none';
  if (typeof userAgent !== 'string') return 'other';

  const ua = userAgent.trim();
  if (ua === '' || ua.length > 512) return 'other';

  for (const [re, name] of PATTERNS) {
    if (re.test(ua)) return name;
  }
  return 'other';
}

/** 実時間フェッチ＝利用者の質問に答えるために開かれた、の判定 */
export function isLiveAiFetch(bot: BotName): boolean {
  return bot === 'chatgpt-user' || bot === 'claude-user' || bot === 'perplexity-user';
}

/** AI 検索の索引づくり。引用の前提条件だが、それ自体は引用ではない */
export function isAiIndexer(bot: BotName): boolean {
  return bot === 'oai-searchbot' || bot === 'perplexitybot' || bot === 'bingbot' || bot === 'duckduckbot';
}
