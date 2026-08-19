import { describe, expect, it } from 'vitest';
import { parsePackageJson } from '../../src/manifests/npm';

describe('parsePackageJson', () => {
  it('dependencies を runtime スコープで取り出す', () => {
    const deps = parsePackageJson(JSON.stringify({ dependencies: { express: '4.18.2' } }));
    expect(deps).toEqual([
      { ecosystem: 'npm', name: 'express', version: '4.18.2', scope: 'runtime' },
    ]);
  });

  it('devDependencies を dev スコープで取り出す', () => {
    const deps = parsePackageJson(JSON.stringify({ devDependencies: { vitest: '2.1.0' } }));
    expect(deps[0]!.scope).toBe('dev');
  });

  it('optionalDependencies を optional スコープで取り出す', () => {
    const deps = parsePackageJson(JSON.stringify({ optionalDependencies: { fsevents: '2.3.3' } }));
    expect(deps[0]!.scope).toBe('optional');
  });

  it('peerDependencies は対象外', () => {
    const deps = parsePackageJson(JSON.stringify({ peerDependencies: { react: '18.0.0' } }));
    expect(deps).toEqual([]);
  });

  it('キャレット・チルダ・不等号を除去して具体バージョンを得る', () => {
    const deps = parsePackageJson(
      JSON.stringify({ dependencies: { a: '^1.2.3', b: '~4.5.6', c: '>=7.8.9' } }),
    );
    expect(deps.map((d) => d.version)).toEqual(['1.2.3', '4.5.6', '7.8.9']);
  });

  it('確定できない範囲指定は version を null にする', () => {
    const deps = parsePackageJson(
      JSON.stringify({ dependencies: { a: '*', b: 'latest', c: '1.x' } }),
    );
    expect(deps.every((d) => d.version === null)).toBe(true);
  });

  it('スコープ付きパッケージ名を保持する', () => {
    const deps = parsePackageJson(JSON.stringify({ dependencies: { '@types/node': '22.0.0' } }));
    expect(deps[0]!.name).toBe('@types/node');
  });

  it('不正な JSON では例外を投げる', () => {
    expect(() => parsePackageJson('{ not json')).toThrow();
  });
});
