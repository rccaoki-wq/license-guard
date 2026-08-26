import { describe, expect, it } from 'vitest';
import {
  isCycloneDx,
  isSpdxJson,
  parseCycloneDx,
  parseSpdxJson,
  usableLicense,
} from '../../src/manifests/sbom';
import { detectAndParse } from '../../src/manifests';

const cdx = (extra: Record<string, unknown>) =>
  JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', ...extra });

const spdx = (extra: Record<string, unknown>) =>
  JSON.stringify({ spdxVersion: 'SPDX-2.3', name: 'doc', ...extra });

const byName = <T extends { name: string }>(deps: T[], name: string) =>
  deps.find((d) => d.name === name);

describe('usableLicense', () => {
  it('SPDX 識別子はそのまま通る', () => {
    expect(usableLicense('MIT')).toBe('MIT');
    expect(usableLicense('Apache-2.0 OR MIT')).toBe('Apache-2.0 OR MIT');
  });

  /**
   * 「主張しない」と書いてあるものを宣言として扱えば嘘になる。
   * 返り値が undefined になることで、通常どおりレジストリを引き直す
   */
  it('NOASSERTION と NONE は宣言として扱わない', () => {
    expect(usableLicense('NOASSERTION')).toBeUndefined();
    expect(usableLicense('NONE')).toBeUndefined();
    expect(usableLicense('noassertion')).toBeUndefined();
  });

  /** 文書内ローカルの参照。SPDX 識別子ではないし、走査器の推定でもある */
  it('LicenseRef-* は宣言として扱わない', () => {
    expect(usableLicense('LicenseRef-scancode-unknown')).toBeUndefined();
    expect(usableLicense('MIT AND LicenseRef-Proprietary')).toBeUndefined();
  });

  it('式として読めない自由文は宣言として扱わない', () => {
    expect(usableLicense('See LICENSE file')).toBeUndefined();
    expect(usableLicense('Commercial')).toBeUndefined();
    expect(usableLicense('')).toBeUndefined();
    expect(usableLicense(null)).toBeUndefined();
    expect(usableLicense(42)).toBeUndefined();
  });

  it('綴りだけは SPDX に寄せる', () => {
    expect(usableLicense('mit')).toBe('MIT');
  });
});

