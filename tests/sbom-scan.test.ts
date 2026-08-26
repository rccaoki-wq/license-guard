import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan';
import type { CacheLike } from '../src/resolver';

/**
 * SBOM を通したときの**結果全体**を固定する。
 *
 * SBOM は 1 文書に複数の系が同居する最初の入力で、これまで
 * 「入力全体の系」と「依存ごとの系」を取り違えていても症状が出なかった
 * 箇所が、ここで初めて分かれる。分かれた側が正しいことを押さえる。
 */

const noopCache: CacheLike = {
  async get() {
    return null;
  },
  async put() {},
};

/** SBOM に書いてある値だけで答えが出ることを確かめたいので、照会は全部失敗させる */
const resolvesNothing = {
  npm: async () => ({ spdx: null }),
  pypi: async () => ({ spdx: null }),
  go: async () => ({ spdx: null }),
  cargo: async () => ({ spdx: null }),
  rubygems: async () => ({ spdx: null }),
  nuget: async () => ({ spdx: null }),
};

const MIXED = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { name: 'my-app', purl: 'pkg:npm/my-app@1.0.0' } },
  components: [
    { purl: 'pkg:npm/lodash@4.17.21', licenses: [{ license: { id: 'MIT' } }] },
    {
      purl: 'pkg:golang/github.com/gorilla/mux@v1.8.1',
      licenses: [{ license: { id: 'BSD-3-Clause' } }],
    },
    { purl: 'pkg:maven/org.apache/commons-lang3@3.14.0', licenses: [{ expression: 'Apache-2.0' }] },
  ],
});

/** Go を 1 件も含まない SBOM。静的リンクの断りが出ないことの対照 */
const NPM_ONLY = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  components: [{ purl: 'pkg:npm/lodash@4.17.21', licenses: [{ license: { id: 'MIT' } }] }],
});

describe('SBOM のスキャン', () => {
  it('書いてあるライセンスで答えが出る（照会が全滅していても）', async () => {
    const r = await scan(MIXED, 'saas', noopCache, resolvesNothing);
    expect(r.findings.map((f) => f.spdxExpression)).toEqual(['MIT', 'BSD-3-Clause']);
  });

  /**
   * `lockfile` と同じ顔で出さない。あちらはパッケージマネージャが
   * レジストリから書いた値、こちらは文書を作った人の主張
   */
  it('出所は sbom であって lockfile ではない', async () => {
    const r = await scan(MIXED, 'saas', noopCache, resolvesNothing);
    expect(new Set(r.findings.map((f) => f.resolvedFrom))).toEqual(new Set(['sbom']));
  });

  it('混在は mixed と名乗る', async () => {
    const r = await scan(MIXED, 'saas', noopCache, resolvesNothing);
    expect(r.ecosystem).toBe('mixed');
  });

  it('単一系の SBOM はその系を名乗る', async () => {
    const r = await scan(NPM_ONLY, 'saas', noopCache, resolvesNothing);
    expect(r.ecosystem).toBe('npm');
  });

  /**
   * **入力側で判定すると mixed のときに丸ごと消える。** Go の
   * モジュールが混ざっているのに、その前提を一言も言わないまま
   * 判定を出すことになる
   */
  it('mixed でも Go の静的リンクの前提を述べる', async () => {
    const r = await scan(MIXED, 'saas', noopCache, resolvesNothing);
    expect(r.limitations).toContain('Go modules were evaluated assuming static linking.');
  });

  it('Go を含まない SBOM では静的リンクの話をしない', async () => {
    const r = await scan(NPM_ONLY, 'saas', noopCache, resolvesNothing);
    expect(r.limitations.join('\n')).not.toContain('static linking');
  });

  /**
   * `transitive` は true だが、ロックファイルではない。版もライセンスも
   * 「文書が作られた時点の記録」であって、これから install される版ではない
   */
  it('ロックファイル用の文言を出さない', async () => {
    const r = await scan(MIXED, 'saas', noopCache, resolvesNothing);
    const text = r.limitations.join('\n');
    expect(text).toContain('CycloneDX document');
    expect(text).toContain('when the document was generated');
    expect(text).not.toContain('exact versions that will be installed');
    expect(text).not.toContain('Only direct dependencies');
  });

  /** 落とした成分は依存の一覧に痕跡が残らないので、限界として運ぶ */
  it('対応外の成分を落としたことを限界として出す', async () => {
    const r = await scan(MIXED, 'saas', noopCache, resolvesNothing);
    const line = r.limitations.find((l) => l.includes('left out'))!;
    expect(line).toContain('maven (1)');
    expect(line).toContain('not counted anywhere in this result');
  });

  it('SBOM の対象そのものは数えない', async () => {
    const r = await scan(MIXED, 'saas', noopCache, resolvesNothing);
    expect(r.findings.map((f) => f.name)).not.toContain('my-app');
    expect(r.summary.total).toBe(2);
  });
});
