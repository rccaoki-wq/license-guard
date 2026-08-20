import { describe, expect, it } from 'vitest';
import { parsePackageJson } from '../../src/manifests/npm';
import { parseRequirementsTxt } from '../../src/manifests/pypi';
import { parseGoMod } from '../../src/manifests/gomod';
import { isSafePackageName } from '../../src/manifests/name-safety';

const RTL = String.fromCharCode(0x202e);
const LTR = String.fromCharCode(0x202d);
const NUL = String.fromCharCode(0);
const ZWSP = String.fromCharCode(0x200b);

describe('isSafePackageName', () => {
  it('通常の名前を通す', () => {
    for (const n of ['express', '@types/node', 'github.com/gin-gonic/gin', 'flask', 'a.b-c_d']) {
      expect(isSafePackageName(n), n).toBe(true);
    }
  });

  it('空文字と空白のみを拒否する', () => {
    expect(isSafePackageName('')).toBe(false);
    expect(isSafePackageName('   ')).toBe(false);
  });

  it('双方向テキスト制御文字を拒否する（表示偽装の防止）', () => {
    // "evil<U+202E>sj.lpga" は端末上で "evilagpl.js" と表示される
    expect(isSafePackageName('evil' + RTL + 'sj.lpga')).toBe(false);
    expect(isSafePackageName('a' + LTR + 'b')).toBe(false);
  });

  it('制御文字とゼロ幅文字を拒否する', () => {
    expect(isSafePackageName('a' + NUL + 'b')).toBe(false);
    expect(isSafePackageName('a' + ZWSP + 'b')).toBe(false);
  });

  it('過度に長い名前を拒否する', () => {
    expect(isSafePackageName('a'.repeat(214))).toBe(true);
    expect(isSafePackageName('a'.repeat(215))).toBe(false);
  });
});

describe('パーサが危険な名前を落とす', () => {
  it('npm: 空名と偽装名を除外する', () => {
    const deps = parsePackageJson(
      JSON.stringify({
        dependencies: { '': '1.0.0', ['evil' + RTL + 'x']: '1.0.0', express: '4.18.2' },
      }),
    );
    expect(deps.map((d) => d.name)).toEqual(['express']);
  });

  it('pypi: 制御文字を含む行を除外する', () => {
    const deps = parseRequirementsTxt(`flask==3.0.0\nbad${ZWSP}pkg==1.0.0\n`);
    expect(deps.map((d) => d.name)).toEqual(['flask']);
  });

  it('go: 偽装モジュールパスを除外する', () => {
    const deps = parseGoMod(`require (\n\tgithub.com/a/b v1.0.0\n\tgithub.com/evil${RTL}x/y v1.0.0\n)\n`);
    expect(deps.map((d) => d.name)).toEqual(['github.com/a/b']);
  });
});
