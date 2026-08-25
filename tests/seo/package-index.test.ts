/**
 * 公開するパッケージページの索引。
 *
 * ここが書けないと、/packages にも sitemap にもページが増えない。しかも
 * 失敗は静かに起きる（書けなかったことは応答に出ない）ので、
 * 「載せたはずのページが載っていない」という形でしか気づけない。
 */
import { describe, expect, it } from 'vitest';
import { listPackageIndex, recordPackagePage } from '../../src/seo/package-index';

/** bind した引数と発行した SQL だけを覚える D1 の身代わり */
function fakeDb(rows: unknown[] = []) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const entry = { sql, args: [] as unknown[] };
      return {
        bind(...args: unknown[]) {
          entry.args = args;
          return this;
        },
        // 実際に書きに行ったものだけを数える。bind した時点で数えると
        // 1 回の書き込みが 2 件に見える
        run: async () => {
          calls.push(entry);
          return {};
        },
        all: async () => ({ results: rows }),
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe('索引への書き込み', () => {
  it('解決したパッケージを書く', async () => {
    const { db, calls } = fakeDb();
    await recordPackagePage(db, 'pypi', 'psycopg2-binary', 'LGPL-3.0-only');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(['pypi', 'psycopg2-binary', 'LGPL-3.0-only']);
  });

  it('解決できなかった名前は書かない', async () => {
    // 解決できない名前は社内パッケージの形をしている。
    // 「解決できなかった名前は書かない」は / に書いてある公開の約束
    const { db, calls } = fakeDb();
    await recordPackagePage(db, 'npm', '@acme/internal-billing', null);
    expect(calls).toEqual([]);
  });

  it('時刻を書かない', async () => {
    // 到達が少ないうちは「パッケージごとの時刻」は「誰がいつ何を調べたか」と
    // ほぼ同じで、「誰が尋ねたかは記録しない」という約束を破る。
    // 索引の仕事（何を載せるかの判断）に時刻は要らない
    const { db, calls } = fakeDb();
    await recordPackagePage(db, 'npm', 'lodash', 'MIT');
    expect(calls[0]!.sql).not.toMatch(/resolved_at|created_at|時刻/);
    expect(calls[0]!.args.every((a) => typeof a === 'string')).toBe(true);
  });

  it('二度目は上書きする（再ライセンスを追える）', async () => {
    const { db, calls } = fakeDb();
    await recordPackagePage(db, 'go', 'github.com/grafana/grafana', 'AGPL-3.0-only');
    expect(calls[0]!.sql).toMatch(/ON CONFLICT/i);
  });

  it('書けなくても例外を投げない', async () => {
    // 索引は付随的な仕事で、これが失敗してもページは返せる。
    // 投げると利用者にエラーページが出る
    const db = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;
    await expect(recordPackagePage(db, 'npm', 'lodash', 'MIT')).resolves.toBeUndefined();
  });
});

describe('索引の読み出し', () => {
  it('エコシステムが未知の行は捨てる', async () => {
    // 表に直接入った値まで信用すると、作れない経路のリンクを sitemap に出す
    const { db } = fakeDb([
      { ecosystem: 'npm', package: 'lodash', spdx: 'MIT' },
      { ecosystem: 'maven', package: 'junit', spdx: 'EPL-2.0' },
    ]);
    const rows = await listPackageIndex(db);
    expect(rows.map((r) => r.name)).toEqual(['lodash']);
  });

  it('読めなければ空を返す', async () => {
    const db = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;
    await expect(listPackageIndex(db)).resolves.toEqual([]);
  });

  it('license_cache と索引の両方から集める', async () => {
    // 片方だけを見ると、版付きで走査されたものか要求されて解決したものかの
    // どちらかが静かに落ちる。/packages と sitemap は同じこの一本を使う
    const seen: string[] = [];
    const db = {
      prepare(sql: string) {
        seen.push(sql);
        return { all: async () => ({ results: [] }) };
      },
    } as unknown as D1Database;

    await listPackageIndex(db);
    expect(seen.join(' ')).toMatch(/package_index/);
    expect(seen.join(' ')).toMatch(/license_cache/);
  });
});
