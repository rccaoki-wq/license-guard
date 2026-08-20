/**
 * 自分の検証トラフィックに印を付ける。
 *
 * これが無いと、本番の計測テーブルに自分の E2E が実利用として混ざる。
 * 実際に混ざった: 初日の mcp_events 981 件・events 63 セッションの
 * ほぼ全部が自分の検証だったのに、あとから区別する手段が無かった。
 *
 * サーバー側は 0/1 を列に落とすだけで、応答は一切変えない。
 * したがって「印を付けたから通った」という検証にはならない。
 */
export const SYNTHETIC_HEADERS = { 'x-licenseguard-synthetic': '1' };

/** init.headers を壊さずに印を足す。呼び出し側の指定を優先する */
export function withSynthetic(init = {}) {
  return { ...init, headers: { ...SYNTHETIC_HEADERS, ...(init.headers || {}) } };
}
