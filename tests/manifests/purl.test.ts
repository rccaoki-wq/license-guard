import { describe, expect, it } from 'vitest';
import { parsePurl, purlType } from '../../src/manifests/purl';

describe('parsePurl', () => {
  it('版まで含めて読む', () => {
    expect(parsePurl('pkg:npm/lodash@4.17.21')).toEqual({
      ecosystem: 'npm',
      name: 'lodash',
      version: '4.17.21',
    });
  });

  it('版が無ければ null（欠けているだけで、壊れてはいない）', () => {
    expect(parsePurl('pkg:npm/lodash')).toEqual({
      ecosystem: 'npm',
      name: 'lodash',
      version: null,
    });
  });

  it('npm の scope は %40 で符号化されていても復元する', () => {
    expect(parsePurl('pkg:npm/%40angular/core@17.0.0')).toEqual({
      ecosystem: 'npm',
      name: '@angular/core',
      version: '17.0.0',
    });
  });

  /**
   * 生成器によっては `@` をそのまま書く。**位置 0 の `@` を版の区切りと
   * 読むと**、名前が空になり版が `angular/core@17.0.0` になる。
   * 名前が空の依存は照会もできないので、静かに 1 件消える
   */
  it('符号化されていない scope の `@` を版と読まない', () => {
    expect(parsePurl('pkg:npm/@angular/core@17.0.0')).toEqual({
      ecosystem: 'npm',
      name: '@angular/core',
      version: '17.0.0',
    });
  });

  /**
   * Go のモジュールパスは namespace と name を繋いだもの。
   * 最後の 1 つだけ採ると `mux` になり、proxy.golang.org に存在しない
   */
  it('Go は namespace を繋いでモジュールパスに戻す', () => {
    expect(parsePurl('pkg:golang/github.com/gorilla/mux@v1.8.1')).toEqual({
      ecosystem: 'go',
      name: 'github.com/gorilla/mux',
      version: 'v1.8.1',
    });
  });

  it('NuGet は namespace を持たないので最後の 1 段だけ採る', () => {
    expect(parsePurl('pkg:nuget/Newtonsoft.Json@13.0.3')).toEqual({
      ecosystem: 'nuget',
      name: 'Newtonsoft.Json',
      version: '13.0.3',
    });
  });

  it('gem は rubygems、pypi はそのまま', () => {
    expect(parsePurl('pkg:gem/nokogiri@1.16.0')?.ecosystem).toBe('rubygems');
    expect(parsePurl('pkg:pypi/requests@2.31.0')?.ecosystem).toBe('pypi');
    expect(parsePurl('pkg:cargo/serde@1.0.197')?.ecosystem).toBe('cargo');
  });

  it('qualifiers と subpath は座標に関係しないので落とす', () => {
    expect(parsePurl('pkg:npm/lodash@4.17.21?arch=x64#dist/index.js')).toEqual({
      ecosystem: 'npm',
      name: 'lodash',
      version: '4.17.21',
    });
  });

  it('`pkg:/` のように余分な斜線があっても読む', () => {
    expect(parsePurl('pkg://npm/lodash@1.0.0')?.name).toBe('lodash');
  });

  it('対応していない type は null（呼び出し側が件数を数えて開示する）', () => {
    expect(parsePurl('pkg:maven/org.apache/commons-lang3@3.14.0')).toBeNull();
    expect(parsePurl('pkg:deb/debian/curl@7.88.1')).toBeNull();
    expect(parsePurl('pkg:composer/monolog/monolog@3.5.0')).toBeNull();
  });

  it('purl でないもの・壊れたものは null。例外は投げない', () => {
    for (const bad of ['', 'lodash@1.0.0', 'pkg:', 'pkg:npm', 'pkg:npm/', 'pkg:/npm', 'https://x']) {
      expect(parsePurl(bad)).toBeNull();
    }
  });

  /** percent-decode に失敗しても落とさない。読めなければ元の文字列のまま */
  it('壊れた percent-encoding で例外を投げない', () => {
    expect(() => parsePurl('pkg:npm/%ZZbad@1.0.0')).not.toThrow();
    expect(parsePurl('pkg:npm/%ZZbad@1.0.0')?.name).toBe('%ZZbad');
  });
});

describe('purlType', () => {
  /**
   * 非対応の成分を「何が何件あったか」で開示するための値。
   * **parsePurl が null を返す入力でも type だけは返せる**——それが要点
   */
  it('対応していない type でも名前は返す', () => {
    expect(purlType('pkg:maven/org.apache/commons-lang3@3.14.0')).toBe('maven');
    expect(purlType('pkg:DEB/debian/curl@7.88.1')).toBe('deb');
  });

  it('purl でなければ null', () => {
    expect(purlType('commons-lang3')).toBeNull();
    expect(purlType('pkg:npm')).toBeNull();
  });
});
