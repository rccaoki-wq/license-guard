import { describe, expect, it } from 'vitest';
import { isGemfileLock, parseGemfileLock } from '../../src/manifests/gemfile-lock';

/** 実物の Gemfile.lock から節構造をそのまま持ってきたもの */
const LOCK = `GIT
  remote: https://github.com/acme/forked_gem.git
  revision: abc123
  specs:
    forked_gem (2.0.0)
      rack (>= 2.0)

PATH
  remote: engines/billing
  specs:
    billing (0.1.0)

GEM
  remote: https://rubygems.org/
  specs:
    actioncable (7.1.3)
      actionpack (= 7.1.3)
      nio4r (~> 2.0)
    nokogiri (1.16.0-arm64-darwin)
      racc (~> 1.4)
    nokogiri (1.16.0-x86_64-linux)
      racc (~> 1.4)
    rails (7.1.3)

GEM
  remote: https://gems.acme.internal/
  specs:
    acme_internal (1.2.3)

PLATFORMS
  arm64-darwin-23
  ruby

DEPENDENCIES
  billing!
  nokogiri (~> 1.16)
  rails (~> 7.1.3)

CHECKSUMS
  actioncable (7.1.3) sha256=1111
  rails (7.1.3) sha256=2222

BUNDLED WITH
   2.5.6
`;

describe('parseGemfileLock', () => {
  const deps = parseGemfileLock(LOCK);
  const by = Object.fromEntries(deps.map((d) => [d.name, d]));

  it('specs: の下の実体だけを拾う', () => {
    expect(deps.map((d) => d.name).sort()).toEqual([
      'acme_internal',
      'actioncable',
      'billing',
      'forked_gem',
      'nokogiri',
      'rails',
    ]);
  });

  /**
   * CHECKSUMS 節は `名前 (版)` を同じ深さで並べ直すので、節を見ずに
   * 拾うと全件が二重になる。件数が倍になっても表は普通に見える
   */
  it('CHECKSUMS 節で二重に数えない', () => {
    expect(deps.filter((d) => d.name === 'rails')).toHaveLength(1);
    expect(deps.filter((d) => d.name === 'actioncable')).toHaveLength(1);
  });

  it('DEPENDENCIES 節の範囲指定を実体として拾わない', () => {
    // 拾っていれば版が `~> 7.1.3` になるか、billing! が別名で増える
    expect(by['rails']!.version).toBe('7.1.3');
    expect(deps.some((d) => d.name.endsWith('!'))).toBe(false);
  });

  it('6 スペースの依存制約を実体にしない', () => {
    // actionpack / nio4r / racc は制約行にしか出てこない
    expect(by['actionpack']).toBeUndefined();
    expect(by['nio4r']).toBeUndefined();
    expect(by['racc']).toBeUndefined();
  });

  /**
   * 版にプラットフォームが付いたまま照会すると存在しない座標になり、
   * 解決できるはずの gem が毎回空振りする
   */
  it('プラットフォーム接尾辞を落とし、複数行を 1 件にまとめる', () => {
    expect(by['nokogiri']!.version).toBe('1.16.0');
    expect(deps.filter((d) => d.name === 'nokogiri')).toHaveLength(1);
  });

  it('節から出所を読む（照会しても無いものを照会しない）', () => {
    expect(by['rails']!.origin).toBe('registry');
    expect(by['forked_gem']!.origin).toBe('git');
    expect(by['billing']!.origin).toBe('workspace');
    // 私設レジストリ。rubygems.org に問い合わせても無い
    expect(by['acme_internal']!.origin).toBe('other-registry');
  });

  it('scope は推測せず全部 runtime にする', () => {
    // group（:development / :test）は Gemfile 側にしか無く、
    // ここからは区別できない。見落としより過剰警告に倒す
    expect(deps.every((d) => d.scope === 'runtime')).toBe(true);
    expect(deps.every((d) => d.ecosystem === 'rubygems')).toBe(true);
  });

  it('CRLF でも読める', () => {
    expect(parseGemfileLock(LOCK.replace(/\n/g, '\r\n')).map((d) => d.name).sort()).toEqual(
      deps.map((d) => d.name).sort(),
    );
  });
});

describe('isGemfileLock', () => {
  it('本物を認識する', () => {
    expect(isGemfileLock(LOCK)).toBe(true);
  });

  it('`GEM` の 3 文字を含むだけの別物を拾わない', () => {
    expect(isGemfileLock('GEM STONES\nare pretty\n')).toBe(false);
    expect(isGemfileLock('specs: something\n')).toBe(false);
    // requirements.txt に DEPENDENCIES と書いてあっても specs: が無い
    expect(isGemfileLock('DEPENDENCIES\nrequests==2.31.0\n')).toBe(false);
  });
});
