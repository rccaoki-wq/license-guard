import { fetchDepsDevGoLicense } from './depsdev';
import { fetchGoLicense } from './clearlydefined';
import { fetchRepoLicense } from './repo-license';
import type { LicenseLookup } from './index';

/**
 * Go のライセンス解決。deps.dev を先に引き、駄目なら ClearlyDefined。
 *
 * 順序は計測で決めた。固定版に対する解決率は deps.dev が 98〜100%、
 * ClearlyDefined が 38%。しかも ClearlyDefined は未収録の座標で
 * その場 harvest を始めるため、外れた時ほど遅い。先に速くて当たる方を
 * 引き、残りだけを遅い方に回すのが素直な並び。
 *
 * ClearlyDefined を残すのは、両方を突き合わせた 90 座標のうち
 * deps.dev が答えられなかったものが 2 件あったため。上位集合ではあるが
 * 全集合ではないので、落とすと今より解決率が下がる座標が実在する。
 *
 * 出所は混ぜない。どちらが答えたかを `source` で持ち上げ、
 * 利用者には「どこから読んだか」をそのまま出す。速い方に統一した都合で
 * 全部 clearlydefined と表示するのは、単に嘘になる。
 *
 * **版を指定しない問いだけは、先にリポジトリの LICENSE を読む。**
 * 版が無いとき deps.dev は何も答えず（`version === null` で即 null）、
 * ClearlyDefined の「最新」推測だけが残る。それが古びていて、
 * Vault / Consul / Terraform / Nomad を MPL-2.0 と表示していた——実際は
 * 2023 年に BUSL-1.1 へ移行済みで、**許容側に外していた**。
 * 版を指定しない問いは「今このプロジェクトは何か」なので、
 * 収録済みスキャン結果より既定ブランチの LICENSE のほうが直接答えている。
 *
 * 版が指定されている場合はここを通さない。その版の答えは deps.dev が正しく、
 * Vault v1.9 は本当に MPL-2.0 だった。**過去の版に今の LICENSE を
 * かぶせてはならない。**
 */
export async function fetchGoLicenseWithFallback(
  modulePath: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseLookup> {
  if (version === null) {
    const repo = await fetchRepoLicense(modulePath, fetchImpl);
    if (repo.spdx !== null) return repo;
  }

  const primary = await fetchDepsDevGoLicense(modulePath, version, fetchImpl);
  if (primary.spdx !== null) return { ...primary, source: 'deps-dev' };

  return fetchGoLicense(modulePath, version, fetchImpl);
}
