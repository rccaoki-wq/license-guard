import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan';
import type { CacheLike } from '../src/resolver';

function noopCache(): CacheLike {
  return {
    async get() {
      return null;
    },
    async put() {},
  };
}

const fetchers = (map: Record<string, string | null>) => {
  const look = async (n: string) => ({ spdx: map[n] ?? null });
  return { npm: look, pypi: look, go: look, cargo: look, rubygems: look, nuget: look };
};

describe('scan', () => {
  it('package.json を判定して findings を返す', async () => {
    const content = JSON.stringify({
      dependencies: { express: '4.18.2' },
      devDependencies: { 'some-agpl-tool': '1.0.0' },
    });

    const result = await scan(
      content,
      'saas',
      noopCache(),
      fetchers({ express: 'MIT', 'some-agpl-tool': 'AGPL-3.0-only' }),
    );

    expect(result.ecosystem).toBe('npm');
    expect(result.findings).toHaveLength(2);

    const express = result.findings.find((f) => f.name === 'express')!;
    expect(express.verdict).toBe('allowed');

    // devDependency の AGPL は警告しない（差別化の中核）
    const tool = result.findings.find((f) => f.name === 'some-agpl-tool')!;
    expect(tool.verdict).toBe('allowed');
  });

  it('runtime の AGPL を SaaS で blocked にする', async () => {
    const content = JSON.stringify({ dependencies: { 'agpl-lib': '1.0.0' } });
    const result = await scan(
      content,
      'saas',
      noopCache(),
      fetchers({ 'agpl-lib': 'AGPL-3.0-only' }),
    );
    expect(result.findings[0]!.verdict).toBe('blocked');
    expect(result.summary.blocked).toBe(1);
  });

  it('同じ依存でも internal-only なら allowed になる', async () => {
    const content = JSON.stringify({ dependencies: { 'agpl-lib': '1.0.0' } });
    const result = await scan(
      content,
      'internal-only',
      noopCache(),
      fetchers({ 'agpl-lib': 'AGPL-3.0-only' }),
    );
    expect(result.findings[0]!.verdict).toBe('allowed');
  });

  it('解決できない依存は review にする（blocked にしない）', async () => {
    // 上流レジストリの障害やタイムアウトを「ライセンス不在」と断定してはならない。
    // 偽陽性は信頼を損なうため、判定不能は review に倒す。
    const content = JSON.stringify({ dependencies: { mystery: '1.0.0' } });
    const result = await scan(content, 'saas', noopCache(), fetchers({}));
    expect(result.findings[0]!.resolvedFrom).toBe('unresolved');
    expect(result.findings[0]!.verdict).toBe('review');
    expect(result.summary.review).toBe(1);
  });

  it('解決できない依存の理由に「宣言されていない」と断定しない', async () => {
    const content = JSON.stringify({ dependencies: { mystery: '1.0.0' } });
    const result = await scan(content, 'saas', noopCache(), fetchers({}));
    expect(result.findings[0]!.rationale).toContain('could not be determined');
    expect(result.findings[0]!.rationale).not.toContain('No license is declared');
  });

  it('Go は静的リンクを既定とする', async () => {
    const content = 'module m\n\nrequire github.com/a/b v1.0.0\n';
    const result = await scan(
      content,
      'saas',
      noopCache(),
      fetchers({ 'github.com/a/b': 'LGPL-3.0-only' }),
    );
    expect(result.findings[0]!.verdict).toBe('review');
  });

  it('summary を集計する', async () => {
    const content = JSON.stringify({
      dependencies: { a: '1.0.0', b: '1.0.0', c: '1.0.0' },
    });
    const result = await scan(
      content,
      'saas',
      noopCache(),
      fetchers({ a: 'MIT', b: 'AGPL-3.0-only', c: 'SSPL-1.0' }),
    );
    expect(result.summary).toEqual({ total: 3, allowed: 1, review: 1, blocked: 1 });
  });

  it('limitations に直接依存のみである旨を含める', async () => {
    const content = JSON.stringify({ dependencies: { a: '1.0.0' } });
    const result = await scan(content, 'saas', noopCache(), fetchers({ a: 'MIT' }));
    expect(result.limitations.some((l) => l.includes('direct dependencies'))).toBe(true);
  });

  // ロックファイルを貼った人に「ロックファイルを貼れ」と返していた。
  // 推移的依存を見たかどうかは**どのパーサを通ったか**で決まるのに、
  // ライセンスをどこから読んだか（ほぼ常に registry）で判定していたため、
  // この分岐は npm では永久に false だった。
  it('package-lock.json を渡したら「直接依存のみ」と言わない', async () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/a': { version: '1.0.0' } },
    });
    const result = await scan(lock, 'saas', noopCache(), fetchers({ a: 'MIT' }));
    expect(result.limitations.some((l) => l.includes('Only direct dependencies'))).toBe(false);
    expect(result.limitations.some((l) => l.includes('Transitive dependencies are included'))).toBe(
      true,
    );
  });

  // requirements.txt を貼った人に package-lock.json を勧めていた。
  // 助言が的外れだと、出力全体の信用が落ちる
  it('直接依存のみのとき、そのエコシステムのロックファイル名で助言する', async () => {
    const result = await scan('a==1.0.0\n', 'saas', noopCache(), fetchers({ a: 'MIT' }));
    expect(result.limitations.some((l) => l.includes('Only direct dependencies'))).toBe(true);
    expect(result.limitations.some((l) => l.includes('package-lock.json'))).toBe(false);
  });

  it('フォールバックが起きていないときは無用な警告を出さない', async () => {
    // 常時警告するとオオカミ少年になる。実際に起きた場合のみ、
    // 該当する項目の理由文と limitations の両方で開示する（audit-regressions.test.ts）
    const content = JSON.stringify({ dependencies: { a: '1.0.0' } });
    const result = await scan(content, 'saas', noopCache(), fetchers({ a: 'MIT' }));
    expect(result.limitations.some((l) => l.includes('latest release'))).toBe(false);
  });
});

