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

  it('依存が1件も取れない場合は例外を投げる', () => {
    expect(() => detectAndParse('!!!!!')).toThrow('No dependencies were found');
  });
});
