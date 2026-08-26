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

  /**
   * **`module` は go.mod の専有語ではない。** TOML の代入キーにも普通に現れる。
   *
   * 判定が `/^module\s+\S+/` だったとき、`\S+` が `=` に当たるので
   * `module = [...]` の行が Go の module 宣言として通っていた。実在の
   * pyproject.toml（Textualize/rich）を投げると Go と判定され、go.mod として
   * 読まれ、依存 0 件で「No dependencies were found」が返る。
   * mypy の overrides はほぼどの Python プロジェクトにもあるので、
   * これは珍しい入力ではない。
   *
   * module 宣言の引数はモジュールパスであって代入ではない。**「module で
   * 始まる」ではなく「module 宣言の形か」で見る。**
   */
  it('TOML の module = ... を go.mod と取り違えない', () => {
    const rich = `[tool.poetry]
name = "rich"
license = "MIT"

[tool.poetry.dependencies]
python = ">=3.9.0"
pygments = "^2.13.0"
markdown-it-py = ">=2.2.0"

[[tool.mypy.overrides]]
module = ["pygments.*", "IPython.*", "ipywidgets.*"]
ignore_missing_imports = true
`;
    const r = detectAndParse(rich);
    expect(r.ecosystem).toBe('pypi');
    expect(r.dependencies.map((d) => d.name)).toContain('pygments');
    expect(r.dependencies.map((d) => d.name)).toContain('markdown-it-py');
  });

  it('本物の module 宣言はこれまでどおり go と判定する', () => {
    for (const src of [
      'module github.com/gorilla/mux\n\ngo 1.20\n\nrequire github.com/x/y v1.0.0\n',
      'module example.com/foo // 末尾コメント\n\nrequire github.com/x/y v1.0.0\n',
    ]) {
      expect(detectAndParse(src).ecosystem).toBe('go');
    }
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
