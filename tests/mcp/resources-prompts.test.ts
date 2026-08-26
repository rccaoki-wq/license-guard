/**
 * リソースとプロンプト。
 *
 * 見張りどころは「同じ問いに 2 つの答えを持たせない」こと。リソースの判定表は
 * verdictMatrix() から生成しており、ツールの答えと食い違ってはいけない。
 */
import { describe, expect, it } from 'vitest';
import { handleMcpRequest } from '../../src/mcp/handler';
import { handleLocalMessage, MemoryCache } from '../../src/local/stdio-core';
import {
  RESOURCE_DESCRIPTORS,
  parseLicenseUri,
  readResource,
  renderLicenseResource,
} from '../../src/mcp/resources';
import { PROMPT_DESCRIPTORS, getPrompt } from '../../src/mcp/prompts';
import { LICENSE_CATALOG } from '../../src/seo/catalog';
import { verdictMatrix } from '../../src/policy/matrix';
import type { CacheLike } from '../../src/resolver';

const cache: CacheLike = {
  async get() {
    return null;
  },
  async put() {},
};

const look = async () => ({ spdx: null });
const ctx = { cache, fetchers: { npm: look, pypi: look, go: look, cargo: look, rubygems: look, nuget: look } };

function post(body: unknown) {
  return new Request('https://license-guard.rcc-aoki.workers.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const rpc = async (body: unknown) => (await handleMcpRequest(post(body), ctx)).json() as any;

describe('リソースの一覧', () => {
  it('カタログの全ライセンスを出す', () => {
    expect(RESOURCE_DESCRIPTORS).toHaveLength(LICENSE_CATALOG.length);
  });

  it('URI が一意', () => {
    expect(new Set(RESOURCE_DESCRIPTORS.map((r) => r.uri)).size).toBe(RESOURCE_DESCRIPTORS.length);
  });

  it('必須項目が埋まっている', () => {
    for (const r of RESOURCE_DESCRIPTORS) {
      expect(r.uri).toMatch(/^licenseguard:\/\/license\/.+/);
      expect(r.name).not.toBe('');
      expect(r.title).not.toBe('');
      expect(r.description).not.toBe('');
      expect(r.mimeType).toBe('text/markdown');
    }
  });
});

describe('parseLicenseUri', () => {
  it('自分のスキームだけ受ける', () => {
    expect(parseLicenseUri('licenseguard://license/MIT')).toBe('MIT');
    expect(parseLicenseUri('https://example.com/MIT')).toBeNull();
    expect(parseLicenseUri('licenseguard://other/MIT')).toBeNull();
  });

  it('空の識別子を弾く', () => {
    expect(parseLicenseUri('licenseguard://license/')).toBeNull();
  });

  it('文字列でないものを弾く', () => {
    expect(parseLicenseUri(null)).toBeNull();
    expect(parseLicenseUri(42)).toBeNull();
    expect(parseLicenseUri({})).toBeNull();
  });
});

describe('リソースの中身', () => {
  it('未知のライセンスは null', () => {
    expect(renderLicenseResource('NOT-A-LICENSE')).toBeNull();
    expect(readResource('licenseguard://license/NOT-A-LICENSE')).toBeNull();
  });

  it('全配布モデルの行を含む', () => {
    const md = renderLicenseResource('AGPL-3.0-only')!;
    for (const row of verdictMatrix('AGPL-3.0-only')) {
      expect(md).toContain(row.verdict);
    }
    expect(md.split('\n').filter((l) => l.startsWith('| ')).length).toBeGreaterThanOrEqual(6);
  });

  it('ツールの判定と食い違わない（同じ問いに2つの答えを持たせない）', () => {
    for (const l of LICENSE_CATALOG) {
      const md = renderLicenseResource(l.id)!;
      for (const row of verdictMatrix(l.id)) {
        // 判定理由がそのまま載っていること。文言を作り直していれば落ちる
        expect(md).toContain(row.rationale);
      }
    }
  });

  it('dev スコープの免除を明示する（表だけ読んで誤解させない）', () => {
    expect(renderLicenseResource('AGPL-3.0-only')!).toContain('build-time-only');
  });

  it('法的助言でないことを明示する', () => {
    expect(renderLicenseResource('MIT')!).toContain('Not legal advice');
  });

  it('読み出しは URI を返す', () => {
    const r = readResource('licenseguard://license/MIT')!;
    expect(r.contents[0]!.uri).toBe('licenseguard://license/MIT');
    expect(r.contents[0]!.mimeType).toBe('text/markdown');
  });
});

describe('プロンプト', () => {
  it('名前が一意で、必須項目が埋まっている', () => {
    expect(new Set(PROMPT_DESCRIPTORS.map((p) => p.name)).size).toBe(PROMPT_DESCRIPTORS.length);
    for (const p of PROMPT_DESCRIPTORS) {
      expect(p.title).not.toBe('');
      expect(p.description).not.toBe('');
    }
  });

  it('未知の名前は null', () => {
    expect(getPrompt('nope', {})).toBeNull();
    expect(getPrompt(null, {})).toBeNull();
  });

  it('audit_project はロックファイルを優先させる', () => {
    const p = getPrompt('audit_project', { distribution_model: 'saas' })!;
    const t = p.messages[0]!.content.text;
    expect(t).toContain('package-lock.json');
    expect(t).toContain('pnpm-lock.yaml');
    expect(t).toContain('saas');
  });

  it('audit_project は未確認を安全と報告させない', () => {
    const t = getPrompt('audit_project', { distribution_model: 'saas' })!.messages[0]!.content.text;
    expect(t).toContain('not-checked');
    expect(t).toContain('Do not present these as safe');
  });

  it('audit_project は自前の法的結論を禁じる', () => {
    const t = getPrompt('audit_project', { distribution_model: 'saas' })!.messages[0]!.content.text;
    expect(t).toContain('Do not add legal conclusions of your own');
  });

  it('compare_licenses は記憶で答えさせずツールを呼ばせる', () => {
    const t = getPrompt('compare_licenses', {
      license_a: 'AGPL-3.0-only',
      license_b: 'GPL-3.0-only',
      distribution_model: 'saas',
    })!.messages[0]!.content.text;
    expect(t).toContain('explain_license');
    expect(t).toContain('Do not answer from memory');
    expect(t).toContain('AGPL-3.0-only');
    expect(t).toContain('GPL-3.0-only');
  });

  it('引数が欠けても落ちない', () => {
    expect(() => getPrompt('audit_project', {})).not.toThrow();
    expect(() => getPrompt('compare_licenses', {})).not.toThrow();
  });
});

describe('プロトコル経由（ホスト版）', () => {
  it('capabilities に resources と prompts を宣言する', async () => {
    const j = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(j.result.capabilities.resources).toBeDefined();
    expect(j.result.capabilities.prompts).toBeDefined();
  });

  it('resources/list が答える', async () => {
    const j = await rpc({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
    expect(j.result.resources.length).toBe(LICENSE_CATALOG.length);
  });

  it('resources/templates/list は空で答える（-32601 にしない）', async () => {
    const j = await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/templates/list' });
    expect(j.result.resourceTemplates).toEqual([]);
  });

  it('resources/read が中身を返す', async () => {
    const j = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri: 'licenseguard://license/AGPL-3.0-only' },
    });
    expect(j.result.contents[0].text).toContain('AGPL-3.0');
  });

  it('未知のリソースは -32602', async () => {
    const j = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/read',
      params: { uri: 'licenseguard://license/NOPE' },
    });
    expect(j.error.code).toBe(-32602);
  });

  it('prompts/list が答える', async () => {
    const j = await rpc({ jsonrpc: '2.0', id: 6, method: 'prompts/list' });
    expect(j.result.prompts.map((p: { name: string }) => p.name)).toEqual([
      'audit_project',
      'compare_licenses',
    ]);
  });

  it('prompts/get が中身を返す', async () => {
    const j = await rpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'prompts/get',
      params: { name: 'audit_project', arguments: { distribution_model: 'saas' } },
    });
    expect(j.result.messages[0].content.text).toContain('package-lock.json');
  });

  it('未知のプロンプトは -32602', async () => {
    const j = await rpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'prompts/get',
      params: { name: 'nope' },
    });
    expect(j.error.code).toBe(-32602);
  });
});

