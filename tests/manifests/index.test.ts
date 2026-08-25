import { describe, expect, it } from 'vitest';
import { detectAndParse } from '../../src/manifests';

describe('detectAndParse', () => {
  it('JSON で dependencies を持てば npm と判定する', () => {
    const r = detectAndParse(JSON.stringify({ dependencies: { express: '4.18.2' } }));
    expect(r.ecosystem).toBe('npm');
    expect(r.dependencies).toHaveLength(1);
  });

  it('module 行があれば go と判定する', () => {
    const r = detectAndParse('module example.com/foo\n\nrequire github.com/x/y v1.0.0\n');
    expect(r.ecosystem).toBe('go');
  });

  it('require ブロックだけでも go と判定する', () => {
    const r = detectAndParse('require (\n\tgithub.com/a/b v1.0.0\n)\n');
    expect(r.ecosystem).toBe('go');
  });

  it('それ以外は pypi として扱う', () => {
    const r = detectAndParse('requests==2.31.0\nflask==3.0.0');
    expect(r.ecosystem).toBe('pypi');
    expect(r.dependencies).toHaveLength(2);
  });

  it('空入力は例外を投げる', () => {
    expect(() => detectAndParse('   ')).toThrow('Input is empty');
  });

  it('どの形式にも当たらない入力は「形式が分からない」と言う', () => {
    expect(() => detectAndParse('!!!!!')).toThrow('does not look like');
  });

  it('形式は読めたが依存が1件も無い場合は、それと分かる別の理由で失敗する', () => {
    // 「読めなかった」と「読めたが空だった」は利用者にとって別の状況。
    // 理由を共用すると、貼り直すべきか中身を見るべきかが分からなくなる
    expect(() => detectAndParse('{"name":"x","version":"1.0.0"}')).toThrow(
      'No dependencies were found',
    );
  });
});
