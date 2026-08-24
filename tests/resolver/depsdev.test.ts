import { describe, expect, it, vi } from 'vitest';
import {
  DEPSDEV_TIMEOUT_MS,
  fetchDepsDevGoLicense,
  joinLicenses,
  toDepsDevUrl,
} from '../../src/resolver/depsdev';
import { evaluateExpression } from '../../src/policy/engine';
import type { PolicyContext } from '../../src/types';

function ok(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}

describe('toDepsDevUrl', () => {
  it('モジュールパスの / まで含めて 1 要素としてエンコードする', () => {
    const url = toDepsDevUrl('github.com/stretchr/testify', 'v1.10.0');
    expect(url).toContain('/packages/github.com%2Fstretchr%2Ftestify/versions/v1.10.0');
  });

  it('+incompatible のような版も壊さない', () => {
    expect(toDepsDevUrl('m', 'v5.11.1+incompatible')).toContain('/versions/v5.11.1%2Bincompatible');
  });
});

describe('joinLicenses', () => {
  it('単一ならそのまま', () => {
    expect(joinLicenses(['MIT'])).toBe('MIT');
  });

  it('複数は AND で結ぶ（選択肢ではなく同時適用）', () => {
    expect(joinLicenses(['Apache-2.0', 'AGPL-3.0'])).toBe('Apache-2.0 AND AGPL-3.0');
  });

  it('重複は畳む', () => {
    expect(joinLicenses(['MIT', 'MIT', 'MPL-2.0'])).toBe('MIT AND MPL-2.0');
  });

  it('空配列・未定義・空白のみは null', () => {
    expect(joinLicenses([])).toBeNull();
    expect(joinLicenses(undefined)).toBeNull();
    expect(joinLicenses(['  ', ''])).toBeNull();
  });
});

describe('fetchDepsDevGoLicense', () => {
  it('licenses 配列から SPDX 式を作る', async () => {
    const r = await fetchDepsDevGoLicense('github.com/x/y', 'v1.0.0', ok({ licenses: ['MIT'] }));
    expect(r.spdx).toBe('MIT');
    expect(r.fromLatest).toBeUndefined();
  });

  it('licenses が空なら null（収録されているが読めなかった場合）', async () => {
    expect((await fetchDepsDevGoLicense('m', 'v1', ok({ licenses: [] }))).spdx).toBeNull();
  });

  it('404 は null に落ちる', async () => {
    const f = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect((await fetchDepsDevGoLicense('m', 'v1', f)).spdx).toBeNull();
  });

  it('バージョン未指定なら上流を叩かない（版を指定しないと引けない API）', async () => {
    const f = ok({ licenses: ['MIT'] });
    expect((await fetchDepsDevGoLicense('m', null, f)).spdx).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('待ち時間は実測 p99(約 590ms) より上、既定 5 秒より下', () => {
    // 成功の分布から決める。超過分は必ず捨て札になる
    expect(DEPSDEV_TIMEOUT_MS).toBeGreaterThan(600);
    expect(DEPSDEV_TIMEOUT_MS).toBeLessThan(5_000);
  });
});

describe('複数ライセンスの意味（ポリシーまで通す）', () => {
  const ctx: PolicyContext = {
    scope: 'runtime',
    linkage: 'dynamic',
    distributionModel: 'distributed-binary',
  };

  it('Apache-2.0 + AGPL-3.0 を AND と読めば AGPL 側の判定が残る', async () => {
    const r = await fetchDepsDevGoLicense(
      'github.com/mattermost/mattermost-server',
      'v5.11.1+incompatible',
      ok({ licenses: ['Apache-2.0', 'AGPL-3.0-only'] }),
    );
    const both = evaluateExpression(r.spdx, ctx);
    const agplAlone = evaluateExpression('AGPL-3.0-only', ctx);
    // OR と読むと Apache-2.0 が選べてしまい、この一致が崩れる
    expect(both.verdict).toBe(agplAlone.verdict);
    expect(both.verdict).not.toBe('allowed');
  });

  it('解釈できないライセンス名を落とさない（残せば review に倒れる）', async () => {
    const r = await fetchDepsDevGoLicense('m', 'v1', ok({ licenses: ['MIT', 'non-standard'] }));
    expect(r.spdx).toBe('MIT AND non-standard');
    expect(evaluateExpression(r.spdx, ctx).verdict).toBe('review');
  });
});
