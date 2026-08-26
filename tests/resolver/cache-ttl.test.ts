import { describe, expect, it } from 'vitest';
import { LicenseCache, LATEST_FALLBACK_TTL_MS, RULE_EPOCH_MS } from '../../src/resolver/cache';
import type { Dependency } from '../../src/types';

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  const store = [...rows];
  const db = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              const [eco, pkg, ver] = args as string[];
              return (store.find(
                (r) => r['ecosystem'] === eco && r['package'] === pkg && r['version'] === ver,
              ) as T) ?? null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
  return db as unknown as D1Database;
}

const dep: Dependency = {
  ecosystem: 'npm',
  name: 'express',
  version: '1.0.0',
  scope: 'runtime',
};

const row = (source: string, ageMs: number) => ({
  ecosystem: 'npm',
  package: 'express',
  version: '1.0.0',
  spdx: 'MIT',
  source,
  resolved_at: Date.now() - ageMs,
});

describe('可変な情報源から得た結果は期限付きで扱う', () => {
  it('固定版由来のキャッシュは古くても使う（そのバージョンの事実は不変）', async () => {
    const cache = new LicenseCache(fakeDb([row('registry', 10 * 365 * 24 * 3600_000)]));
    expect(await cache.get(dep)).toEqual({ spdx: 'MIT', source: 'registry' });
  });

  it('clearlydefined 由来も、規則を直した後に保存されたものなら不変として扱う', async () => {
    const cache = new LicenseCache(fakeDb([row('clearlydefined', 0)]));
    expect((await cache.get(dep))?.source).toBe('clearlydefined');
  });

  it('最新版由来のキャッシュは期限内なら使う', async () => {
    const cache = new LicenseCache(fakeDb([row('registry-latest', LATEST_FALLBACK_TTL_MS / 2)]));
    expect((await cache.get(dep))?.source).toBe('registry-latest');
  });

  it('最新版由来のキャッシュは期限切れなら無視する（再ライセンスを取り込むため）', async () => {
    const cache = new LicenseCache(fakeDb([row('registry-latest', LATEST_FALLBACK_TTL_MS + 1000)]));
    expect(await cache.get(dep)).toBeNull();
  });

  it('resolved_at が欠けていても落ちない', async () => {
    const cache = new LicenseCache(
      fakeDb([{ ecosystem: 'npm', package: 'express', version: '1.0.0', spdx: 'MIT', source: 'registry-latest' }]),
    );
    expect(await cache.get(dep)).toBeNull();
  });
});

/**
 * **不変な情報源の行は恒久に残る。だから解決の規則を直しても、既に
 * 保存された誤答は永久に配り続ける。**
 *
 * 2026-08-26 に ClearlyDefined の LicenseRef-scancode を落とす修正を
 * 入れて配ったが、実在の go.mod を流し直しても結果は 1 件も変わらなかった。
 * 誤答 22 行がキャッシュに載っていたためで、手で DELETE するまで
 * 誰にも届かなかった。**直したことを覚えている人間に依存させない。**
 */
describe('規則を直す前に保存された答えは使わない', () => {
  const epoch = RULE_EPOCH_MS['clearlydefined'];

  it('規則を直した情報源には epoch が入っている', () => {
    expect(typeof epoch).toBe('number');
  });

  it('epoch より前に保存された行は、不変な情報源でも無視する', async () => {
    const cache = new LicenseCache(
      fakeDb([{ ...row('clearlydefined', 0), resolved_at: epoch! - 1 }]),
    );
    expect(await cache.get(dep)).toBeNull();
  });

  it('epoch 以降に保存された行は使う', async () => {
    const cache = new LicenseCache(
      fakeDb([{ ...row('clearlydefined', 0), resolved_at: epoch! }]),
    );
    expect((await cache.get(dep))?.source).toBe('clearlydefined');
  });

  /** 時刻が無ければ epoch との前後を判定できない。判定できないものは信用しない */
  it('resolved_at が無い行は epoch より前として扱う', async () => {
    const cache = new LicenseCache(
      fakeDb([
        { ecosystem: 'npm', package: 'express', version: '1.0.0', spdx: 'MIT', source: 'clearlydefined' },
      ]),
    );
    expect(await cache.get(dep)).toBeNull();
  });

  /** epoch を持たない情報源の行は、これまでどおり古くても使う */
  it('規則を直していない情報源には影響しない', async () => {
    const cache = new LicenseCache(fakeDb([row('registry', 10 * 365 * 24 * 3600_000)]));
    expect((await cache.get(dep))?.source).toBe('registry');
  });

  /**
   * epoch が要るのは**期限を持たない情報源だけ**。7 日で切れる行は
   * 放っておいても新しい規則を通り直す。両方を掛けると、期限内かどうかの
   * 判定と二重になって読みにくくなるだけ
   */
  it('期限を持つ情報源には epoch を置かない', () => {
    expect(RULE_EPOCH_MS['registry-latest']).toBeUndefined();
  });

  /** 過去でなければ、直した後に保存された行まで捨ててしまう */
  it('epoch は過去の時刻である', () => {
    for (const [source, ms] of Object.entries(RULE_EPOCH_MS)) {
      expect(Number.isFinite(ms), source).toBe(true);
      expect(ms, source).toBeLessThan(Date.now());
    }
  });
});