describe('CycloneDX', () => {
  it('bomFormat で判定する', () => {
    expect(isCycloneDx(JSON.parse(cdx({})))).toBe(true);
    expect(isCycloneDx({ spdxVersion: 'SPDX-2.3' })).toBe(false);
  });

  it('purl から座標を、licenses から宣言を読む', () => {
    const { dependencies } = parseCycloneDx(
      JSON.parse(
        cdx({
          components: [
            {
              type: 'library',
              name: 'lodash',
              version: '4.17.21',
              purl: 'pkg:npm/lodash@4.17.21',
              licenses: [{ license: { id: 'MIT' } }],
            },
          ],
        }),
      ),
    );

    expect(dependencies).toEqual([
      {
        ecosystem: 'npm',
        name: 'lodash',
        version: '4.17.21',
        scope: 'runtime',
        origin: 'registry',
        declaredLicense: 'MIT',
        declaredFrom: 'sbom',
      },
    ]);
  });

  /**
   * spec は複数並んだ licenses[] が AND か OR かを定めていない。
   * OR と読むと一番緩い 1 つだけを守ればよいことになり、実際に課される
   * 義務を見落とす。多い側で外れる方が損害が小さい
   */
  it('licenses が複数あれば AND で繋ぐ', () => {
    const { dependencies } = parseCycloneDx(
      JSON.parse(
        cdx({
          components: [
            {
              purl: 'pkg:npm/dual@1.0.0',
              licenses: [{ license: { id: 'MIT' } }, { license: { id: 'Apache-2.0' } }],
            },
          ],
        }),
      ),
    );
    expect(dependencies[0]?.declaredLicense).toBe('MIT AND Apache-2.0');
  });

  it('expression があればそれを単独で採る', () => {
    const { dependencies } = parseCycloneDx(
      JSON.parse(
        cdx({
          components: [
            {
              purl: 'pkg:npm/x@1.0.0',
              licenses: [{ expression: 'Apache-2.0 OR MIT' }, { license: { id: 'GPL-3.0-only' } }],
            },
          ],
        }),
      ),
    );
    expect(dependencies[0]?.declaredLicense).toBe('Apache-2.0 OR MIT');
  });

  it('name が自由文なら宣言として扱わず、レジストリ照会に戻す', () => {
    const { dependencies } = parseCycloneDx(
      JSON.parse(
        cdx({
          components: [{ purl: 'pkg:npm/x@1.0.0', licenses: [{ license: { name: 'Commercial' } }] }],
        }),
      ),
    );
    expect(dependencies[0]?.declaredLicense).toBeUndefined();
  });

  /**
   * `excluded` を dev に寄せると NON_SHIPPING_SCOPES に当たって
   * 「dev dependency なので出荷物に入らない」と理由文が書かれる。
   * 文書はそんなことを言っていない
   */
  it('scope: excluded を dev に寄せない', () => {
    const { dependencies } = parseCycloneDx(
      JSON.parse(
        cdx({
          components: [
            { purl: 'pkg:npm/a@1.0.0', scope: 'required' },
            { purl: 'pkg:npm/b@1.0.0', scope: 'optional' },
            { purl: 'pkg:npm/c@1.0.0', scope: 'excluded' },
            { purl: 'pkg:npm/d@1.0.0' },
          ],
        }),
      ),
    );
    expect(dependencies.map((d) => d.scope)).toEqual(['runtime', 'optional', 'optional', 'runtime']);
  });

  it('入れ子の components も読む', () => {
    const { dependencies } = parseCycloneDx(
      JSON.parse(
        cdx({
          components: [
            {
              purl: 'pkg:npm/outer@1.0.0',
              components: [{ purl: 'pkg:npm/inner@2.0.0' }],
            },
          ],
        }),
      ),
    );
    expect(dependencies.map((d) => d.name).sort()).toEqual(['inner', 'outer']);
  });

  /** SBOM の対象そのものは依存ではない */
  it('metadata.component は依存に数えない', () => {
    const { dependencies } = parseCycloneDx(
      JSON.parse(
        cdx({
          metadata: { component: { name: 'my-app', purl: 'pkg:npm/my-app@1.0.0' } },
          components: [{ purl: 'pkg:npm/my-app@1.0.0' }, { purl: 'pkg:npm/lodash@4.17.21' }],
        }),
      ),
    );
    expect(dependencies.map((d) => d.name)).toEqual(['lodash']);
  });

  it('同じ座標が重複していれば先に現れた方を残す', () => {
    const { dependencies } = parseCycloneDx(
      JSON.parse(
        cdx({
          components: [
            { purl: 'pkg:npm/a@1.0.0', licenses: [{ license: { id: 'MIT' } }] },
            { purl: 'pkg:npm/a@1.0.0' },
          ],
        }),
      ),
    );
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]?.declaredLicense).toBe('MIT');
  });

  it('対応外の purl type と purl 欠落を type ごとに数える', () => {
    const { dependencies, skipped } = parseCycloneDx(
      JSON.parse(
        cdx({
          components: [
            { purl: 'pkg:npm/ok@1.0.0' },
            { purl: 'pkg:maven/org.apache/commons-lang3@3.14.0' },
            { purl: 'pkg:maven/org.slf4j/slf4j-api@2.0.12' },
            { purl: 'pkg:deb/debian/curl@7.88.1' },
            { name: 'nameless', version: '1.0.0' },
          ],
        }),
      ),
    );
    expect(dependencies.map((d) => d.name)).toEqual(['ok']);
    expect([...skipped.entries()].sort()).toEqual([
      ['deb', 1],
      ['maven', 2],
      ['no package URL', 1],
    ]);
  });

  it('壊れた文書で例外を投げない', () => {
    expect(parseCycloneDx(null).dependencies).toEqual([]);
    expect(parseCycloneDx(JSON.parse(cdx({ components: 'not an array' }))).dependencies).toEqual([]);
    expect(parseCycloneDx(JSON.parse(cdx({ components: [null, 3, []] }))).dependencies).toEqual([]);
  });
});

