import { fetchJson } from './http';
import { joinLicenses } from './depsdev';
import type { LicenseLookup } from './index';

/**
 * rubygems.org も crates.io と同じく User-Agent を求める。
 * 誰が叩いているかを明示するため、連絡先を兼ねた URL を入れる。
 */
const USER_AGENT = 'licenseguard/1.0 (https://license-guard.rcc-aoki.workers.dev)';

interface GemDoc {
  /** gemspec の `licenses=`。**単一の文字列ではなく必ず配列** */
  licenses?: string[] | null;
}

function withUserAgent(fetchImpl: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(input, {
      ...init,
      headers: { ...(init?.headers ?? {}), 'user-agent': USER_AGENT },
    })) as typeof fetch;
}

/**
 * rubygems.org からライセンスを取得する。
 *
 * deps.dev も RUBYGEMS を持っているが、ここでは一次情報を直接引く。
 * 固定版の口（`/api/v2/rubygems/{gem}/versions/{version}.json`）が
 * そのまま存在し、**版を指定した問いに版そのものの答えが返る**ため、
 * 間に集約者を挟む理由が無い。deps.dev が要るのは Go のように
 * レジストリ側に版ごとのライセンス欄が無い系だけ。
 *
 * **`licenses` は配列で、gemspec は複数を書ける。** これを AND で
 * 綴じるのは deps.dev と同じ判断（`joinLicenses`）。配列そのものは
 * 選択（OR）か累積（AND）かを言っていない——gemspec の仕様は
 * 「ライブラリのライセンス」としか書いていない。分からないときに
 * OR へ倒すと、`["MIT", "GPL-2.0"]` が allowed になって**義務のある側が
 * 消える**。AND へ倒せば過剰警告で済む。**消えるより鳴るほうがいい。**
 */
export async function fetchRubygemsLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseLookup> {
  const f = withUserAgent(fetchImpl);
  const gem = encodeURIComponent(name);

  if (version !== null) {
    const doc = await fetchJson<GemDoc>(
      `https://rubygems.org/api/v2/rubygems/${gem}/versions/${encodeURIComponent(version)}.json`,
      f,
    );
    const spdx = joinLicenses(doc?.licenses ?? undefined);
    if (spdx !== null) return { spdx };
  }

  const doc = await fetchJson<GemDoc>(`https://rubygems.org/api/v1/gems/${gem}.json`, f);
  const spdx = joinLicenses(doc?.licenses ?? undefined);
  if (spdx === null) return { spdx: null };

  // npm / crates / pypi / go と同じ約束。版を指定しない問いに最新を
  // 答えるのは**落ちた**のではなく正しい答えなので fromLatest は立てない
  return version === null ? { spdx } : { spdx, fromLatest: true };
}
