/**
 * URL を「記録してよい粒度」に落とす。
 *
 * **生のパスを保存してはいけない。** `/pkg/npm/<package>` は利用者が何を
 * 調べたかそのものなので、パスをそのまま置くと「パッケージ名を保存しない」
 * という約束を破る。マニフェスト本文と IP を保存しないのと同じ理由で、
 * 経路の記録も同じ制約の下に置く。
 *
 * ライセンス ID は残す。SPDX の識別子は公開された分類であって利用者の
 * 情報ではなく、**どのライセンスのページに人が来るのか**が分からないと
 * 記録する意味がほとんど無い。
 */

/** 記録対象外（資産・API・計測用エンドポイント） */
const IGNORED = /^\/(api|favicon\.svg|robots\.txt|sitemap\.xml|llms\.txt|healthz|mcp)(\/|$)/;

/** ライセンス ID として素直に受け取れる形だけ通す */
const SPDX_SHAPE = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;

export function isTrackablePath(pathname: string): boolean {
  return !IGNORED.test(pathname) && !pathname.startsWith('/.');
}

/**
 * 保存してよい経路クラスに変換する。
 *
 * 戻り値は必ず有限の集合に収まる。未知の経路を素通しすると、いつか
 * 個人に紐づく文字列が混ざる。**分からないものは `other` に潰す。**
 */
export function classifyPath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';

  if (p === '/') return 'home';
  if (p === '/licenses') return 'licenses';
  if (p === '/compare') return 'compare-index';

  // 比較ページのスラッグは自前で作った有限集合なのでそのまま残す
  const cmp = /^\/compare\/([a-z0-9.+-]+-vs-[a-z0-9.+-]+)$/.exec(p);
  if (cmp) return `compare:${cmp[1]}`;

  // ライセンスページ。.md 版も同じ扱いにする（内容が同じで経路だけ違う）
  const lic = /^\/license\/([^/]+?)(\.md)?$/.exec(p);
  if (lic) {
    const id = safeDecode(lic[1]!);
    return id && SPDX_SHAPE.test(id) ? `license:${id}` : 'license:other';
  }

  // **パッケージ名は落とす。** ここが約束を破りうる唯一の経路
  if (/^\/pkg(\/|$)/.test(p)) return 'pkg';

  return 'other';
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * 参照元を、保存してよい 6 値に落とす。
 *
 * **これが無いと SEO の成否が分からない。** 到達数だけ見ても、検索から
 * 来たのか、どこかに貼られたリンクから来たのか、自分が開いたのかを
 * 区別できない。874 枚のページを作った投資が効いているかは、
 * 「検索から来た人間の到達」でしか測れない。
 *
 * URL 全体は保存しない。検索語がクエリに残っている場合があり、
 * それは利用者が何を調べたかそのものなので、ホスト名だけを見て分類し、
 * 分類結果しか残さない。
 */
export type Source = 'direct' | 'internal' | 'search' | 'ai' | 'social' | 'other';

/** AI を先に見る。gemini.google.com は検索ではない */
const AI_HOSTS = [
  'chatgpt.com', 'chat.openai.com', 'openai.com', 'claude.ai', 'perplexity.ai',
  'gemini.google.com', 'copilot.microsoft.com', 'poe.com', 'phind.com', 'you.com',
];

const SEARCH_HOSTS = [
  'google.', 'bing.com', 'duckduckgo.com', 'search.yahoo.', 'yahoo.co.jp',
  'baidu.com', 'yandex.', 'ecosia.org', 'search.brave.com', 'startpage.com',
  'search.marginalia.nu', 'mojeek.com', 'qwant.com',
];

const SOCIAL_HOSTS = [
  'reddit.com', 'news.ycombinator.com', 'x.com', 'twitter.com', 't.co',
  'linkedin.com', 'lnkd.in', 'mastodon.', 'bsky.app', 'facebook.com',
  'qiita.com', 'zenn.dev', 'note.com', 'hatena.ne.jp',
];

export function classifySource(referer: string | null | undefined, selfHost: string): Source {
  if (typeof referer !== 'string' || referer.trim() === '') return 'direct';

  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return 'other'; // 壊れた Referer。direct に混ぜると流入の解釈を誤る
  }

  if (host === selfHost.toLowerCase() || host.endsWith('.' + selfHost.toLowerCase())) {
    return 'internal';
  }
  if (AI_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return 'ai';
  if (SEARCH_HOSTS.some((h) => (h.endsWith('.') ? host.startsWith(h) || host.includes('.' + h) : host === h || host.endsWith('.' + h)))) {
    return 'search';
  }
  if (SOCIAL_HOSTS.some((h) => (h.endsWith('.') ? host.startsWith(h) : host === h || host.endsWith('.' + h)))) {
    return 'social';
  }
  return 'other';
}
