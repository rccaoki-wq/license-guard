import { describe, expect, it, vi } from 'vitest';
import { MemoryCache, handleLocalMessage, encodeMessage, splitMessages } from '../../src/local/stdio-core';
import type { Dependency } from '../../src/types';

const fetchers = (map: Record<string, string | null>) => {
  const look = async (n: string) => ({ spdx: map[n] ?? null });
  return { npm: look, pypi: look, go: look, cargo: look, rubygems: look };
};

const dep = (over: Partial<Dependency> = {}): Dependency => ({
  ecosystem: 'npm',
  name: 'express',
  version: '4.18.2',
  scope: 'runtime',
  ...over,
});

describe('MemoryCache', () => {
  it('保存した値を返す', async () => {
    const c = new MemoryCache();
    await c.put(dep(), 'MIT', 'registry');
    expect(await c.get(dep())).toEqual({ spdx: 'MIT', source: 'registry' });
  });

  it('未登録は null', async () => {
    expect(await new MemoryCache().get(dep())).toBeNull();
  });

  it('バージョン未確定はキャッシュしない（キーが定まらない）', async () => {
    const c = new MemoryCache();
    await c.put(dep({ version: null }), 'MIT', 'registry');
    expect(await c.get(dep({ version: null }))).toBeNull();
  });

  it('getMany で一括取得できる', async () => {
    const c = new MemoryCache();
    await c.put(dep(), 'MIT', 'registry');
    const m = await c.getMany([dep(), dep({ name: 'other' })]);
    expect(m.get('npm|express|4.18.2')).toEqual({ spdx: 'MIT', source: 'registry' });
    expect(m.size).toBe(1);
  });

  it('上限を超えたら古いものから捨てる（無制限に太らせない）', async () => {
    const c = new MemoryCache(3);
    for (let i = 0; i < 5; i++) await c.put(dep({ name: 'p' + i }), 'MIT', 'registry');
    expect(await c.get(dep({ name: 'p0' }))).toBeNull();
    expect(await c.get(dep({ name: 'p4' }))).not.toBeNull();
  });
});

describe('splitMessages（改行区切りの取り出し）', () => {
  it('完結した行だけを取り出し、残りを保持する', () => {
    expect(splitMessages('{"a":1}\n{"b":2}\n{"c"')).toEqual({
      messages: ['{"a":1}', '{"b":2}'],
      rest: '{"c"',
    });
  });

  it('空行を無視する', () => {
    expect(splitMessages('\n\n{"a":1}\n\n').messages).toEqual(['{"a":1}']);
  });

  it('CRLF を扱える', () => {
    expect(splitMessages('{"a":1}\r\n').messages).toEqual(['{"a":1}']);
  });

  it('改行が無ければ何も取り出さない', () => {
    expect(splitMessages('{"a":1}')).toEqual({ messages: [], rest: '{"a":1}' });
  });
});

describe('encodeMessage', () => {
  it('1行の JSON に改行を付ける（stdio の約束）', () => {
    const out = encodeMessage({ jsonrpc: '2.0', id: 1, result: {} });
    expect(out.endsWith('\n')).toBe(true);
    expect(out.trimEnd().includes('\n')).toBe(false);
  });
});

describe('handleLocalMessage', () => {
  const ctx = (map: Record<string, string | null> = {}) => ({
    cache: new MemoryCache(),
    fetchers: fetchers(map),
  });

  it('initialize に応答する', async () => {
    const r = await handleLocalMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      ctx(),
    );
    expect(r?.result.serverInfo.name).toBe('licenseguard');
    expect(r?.result.protocolVersion).toBe('2025-06-18');
  });

  it('通知には応答しない', async () => {
    expect(
      await handleLocalMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx()),
    ).toBeNull();
  });

  it('リモート版と同じツールを列挙する', async () => {
    const r = await handleLocalMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx());
    expect(r?.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'check_dependency_license',
      'check_manifest_licenses',
      'explain_license',
    ]);
  });

  it('リモート版と同じ判定を返す', async () => {
    const r = await handleLocalMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'check_dependency_license',
          arguments: { ecosystem: 'npm', name: 'agpl-lib', distribution_model: 'saas' },
        },
      },
      ctx({ 'agpl-lib': 'AGPL-3.0-only' }),
    );
    expect(r?.result.structuredContent.verdict).toBe('blocked');
  });

  it('未知メソッドは -32601', async () => {
    const r = await handleLocalMessage({ jsonrpc: '2.0', id: 4, method: 'nope' }, ctx());
    expect(r?.error.code).toBe(-32601);
  });

  it('未知ツールは -32602', async () => {
    const r = await handleLocalMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'x', arguments: {} } },
      ctx(),
    );
    expect(r?.error.code).toBe(-32602);
  });

  it('ping に応答する', async () => {
    const r = await handleLocalMessage({ jsonrpc: '2.0', id: 6, method: 'ping' }, ctx());
    expect(r?.result).toEqual({});
  });

  it('ローカルではマニフェストが外部に出ないことを説明に含める', async () => {
    const r = await handleLocalMessage({ jsonrpc: '2.0', id: 7, method: 'initialize', params: {} }, ctx());
    expect(r?.result.instructions).toContain('never leaves');
  });
});
