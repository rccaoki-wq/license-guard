import { afterEach, beforeEach } from 'vitest';

/**
 * 上流レジストリへ出ないようにする。
 *
 * これが要る理由。`fakeEnv()` は D1 しか差し替えていないため、`app.request()`
 * を通るテストは **実際に proxy.golang.org や ClearlyDefined を叩いていた**。
 * 名前の形式を検証するテストが、第三者サービスの応答時間に依存していたことになる。
 *
 * 手元では通り、CI では 5 秒のタイムアウトに当たって落ちた。ローカルで緑なのに
 * CI で赤くなる類の失敗は、原因が環境に見えるので放置されやすい。実際には
 * テストの依存が間違っていただけだった。
 *
 * 404 を返すのは、解決できなかった場合の経路が既に定義されているため。
 * `/api/pkg` は 200 と `review` を返し、`/pkg/` は 200 と「不明」ページを返す。
 * よって「400 にしない」「404 にしない」という検証はそのまま成立し、
 * **上流に頼らずに名前検証だけを見る**という本来の意図に近づく。
 */
export function useOfflineUpstream(): void {
  const real = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async () =>
      new Response('offline in tests', { status: 404 })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = real;
  });
}
