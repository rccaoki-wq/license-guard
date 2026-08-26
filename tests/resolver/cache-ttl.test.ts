import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LicenseCache,
  FALLBACK_SOURCE_TTL_MS,
  LATEST_FALLBACK_TTL_MS,
  RULE_EPOCH_MS,
} from '../../src/resolver/cache';
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
            // getMany 用。**実装しないと catch に飲まれて常に空が返り、
            // 「絞り込めている」テストが何も確かめないまま緑になる**
            async all<T>(): Promise<{ results: T[] }> {
              const [eco, ...names] = args as string[];
              return {
                results: store.filter(
                  (r) => r['ecosystem'] === eco && names.includes(r['package'] as string),
                ) as T[],
              };
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
 * **キャッシュの鍵に情報源が入っていない。**だから優先順位が効くのは最初の
 * 書き込み 1 回だけで、劣後する情報源が先に答えた座標は永久にその答えを返す。
 *
 * 実測（2026-08-26、本番キャッシュ上の ClearlyDefined 由来 102 座標）では、
 * 100 件を優先すべき deps.dev が答えられた。うち 3 件は義務を**過少に**
 * 述べていた（aws-sdk-go は Apache-2.0 だけで BSD-3-Clause が落ちていた）。
 * 一時的に届かなかっただけの答えを恒久にすると、緩い側の誤りが永久に残る。
 */
describe('劣後する情報源から得た答えは期限付きで扱う', () => {
  /**
   * 時計を epoch の十分あとに固定する。**epoch は数時間前の定数**なので、
   * 実時刻のままだと「期限内（数日前）」の行がことごとく epoch より前になり、
   * 期限の判定を一度も通らないまま緑になる
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(RULE_EPOCH_MS['clearlydefined']! + 365 * 24 * 3600_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ClearlyDefined 由来は期限内なら使う', async () => {
    const cache = new LicenseCache(fakeDb([row('clearlydefined', FALLBACK_SOURCE_TTL_MS / 2)]));
    expect((await cache.get(dep))?.source).toBe('clearlydefined');
  });

  it('期限を過ぎたら無視して、優先する情報源にもう一度機会を与える', async () => {
    const cache = new LicenseCache(fakeDb([row('clearlydefined', FALLBACK_SOURCE_TTL_MS + 1000)]));
    expect(await cache.get(dep)).toBeNull();
  });

  it('getMany でも同じ判定をする（片方だけ直すと経路で答えが変わる）', async () => {
    const fresh = new LicenseCache(fakeDb([row('clearlydefined', FALLBACK_SOURCE_TTL_MS / 2)]));
    expect((await fresh.getMany([dep])).size).toBe(1);

    const stale = new LicenseCache(fakeDb([row('clearlydefined', FALLBACK_SOURCE_TTL_MS + 1000)]));
    expect((await stale.getMany([dep])).size).toBe(0);
  });

  /** 優先される側は劣後しない。ここを期限付きにすると無駄に上流を叩き直す */
  it('deps-dev 由来は恒久に使う', async () => {
    const cache = new LicenseCache(fakeDb([row('deps-dev', 10 * 365 * 24 * 3600_000)]));
    expect((await cache.get(dep))?.source).toBe('deps-dev');
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

  /**
   * **時計を epoch の直後に固定する。**epoch は日付の定数なので、実時刻の
   * まま書くと「epoch より前」と「期限内」が日が経つほど両立しなくなり、
   * ある日から判定が期限側に吸われて、epoch を消しても緑のままになる。
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch! + 60_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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
   * **epoch と期限は別の問いに答える。**期限は「その答えが古くなったか」、
   * epoch は「その答えが直す前の規則で得たものか」。期限だけに任せると、
   * 直したはずの誤答をその期限のあいだ配り続ける。誤りの修正は今届かなければ
   * 意味がないので、期限を持つ情報源でも epoch は効かなければならない
   */
  it('期限内であっても、epoch より前の行は使わない', async () => {
    const justBefore = epoch! - 1;
    // 期限（7 日）から見ればまだ十分に新しい行
    expect(Date.now() - justBefore).toBeLessThan(FALLBACK_SOURCE_TTL_MS);

    const cache = new LicenseCache(fakeDb([{ ...row('clearlydefined', 0), resolved_at: justBefore }]));
    expect(await cache.get(dep)).toBeNull();
  });

});

/** 過去でなければ、直した後に保存された行まで捨ててしまう（実時刻で見る） */
describe('epoch は過去の時刻である', () => {
  it('すべての epoch が今より前', () => {
    for (const [source, ms] of Object.entries(RULE_EPOCH_MS)) {
      expect(Number.isFinite(ms), source).toBe(true);
      expect(ms, source).toBeLessThan(Date.now());
    }
  });
});
