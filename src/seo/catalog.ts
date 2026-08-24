import type { Ecosystem } from '../types';

export interface LicenseEntry {
  /** SPDX 識別子。URL のスラッグも兼ねる */
  id: string;
  /** 検索者が使う通称。h1 とタイトルに使う */
  name: string;
  /**
   * このライセンス固有の一段落説明。
   * ページごとに文面を変えることが薄いコンテンツ判定を避ける唯一の手段なので、
   * テンプレート化せず個別に書く。
   */
  summary: string;
}

/**
 * ページを生成するライセンス。
 * 「commercial use」「SaaS」で実際に検索されるものに絞る。
 */
export const LICENSE_CATALOG: LicenseEntry[] = [
  {
    id: 'MIT',
    name: 'MIT License',
    summary:
      'The most widely used permissive license. It grants nearly unrestricted use in exchange for keeping the copyright notice and license text with the software. There is no source-disclosure requirement and no patent clause.',
  },
  {
    id: 'Apache-2.0',
    name: 'Apache License 2.0',
    summary:
      'Permissive, but with two things MIT lacks: an explicit patent grant from contributors, and a requirement to carry forward any NOTICE file. Companies wary of patent exposure often prefer it over MIT for that reason.',
  },
  {
    id: 'BSD-3-Clause',
    name: 'BSD 3-Clause License',
    summary:
      'Permissive and functionally close to MIT, with an added clause preventing use of the project or contributor names to endorse derived products without permission.',
  },
  {
    id: 'BSD-2-Clause',
    name: 'BSD 2-Clause License',
    summary:
      'Permissive. Identical to BSD 3-Clause minus the no-endorsement clause, making it effectively equivalent to MIT in practice.',
  },
  {
    id: 'ISC',
    name: 'ISC License',
    summary:
      'Permissive, functionally equivalent to MIT with simplified wording. Common across the npm ecosystem and the default for packages created by npm itself.',
  },
  {
    id: 'GPL-2.0-only',
    name: 'GNU General Public License v2.0',
    summary:
      'Strong copyleft. Distributing a work that incorporates GPL-2.0 code requires licensing the whole work under GPL-2.0 and providing corresponding source. It has no network clause, so running it as a hosted service is not distribution.',
  },
  {
    id: 'GPL-3.0-only',
    name: 'GNU General Public License v3.0',
    summary:
      'Strong copyleft, with added anti-tivoization and patent-retaliation terms over v2. Like v2, its obligations attach to distribution, not to operating a hosted service.',
  },
  {
    id: 'LGPL-2.1-only',
    name: 'GNU Lesser General Public License v2.1',
    summary:
      'Weak copyleft aimed at libraries. Modifications to the library itself must be published, but code that merely links against it is not pulled in — provided users can substitute their own build of the library.',
  },
  {
    id: 'LGPL-3.0-only',
    name: 'GNU Lesser General Public License v3.0',
    summary:
      'Weak copyleft built on GPL-3.0 with a linking exception. The practical question is almost always static versus dynamic linking, since static linking triggers the relinking obligation.',
  },
  {
    id: 'AGPL-3.0-only',
    name: 'GNU Affero General Public License v3.0',
    summary:
      'The one that catches SaaS companies. Section 13 extends copyleft across the network: if users interact with a modified version remotely, they must be offered the corresponding source of the whole work. The GPL "hosted service is not distribution" reasoning does not apply here.',
  },
  {
    id: 'MPL-2.0',
    name: 'Mozilla Public License 2.0',
    summary:
      'File-level weak copyleft. Modifications to MPL-licensed files must be released under MPL, but your own files in the same project are unaffected. This makes it unusually easy to combine with proprietary code.',
  },
  {
    id: 'EPL-2.0',
    name: 'Eclipse Public License 2.0',
    summary:
      'Weak copyleft at the module level, common in the Java ecosystem. Modifications to EPL-covered code must be made available; larger works that merely combine with it need not be.',
  },
  {
    id: 'SSPL-1.0',
    name: 'Server Side Public License',
    summary:
      'Not OSI-approved. Created by MongoDB to close the perceived AGPL loophole: offering the software as a service obliges you to release the entire service stack used to run it. In practice this makes commercial hosting untenable for most companies.',
  },
  {
    id: 'BUSL-1.1',
    name: 'Business Source License 1.1',
    summary:
      'Not open source. Source-available with a time delay: use is restricted — typically barring competing production offerings — until a stated change date, after which the code converts to an open license such as Apache-2.0. The specific Additional Use Grant determines what you may actually do.',
  },
  {
    id: 'Elastic-2.0',
    name: 'Elastic License 2.0',
    summary:
      'Not OSI-approved. Permits broad use but explicitly forbids offering the software as a hosted or managed service to third parties, and forbids circumventing license key functionality.',
  },
  {
    id: 'CC0-1.0',
    name: 'CC0 1.0 Universal',
    summary:
      'A public-domain dedication rather than a license. The author waives all copyright interest to the extent legally possible, so no attribution or other condition attaches.',
  },
  {
    id: 'Unlicense',
    name: 'The Unlicense',
    summary:
      'A public-domain dedication for software. Functionally similar to CC0 with simpler wording, imposing no conditions on use.',
  },
  {
    id: 'Zlib',
    name: 'zlib License',
    summary:
      'Permissive. Requires that altered source versions be marked as such and that the license notice stay intact. Widely used in game development and C libraries.',
  },
  {
    id: 'CC-BY-4.0',
    name: 'Creative Commons Attribution 4.0',
    summary:
      'Permissive for content, requiring attribution. Designed for creative works rather than code, so it lacks the warranty and patent language software licenses normally carry.',
  },
  {
    id: 'CC-BY-NC-4.0',
    name: 'Creative Commons Attribution-NonCommercial 4.0',
    summary:
      'Restricts use to non-commercial purposes. It grants no rights for commercial use, which rules it out for anything shipped by a business, including internal tooling that supports commercial activity.',
  },
];

export function findLicense(id: string): LicenseEntry | undefined {
  const key = id.trim().toLowerCase();
  return LICENSE_CATALOG.find((l) => l.id.toLowerCase() === key);
}

// SEED_PACKAGES（express, react, requests …）は削除した。
// すべて許容ライセンスなので、sitemap のフィルタを通ると1件も残らない。
