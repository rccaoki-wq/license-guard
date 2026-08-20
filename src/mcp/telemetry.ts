/**
 * MCP 利用の計測。
 *
 * Phase 0 の検証指標は「導入数」と「継続呼び出し数」であり、
 * それを測るのに必要な最小限だけを記録する。
 *
 * 保存しないもの: パッケージ名、マニフェスト本文、IPアドレス。
 * マニフェストには社内限りのパッケージ名が含まれうる。ライセンス
 * コンプライアンスの製品が、預かる必要のない情報を預かるべきではない。
 */
export interface McpEvent {
  event: 'initialize' | 'tool_call';
  tool?: string;
  ecosystem?: string;
  distributionModel?: string;
  verdict?: string;
  clientName?: string;
  clientVersion?: string;
}

export type Recorder = (event: McpEvent) => void;

/** 文字列を保存前に短く刈る。長い値で行が膨らむのを防ぐ */
function trim(v: unknown, max = 64): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
}

export function createD1Recorder(
  db: D1Database,
  waitUntil?: (p: Promise<unknown>) => void,
): Recorder {
  return (e) => {
    const promise = db
      .prepare(
        `INSERT INTO mcp_events
           (event, tool, ecosystem, distribution_model, verdict, client_name, client_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        e.event,
        trim(e.tool),
        trim(e.ecosystem, 16),
        trim(e.distributionModel, 32),
        trim(e.verdict, 16),
        trim(e.clientName),
        trim(e.clientVersion, 32),
        Date.now(),
      )
      .run()
      // 計測の失敗を呼び出し側の失敗にしない
      .catch(() => undefined);

    // 応答をブロックしない
    if (waitUntil) waitUntil(promise);
  };
}
