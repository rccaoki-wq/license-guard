/**
 * 宣言したスキーマと、実際に返す値が一致していること。
 *
 * **嘘のスキーマは、無いスキーマより悪い。** クライアントは宣言を信じて
 * 構造化結果を組み立てるので、宣言と中身が食い違うと、こちらは正常応答を
 * 返しているのに向こうで壊れる。手で書いた JSON Schema は必ずずれるので、
 * 実際の出力を当てて固定する。
 *
 * ajv は devDependencies に**明示的に**入れてある。当初は
 * `@modelcontextprotocol/sdk` の推移的依存を借りていたが、それは
 * 「宣言していない依存に頼る」ことに他ならない。SDK が ajv を落とした日に、
 * このテストが「モジュールが見つからない」という無関係な顔で落ちる。
 *
 * ライセンスと依存関係を扱う道具が、自分の依存を宣言しないのは筋が通らない。
 */
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS, callTool } from '../../src/mcp/tools';
import type { CacheLike } from '../../src/resolver';

const cache: CacheLike = {
  async get() {
    return null;
  },
  async put() {},
};

const ctx = {
  cache,
  fetchers: {
    npm: async () => ({ spdx: 'MIT' }),
    pypi: async () => ({ spdx: 'AGPL-3.0-only' }),
    go: async () => ({ spdx: null }),
    cargo: async () => ({ spdx: null }),
    rubygems: async () => ({ spdx: null }),
  },
};

// MCP のスキーマは JSON Schema のうち構造だけを使う。厳密モードは通らない
const ajv = new Ajv({ strict: false, allErrors: true });

const byName = Object.fromEntries(TOOL_DEFINITIONS.map((t) => [t.name, t]));

async function call(name: string, args: Record<string, unknown>) {
  return callTool(name, args, ctx as never);
}

function validate(name: string, value: unknown) {
  const schema = (byName[name] as { outputSchema?: object }).outputSchema;
  if (!schema) throw new Error(`${name} has no outputSchema`);
  const check = ajv.compile(schema);
  const ok = check(value);
  return { ok, errors: check.errors };
}

describe('ツール定義の体裁', () => {
  it('全ツールが outputSchema を持つ', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect((t as { outputSchema?: object }).outputSchema, t.name).toBeDefined();
    }
  });

  it('全ツールが annotations を持つ', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect((t as { annotations?: object }).annotations, t.name).toBeDefined();
    }
  });

  it('全ツールが読み取り専用・非破壊・冪等だと宣言する', () => {
    for (const t of TOOL_DEFINITIONS) {
      const a = (t as { annotations: Record<string, boolean> }).annotations;
      expect(a.readOnlyHint, t.name).toBe(true);
      expect(a.destructiveHint, t.name).toBe(false);
      expect(a.idempotentHint, t.name).toBe(true);
      // 答えが外部レジストリの状態に依存するので、閉じた世界だと偽らない
      expect(a.openWorldHint, t.name).toBe(true);
    }
  });

  it('inputSchema が required を宣言する（何が必須か伝わらないと使えない）', () => {
    for (const t of TOOL_DEFINITIONS) {
      const req = (t.inputSchema as unknown as { required?: readonly string[] }).required;
      expect(req, t.name).toBeDefined();
      expect(req!.length, t.name).toBeGreaterThan(0);
      // required に挙げた名前が properties に実在すること
      const props = Object.keys((t.inputSchema as unknown as { properties: object }).properties);
      for (const r of req!) expect(props, `${t.name}.${r}`).toContain(r);
    }
  });

  it('全ツールに title と description がある', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect((t as { title?: string }).title, t.name).toBeTruthy();
      expect(t.description.length, t.name).toBeGreaterThan(80);
    }
  });

  it('全パラメータに説明がある（型だけでは何を入れるか分からない）', () => {
    for (const t of TOOL_DEFINITIONS) {
      const props = (t.inputSchema as unknown as { properties: Record<string, { description?: string }> })
        .properties;
      for (const [k, v] of Object.entries(props)) {
        expect(v.description, `${t.name}.${k}`).toBeTruthy();
      }
    }
  });
});

describe('宣言した outputSchema が実際の返り値と一致する', () => {
  it('check_dependency_license', async () => {
    const r = await call('check_dependency_license', {
      ecosystem: 'pypi',
      name: 'pyload-ng',
      distribution_model: 'saas',
    });
    const { ok, errors } = validate('check_dependency_license', r.structuredContent);
    expect(errors ?? [], JSON.stringify(errors)).toHaveLength(0);
    expect(ok).toBe(true);
  });

  it('check_manifest_licenses', async () => {
    const r = await call('check_manifest_licenses', {
      content: JSON.stringify({ dependencies: { express: '4.18.2', other: '1.0.0' } }),
      distribution_model: 'saas',
    });
    const { ok, errors } = validate('check_manifest_licenses', r.structuredContent);
    expect(errors ?? [], JSON.stringify(errors)).toHaveLength(0);
    expect(ok).toBe(true);
  });

  it('check_manifest_licenses（ロックファイル経路）', async () => {
    const r = await call('check_manifest_licenses', {
      content: JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/a': { version: '1.0.0', license: 'AGPL-3.0-only' } },
      }),
      distribution_model: 'saas',
    });
    const { ok, errors } = validate('check_manifest_licenses', r.structuredContent);
    expect(errors ?? [], JSON.stringify(errors)).toHaveLength(0);
    expect(ok).toBe(true);
  });

  it('explain_license', async () => {
    const r = await call('explain_license', { license: 'AGPL-3.0-only' });
    const { ok, errors } = validate('explain_license', r.structuredContent);
    expect(errors ?? [], JSON.stringify(errors)).toHaveLength(0);
    expect(ok).toBe(true);
  });

  it('explain_license（LGPL の静的リンク）', async () => {
    const r = await call('explain_license', { license: 'LGPL-3.0-only', linkage: 'static' });
    const { ok, errors } = validate('explain_license', r.structuredContent);
    expect(errors ?? [], JSON.stringify(errors)).toHaveLength(0);
    expect(ok).toBe(true);
  });

  it('解決できなかった依存でもスキーマを満たす', async () => {
    const r = await call('check_dependency_license', {
      ecosystem: 'go',
      name: 'github.com/x/unresolvable',
      distribution_model: 'saas',
    });
    const { ok, errors } = validate('check_dependency_license', r.structuredContent);
    expect(errors ?? [], JSON.stringify(errors)).toHaveLength(0);
    expect(ok).toBe(true);
  });
});
