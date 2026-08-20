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

const fetchers = (map: Record<string, string | null>) => ({
  npm: async (n: string) => map[n] ?? null,
  pypi: async (n: string) => map[n] ?? null,
  go: async (n: string) => map[n] ?? null,
});

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
});
