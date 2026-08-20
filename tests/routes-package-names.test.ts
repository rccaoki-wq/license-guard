import { describe, expect, it } from 'vitest';
import app from '../src/index';

function fakeEnv() {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() { return null; },
              async run() { return { success: true }; },
            };
          },
          async all() { return { results: [] }; },
        };
      },
    } as unknown as D1Database,
  };
}

const status = async (path: string) => (await app.request(path, {}, fakeEnv())).status;

describe('スコープ付き npm パッケージのURL', () => {
  it('リテラルのスラッシュ形式を受け付ける', async () => {
    // 人もエージェントも自然にこの形を組み立てる
    expect(await status('/api/pkg/npm/@angular/core')).not.toBe(404);
    expect(await status('/pkg/npm/@types/node')).not.toBe(404);
  });

  it('パーセントエンコード形式も従来どおり受け付ける', async () => {
    expect(await status('/api/pkg/npm/%40angular%2Fcore')).not.toBe(404);
    expect(await status('/pkg/npm/%40types%2Fnode')).not.toBe(404);
  });

  it('スコープが二重のものは拒否する', async () => {
    expect(await status('/api/pkg/npm/@a/@b/c')).toBe(400);
  });
});

describe('パッケージ名の形式検証', () => {
  it('npm の不正な名前を拒否する', async () => {
    expect(await status('/api/pkg/npm/has space')).toBe(400);
    expect(await status('/api/pkg/npm/a/b/c')).toBe(400);
    expect(await status('/api/pkg/npm/' + 'a'.repeat(300))).toBe(400);
  });

  it('pypi の不正な名前を拒否する', async () => {
    expect(await status('/api/pkg/pypi/has%20space')).toBe(400);
    expect(await status('/api/pkg/pypi/a/b')).toBe(400);
  });

  it('go のスキーム付きを拒否する（従来どおり）', async () => {
    expect(await status('/api/pkg/go/https://evil.com/x')).toBe(400);
  });

  it('正当な名前は通す', async () => {
    for (const p of [
      '/api/pkg/npm/express',
      '/api/pkg/npm/@types/node',
      '/api/pkg/pypi/requests',
      '/api/pkg/pypi/zope.interface',
      '/api/pkg/go/github.com/gin-gonic/gin',
    ]) {
      expect(await status(p), p).not.toBe(400);
    }
  });

  it('HTMLページ側も同じ検証をする', async () => {
    expect(await status('/pkg/npm/has space')).toBe(404);
    expect(await status('/pkg/npm/express')).not.toBe(404);
  });
});
