import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan';
import type { CacheLike } from '../src/resolver';

/**
 * 注意書きの文面そのものを固定する。
 *
 * ここは**利用者が読む唯一の説明**で、スキャンが不完全である理由を
 * 伝える最後の一手でもある。「1 dependencies」のような雑さや、npm の
 * スキャンに crates の話が出ることは、書いてある内容の信頼を削る。
 */

const noopCache: CacheLike = {
  async get() {
    return null;
  },
  async put() {},
};

const resolvesNothing = {
  npm: async () => ({ spdx: null }),
  pypi: async () => ({ spdx: null }),
  go: async () => ({ spdx: null }),
  cargo: async () => ({ spdx: null }),
};

/** workspace メンバーを 1 件だけ含む yarn.lock */
const ONE_WORKSPACE = `# yarn lockfile v1

"my-pkg@workspace:packages/foo":
  version: 0.0.0-use.local
`;

/** workspace メンバーを 2 件含む yarn.lock */
const TWO_WORKSPACE = `# yarn lockfile v1

"my-pkg@workspace:packages/foo":
  version: 0.0.0-use.local

"other-pkg@workspace:packages/bar":
  version: 0.0.0-use.local
`;

describe('not-published の注意書き', () => {
  it('1件のときは単数形で書く', async () => {
    const r = await scan(ONE_WORKSPACE, 'saas', noopCache, resolvesNothing);
    const line = r.limitations.find((l) => l.includes('not published'))!;
    expect(line).toContain('1 dependency is not published');
    expect(line).not.toContain('1 dependencies');
  });

  it('2件以上のときは複数形で書く', async () => {
    const r = await scan(TWO_WORKSPACE, 'saas', noopCache, resolvesNothing);
    const line = r.limitations.find((l) => l.includes('not published'))!;
    expect(line).toContain('2 dependencies are not published');
  });

  /**
   * この分類は cargo だけのものではない。yarn workspaces のメンバーも
   * package-lock の git 依存も同じ文を読む。crates と書くと、npm しか
   * 使っていない相手に無関係な話をすることになる。
   */
  it('特定のエコシステムの語を使わない', async () => {
    const r = await scan(TWO_WORKSPACE, 'saas', noopCache, resolvesNothing);
    const line = r.limitations.find((l) => l.includes('not published'))!;
    expect(line).not.toMatch(/crates|npm packages|Go modules/);
  });

  it('再スキャンでは解決しないと明言する', async () => {
    const r = await scan(TWO_WORKSPACE, 'saas', noopCache, resolvesNothing);
    const line = r.limitations.find((l) => l.includes('not published'))!;
    expect(line).toMatch(/will not change|will not resolve/i);
  });
});