describe('SPDX (JSON)', () => {
  it('spdxVersion で判定する', () => {
    expect(isSpdxJson(JSON.parse(spdx({})))).toBe(true);
    expect(isSpdxJson({ bomFormat: 'CycloneDX' })).toBe(false);
  });

  it('externalRefs の purl から座標を読む', () => {
    const { dependencies } = parseSpdxJson(
      JSON.parse(
        spdx({
          packages: [
            {
              SPDXID: 'SPDXRef-Package-requests',
              name: 'requests',
              versionInfo: '2.31.0',
              licenseDeclared: 'Apache-2.0',
              externalRefs: [
                { referenceCategory: 'SECURITY', referenceType: 'cpe23Type', referenceLocator: 'x' },
                {
                  referenceCategory: 'PACKAGE-MANAGER',
                  referenceType: 'purl',
                  referenceLocator: 'pkg:pypi/requests@2.31.0',
                },
              ],
            },
          ],
        }),
      ),
    );

    expect(dependencies).toEqual([
      {
        ecosystem: 'pypi',
        name: 'requests',
        version: '2.31.0',
        scope: 'runtime',
        origin: 'registry',
        declaredLicense: 'Apache-2.0',
        declaredFrom: 'sbom',
      },
    ]);
  });

  /**
   * licenseConcluded の方が新しい情報を含みうるので先に見るが、
   * 実際には NOASSERTION であることが多い。その場合は宣言に落ちる
   */
  it('licenseConcluded を優先し、NOASSERTION なら licenseDeclared に落ちる', () => {
    const { dependencies } = parseSpdxJson(
      JSON.parse(
        spdx({
          packages: [
            {
              licenseConcluded: 'MIT',
              licenseDeclared: 'Apache-2.0',
              externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/a@1.0.0' }],
            },
            {
              licenseConcluded: 'NOASSERTION',
              licenseDeclared: 'BSD-3-Clause',
              externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/b@1.0.0' }],
            },
            {
              licenseConcluded: 'NOASSERTION',
              licenseDeclared: 'NOASSERTION',
              externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/c@1.0.0' }],
            },
          ],
        }),
      ),
    );

    expect(byName(dependencies, 'a')?.declaredLicense).toBe('MIT');
    expect(byName(dependencies, 'b')?.declaredLicense).toBe('BSD-3-Clause');
    expect(byName(dependencies, 'c')?.declaredLicense).toBeUndefined();
  });

  it('documentDescribes と DESCRIBES の対象は依存に数えない', () => {
    const { dependencies } = parseSpdxJson(
      JSON.parse(
        spdx({
          documentDescribes: ['SPDXRef-App'],
          relationships: [
            {
              spdxElementId: 'SPDXRef-DOCUMENT',
              relationshipType: 'DESCRIBES',
              relatedSpdxElement: 'SPDXRef-Root',
            },
          ],
          packages: [
            {
              SPDXID: 'SPDXRef-App',
              externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/my-app@1.0.0' }],
            },
            {
              SPDXID: 'SPDXRef-Root',
              externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/root@1.0.0' }],
            },
            {
              SPDXID: 'SPDXRef-Dep',
              externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/dep@1.0.0' }],
            },
          ],
        }),
      ),
    );
    expect(dependencies.map((d) => d.name)).toEqual(['dep']);
  });

  it('purl を持たないパッケージは件数として数える', () => {
    const { dependencies, skipped } = parseSpdxJson(
      JSON.parse(
        spdx({
          packages: [
            { SPDXID: 'SPDXRef-a', name: 'a', versionInfo: '1.0.0' },
            {
              SPDXID: 'SPDXRef-b',
              externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/b@1.0.0' }],
            },
          ],
        }),
      ),
    );
    expect(dependencies.map((d) => d.name)).toEqual(['b']);
    expect(skipped.get('no package URL')).toBe(1);
  });

  it('壊れた文書で例外を投げない', () => {
    expect(parseSpdxJson(null).dependencies).toEqual([]);
    expect(parseSpdxJson(JSON.parse(spdx({ packages: 'nope' }))).dependencies).toEqual([]);
    expect(parseSpdxJson(JSON.parse(spdx({ packages: [null, 7] }))).dependencies).toEqual([]);
  });
});

