import { describe, it, expect } from 'vitest';
import { parseYarnLock } from '../../src/manifests/yarn-lock';
import { parsePnpmLock } from '../../src/manifests/pnpm-lock';
import { parsePackageLock } from '../../src/manifests/npm-lock';

/**
 * npm 系ロックファイルで「公開レジストリに存在しない依存」を見分ける。
 *
 * **これは速度の話ではない。誤答の話である。**
 * yarn workspaces のモノレポで内部パッケージを `left-pad` と名付けると、
 * 今までは npm 上の無関係な `left-pad` を引いて WTFPL / allowed を返して
 * いた。バージョン `0.0.0-use.local` は存在しないので `registry-latest`
 * に落ち、見たこともないパッケージのライセンスを最も強い判定で貼る。
 * `utils` `core` `api` のような名前なら普通に踏む。
 */

describe('yarn.lock の workspace / git 依存', () => {
  const YARN_V1 = `# yarn lockfile v1

"express@^4.18.0":
  version "4.18.2"

"from-git@git+ssh://git@github.com/acme/thing.git#deadbeef":
  version "2.0.0"

"gh-short@github:acme/short#v1":
  version "3.0.0"
`;

  const YARN_BERRY = `__metadata:
  version: 8

"express@npm:^4.18.0":
  version: 4.18.2

"my-pkg@workspace:packages/foo":
  version: 0.0.0-use.local

"left-pad@workspace:packages/left-pad":
  version: 0.0.0-use.local
`;

  it('workspace: のメンバーを workspace として印を付ける', () => {
    const by = Object.fromEntries(parseYarnLock(YARN_BERRY).map((d) => [d.name, d.origin]));
    expect(by['express']).toBe('registry');
    expect(by['my-pkg']).toBe('workspace');
    // 公開 npm に同名が実在する。ここが誤答の入口だった
    expect(by['left-pad']).toBe('workspace');
  });

  it('git 指定を git として印を付け、名前を壊さない', () => {
    const deps = parseYarnLock(YARN_V1);
    const by = Object.fromEntries(deps.map((d) => [d.name, d.origin]));
    expect(by['express']).toBe('registry');
    // 以前は "from-git@git+ssh://git" という実在しない名前になっていた
    expect(by['from-git']).toBe('git');
    expect(by['gh-short']).toBe('git');
    expect(deps.map((d) => d.name).some((n) => n.includes('://'))).toBe(false);
  });
});

describe('pnpm-lock.yaml の git 依存', () => {
  const PNPM = `lockfileVersion: '9.0'

packages:

  express@4.18.2:
    resolution: {integrity: sha512-x}

  from-git@https://codeload.github.com/acme/thing/tar.gz/deadbeef:
    resolution: {tarball: https://codeload.github.com/acme/thing/tar.gz/deadbeef}
`;

  it('version が URL の項目を git として印を付ける', () => {
    const by = Object.fromEntries(parsePnpmLock(PNPM).map((d) => [d.name, d.origin]));
    expect(by['express']).toBe('registry');
    expect(by['from-git']).toBe('git');
  });

  // URL はバージョンではない。残すと版が一致せず最新版に落ちる
  it('version に URL を残さない', () => {
    const gitDep = parsePnpmLock(PNPM).find((d) => d.name === 'from-git')!;
    expect(gitDep.version).toBeNull();
  });
});

describe('package-lock.json の git 依存', () => {
  const LOCK = JSON.stringify({
    name: 't',
    lockfileVersion: 3,
    packages: {
      '': { name: 't' },
      'node_modules/left-pad': { version: '1.3.0', license: 'WTFPL' },
      'node_modules/from-git': {
        version: '2.0.0',
        resolved: 'git+ssh://git@github.com/acme/from-git.git#deadbeef',
      },
      'node_modules/proxied': {
        version: '1.2.3',
        resolved: 'https://npm.corp.example/proxied/-/proxied-1.2.3.tgz',
      },
    },
  });

  it('resolved が git+ の項目を git として印を付ける', () => {
    const by = Object.fromEntries(parsePackageLock(LOCK).map((d) => [d.name, d.origin]));
    expect(by['from-git']).toBe('git');
  });

  /**
   * **企業のプロキシミラーを私設レジストリと決めつけてはいけない。**
   * `resolved` のホストが npmjs でなくても、中身は npmjs の同じ
   * パッケージであることが普通にある（Artifactory / Nexus の透過プロキシ）。
   * ホストで判定すると、それを使う会社のスキャンが丸ごと壊れる。
   * 区別する手段が無いので、印を付けずに従来どおり照会する。
   */
  it('npmjs 以外のホストから来た項目に印を付けない', () => {
    const by = Object.fromEntries(parsePackageLock(LOCK).map((d) => [d.name, d.origin]));
    expect(by['proxied']).toBeUndefined();
  });
});
