/**
 * MCP 利用の計測。
 *
 * Phase 0 の検証指標は「導入数」と「継続呼び出し数」であり、
 * それを測るのに必要な最小限だけを記録する。
 *
 * この行に保存しないもの: パッケージ名、マニフェスト本文、IPアドレス。
 * マニフェストには社内限りのパッケージ名が含まれうる。ライセンス
 * コンプライアンスの製品が、預かる必要のない情報を預かるべきではない。
 *
 * ただし「サービス全体がパッケージ名を保存しない」ではない。解決に成功した
 * ルックアップは license_cache に残り、それが /sitemap.xml の出所になる。
 * 成り立っているのは次の3つ: 誰が訊いたかの列が無い（migrations/0001_init.sql）、
 * 解決できなかった名前は書かない（src/resolver/index.ts）、
 * 入っているのは公開レジストリに既にある名前だけ。README の Privacy 節と対にすること。
 *
 * **帰属について。** ステートレスな Streamable HTTP では clientInfo が
 * initialize にしか来ない。そのため当初 tool_call 行の client_name は
 * 常に NULL で、自分のテスト・巡回クローラー・実利用者を区別できなかった。
 * 仕様が定める Mcp-Session-Id を発行して全イベントに記録し、集計時に
 * initialize 行と結合することで解決している。session_id は不透明な
 * ランダム値であり、上記の非保存方針は変えていない。
 */
export interface McpEvent {
  event: 'initialize' | 'tool_call';
  tool?: string;
  ecosystem?: string;
  distributionModel?: string;
  verdict?: string;
  clientName?: string;
  clientVersion?: string;
  /** initialize で発行、または クライアントが送り返してきたセッション ID */
  sessionId?: string;
  /** 自分の E2E など、実需要として数えてはいけないトラフィック */
  synthetic?: boolean;
}

export type Recorder = (event: McpEvent) => void;

/** 文字列を保存前に短く刈る。長い値で行が膨らむのを防ぐ */
function trim(v: unknown, max = 64): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
}

/**
 * 合成トラフィックの申告ヘッダ。
 *
 * 自己申告であることは承知のうえで採用している。付けられて困るのは
 * 「自分の行が集計から外れる」ことだけで、他人の数字を膨らませたり
 * 減らしたりはできない。逆に、これが無いと自分の E2E を永久に
 * 実需要と区別できない。
 */
export const SYNTHETIC_HEADER = 'x-licenseguard-synthetic';

export function isSyntheticRequest(headers: Headers): boolean {
  const v = headers.get(SYNTHETIC_HEADER);
  return v === '1' || v?.toLowerCase() === 'true';
}

/**
 * セッション ID は 0x21-0x7E の可視 ASCII のみ（仕様）。
 * クライアントが送り返してくる値は外部入力なので、保存前に確かめる。
 */
export function sanitizeSessionId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > 128) return null;
  for (const ch of v) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x21 || cp > 0x7e) return null;
  }
  return v;
}

export function createD1Recorder(
  db: D1Database,
  waitUntil?: (p: Promise<unknown>) => void,
): Recorder {
  return (e) => {
    const promise = db
      .prepare(
        `INSERT INTO mcp_events
           (event, tool, ecosystem, distribution_model, verdict,
            client_name, client_version, session_id, synthetic, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        e.event,
        trim(e.tool),
        trim(e.ecosystem, 16),
        trim(e.distributionModel, 32),
        trim(e.verdict, 16),
        trim(e.clientName),
        trim(e.clientVersion, 32),
        trim(e.sessionId, 128),
        e.synthetic ? 1 : 0,
        Date.now(),
      )
      .run()
      // 計測の失敗を呼び出し側の失敗にしない
      .catch(() => undefined);

    // 応答をブロックしない
    if (waitUntil) waitUntil(promise);
  };
}