describe('detectAndParse による取り込み', () => {
  it('CycloneDX を SBOM として読む', () => {
    const parsed = detectAndParse(
      cdx({ components: [{ purl: 'pkg:npm/lodash@4.17.21', licenses: [{ expression: 'MIT' }] }] }),
    );
    expect(parsed.format).toBe('CycloneDX');
    expect(parsed.ecosystem).toBe('npm');
    expect(parsed.transitive).toBe(true);
    expect(parsed.notes).toEqual([]);
  });

  it('SPDX を SBOM として読む', () => {
    const parsed = detectAndParse(
      spdx({
        packages: [
          {
            SPDXID: 'SPDXRef-a',
            licenseDeclared: 'MIT',
            externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:pypi/requests@2.31.0' }],
          },
        ],
      }),
    );
    expect(parsed.format).toBe('SPDX');
    expect(parsed.ecosystem).toBe('pypi');
  });

  /**
   * 多数派の系を名乗ると、少数派の依存を持つ利用者に対して
   * 入力の素性を偽ることになる
   */
  it('系が 2 つ以上あれば mixed と名乗る', () => {
    const parsed = detectAndParse(
      cdx({
        components: [
          { purl: 'pkg:npm/a@1.0.0' },
          { purl: 'pkg:npm/b@1.0.0' },
          { purl: 'pkg:golang/github.com/x/y@v1.0.0' },
        ],
      }),
    );
    expect(parsed.ecosystem).toBe('mixed');
  });

  /** 落とした成分は依存の一覧に痕跡が残らないので、notes で運ぶ */
  it('落とした成分を type と件数で開示する', () => {
    const parsed = detectAndParse(
      cdx({
        components: [
          { purl: 'pkg:npm/a@1.0.0' },
          { purl: 'pkg:maven/org.apache/commons-lang3@3.14.0' },
          { purl: 'pkg:maven/org.slf4j/slf4j-api@2.0.12' },
          { purl: 'pkg:deb/debian/curl@7.88.1' },
        ],
      }),
    );
    expect(parsed.notes?.[0]).toContain('3 components were left out');
    expect(parsed.notes?.[0]).toContain('maven (2), deb (1)');
  });

  it('落とした成分が 1 件なら単数で書く', () => {
    const parsed = detectAndParse(
      cdx({
        components: [{ purl: 'pkg:npm/a@1.0.0' }, { purl: 'pkg:maven/g/a@1.0.0' }],
      }),
    );
    expect(parsed.notes?.[0]).toContain('1 component was left out');
    expect(parsed.notes?.[0]).toContain('its package type');
  });

  /**
   * Maven 中心の SBOM を貼った Java の利用者に「依存 0 件」を返すと、
   * 検査が済んだ顔で何も見ていないことになる。理由を名指しで返す
   */
  it('対応する成分が 1 件も無ければ、理由を言って落とす', () => {
    expect(() =>
      detectAndParse(
        cdx({ components: [{ purl: 'pkg:maven/org.apache/commons-lang3@3.14.0' }] }),
      ),
    ).toThrow(/CycloneDX document, but nothing in it can be checked.*maven \(1\)/s);
  });

  it('成分が空の SBOM も SBOM として理由を言う', () => {
    expect(() => detectAndParse(spdx({ packages: [] }))).toThrow(
      /SPDX document, but nothing in it can be checked.*lists no components/s,
    );
  });

  /**
   * CycloneDX も SPDX も `{` で始まり、`dependencies` や `packages` に
   * 見える欄を持ちうる。npm / NuGet の判定より前に置かないと別形式として読まれる
   */
  it('dependencies 欄を持つ CycloneDX を package-lock として読まない', () => {
    const parsed = detectAndParse(
      cdx({
        components: [{ purl: 'pkg:npm/a@1.0.0' }],
        dependencies: [{ ref: 'pkg:npm/a@1.0.0', dependsOn: [] }],
      }),
    );
    expect(parsed.format).toBe('CycloneDX');
  });
});