describe('ホスト版とローカル版が一致する', () => {
  const local = (msg: unknown) =>
    handleLocalMessage(msg as any, { cache: new MemoryCache(), fetchers: ctx.fetchers } as any);

  it('resources/list が同じ', async () => {
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    expect(l.result).toEqual(h.result);
  });

  it('resources/read が同じ', async () => {
    const params = { uri: 'licenseguard://license/AGPL-3.0-only' };
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/read', params });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'resources/read', params });
    expect(l.result).toEqual(h.result);
  });

  it('prompts/list が同じ', async () => {
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'prompts/list' });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'prompts/list' });
    expect(l.result).toEqual(h.result);
  });

  it('prompts/get が同じ', async () => {
    const params = { name: 'compare_licenses', arguments: { license_a: 'MIT', license_b: 'GPL-3.0-only', distribution_model: 'saas' } };
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params });
    expect(l.result).toEqual(h.result);
  });

  it('resources/templates/list が同じ（どちらも空で答える）', async () => {
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/templates/list' });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'resources/templates/list' });
    expect(l.result).toEqual(h.result);
    expect(l.result.resourceTemplates).toEqual([]);
  });

  // 正常系だけ揃えても、壊れ方が揃っていなければ経路の違いが表に出る。
  // 「ホスト版では -32602、ローカル版では例外」のような食い違いは、
  // 利用者から見れば同じ製品が場所によって違うふるまいをすることになる。
  it('未知リソースの拒否が同じ', async () => {
    const params = { uri: 'licenseguard://license/NOPE' };
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/read', params });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'resources/read', params });
    expect(l.error).toEqual(h.error);
    expect(l.error.code).toBe(-32602);
  });

  it('スキーム違いの URI の拒否が同じ', async () => {
    const params = { uri: 'https://example.com/MIT' };
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/read', params });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'resources/read', params });
    expect(l.error).toEqual(h.error);
  });

  it('uri 欠落の拒否が同じ', async () => {
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: {} });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: {} });
    expect(l.error).toEqual(h.error);
  });

  it('未知プロンプトの拒否が同じ', async () => {
    const params = { name: 'no-such-prompt' };
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params });
    expect(l.error).toEqual(h.error);
    expect(l.error.code).toBe(-32602);
  });

  it('引数なしのプロンプト取得が同じ（落ちない）', async () => {
    const params = { name: 'audit_project' };
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params });
    expect(l.result).toEqual(h.result);
  });

  it('未知ツールの拒否が同じ', async () => {
    const params = { name: 'no_such_tool', arguments: {} };
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
    expect(l.error).toEqual(h.error);
  });

  it('ツール名が文字列でない場合の拒否が同じ', async () => {
    const params = { name: 42, arguments: {} };
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
    expect(l.error).toEqual(h.error);
  });

  it('未知メソッドの拒否が同じ', async () => {
    const h = await rpc({ jsonrpc: '2.0', id: 1, method: 'no/such/method' });
    const l: any = await local({ jsonrpc: '2.0', id: 1, method: 'no/such/method' });
    expect(l.error).toEqual(h.error);
    expect(l.error.code).toBe(-32601);
  });
});