// 実物の go.sum（prometheus, 約390モジュール）で 180 秒待っても応答が返らなかった。
// Go は「版一覧 → ClearlyDefined を候補ごと」で 1 依存あたり複数回 5 秒を踏みうる。
// 同時 8 で最大 200 照会なら 25 バッチ直列になり、上流が遅い日は必ず溢れる。
//
// **ハングは最悪の結果**で、部分回答は既に正しく扱える経路がある。
// 時間を使い切ったら、残りは未確認として返して必ず応答する。
describe('scan の時間予算', () => {
  const slowFetchers = (delayMs: number) => {
    const look = async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return { spdx: 'MIT' };
    };
    return { npm: look, pypi: look, go: look, cargo: look, rubygems: look, nuget: look };
  };

  const manyDeps = (n: number) =>
    JSON.stringify({
      dependencies: Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`pkg-${i}`, '1.0.0']),
      ),
    });

  it('上流が遅くても予算内に応答する', async () => {
    const started = Date.now();
    const result = await scan(manyDeps(160), 'saas', noopCache(), slowFetchers(30), 200);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.findings).toHaveLength(160);
  });

  it('打ち切った分は解決済みだと偽らず、未確認として返す', async () => {
    const result = await scan(manyDeps(160), 'saas', noopCache(), slowFetchers(30), 200);
    const unchecked = result.findings.filter((f) => f.resolvedFrom === 'not-checked');
    expect(unchecked.length).toBeGreaterThan(0);
    // 未確認を allowed に混ぜると、確認していないものを安全だと言うことになる
    expect(unchecked.every((f) => f.verdict !== 'allowed')).toBe(true);
    expect(result.limitations.some((l) => l.includes('not checked'))).toBe(true);
  });

  // バッチの手前でしか打ち切らないと、締切の直前に始まったバッチが
   // まるごと走り切る。実際に詰まるのはまさにその1バッチなので、
  // 「締切 + 上流タイムアウト」まで伸びてしまい保証にならない。
  it('締切をまたいで止まっている照会を待ち続けない', async () => {
    const started = Date.now();
    const result = await scan(manyDeps(8), 'saas', noopCache(), slowFetchers(3000), 200);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.findings.every((f) => f.resolvedFrom === 'not-checked')).toBe(true);
  });

  it('予算が足りていれば全件解決する（早すぎる打ち切りをしない）', async () => {
    const result = await scan(manyDeps(24), 'saas', noopCache(), slowFetchers(1), 10_000);
    expect(result.findings.every((f) => f.resolvedFrom !== 'not-checked')).toBe(true);
  });
});
