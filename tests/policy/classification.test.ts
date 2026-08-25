import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/policy/engine';
import { categorize } from '../../src/policy/categories';
import type { PolicyContext } from '../../src/types';

/**
 * 識別子をカテゴリに落とす層の誤り。
 *
 * ここで取り違えると、判定の分岐そのものが別の道に入るので、
 * 下流の条項判定がどれだけ正しくても答えは間違う。しかも
 * 「知らない」ではなく「知っている顔で」返るので気づけない。
 */
const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'distributed-binary',
  ...over,
});

describe('UNLICENSED は Unlicense ではない', () => {
  // npm の "UNLICENSED" は「このパッケージにライセンスを与えない」という宣言。
  // パブリックドメイン放棄の "Unlicense" とは正反対の意味になる。
  // ロックファイルの解析はルートとワークスペースを除外済みなので、
  // ここに残る UNLICENSED は第三者の非公開パッケージを指す
  it('権利を与えない宣言として blocked になる', () => {
    const r = evaluateExpression('UNLICENSED', ctx());
    expect(r.verdict).toBe('blocked');
    expect(r.obligations).toEqual([]);
  });

  it('大小文字を問わない', () => {
    expect(evaluateExpression('unlicensed', ctx()).verdict).toBe('blocked');
  });

  it('dev 依存でも blocked のまま', () => {
    // 使用許諾そのものが無いので、配布の有無より手前で成立しない
    expect(evaluateExpression('UNLICENSED', ctx({ scope: 'dev' })).verdict).toBe('blocked');
  });

  it('宣言が無い場合とは理由文を分ける', () => {
    const declared = evaluateExpression('UNLICENSED', ctx());
    const missing = evaluateExpression('', ctx());
    expect(declared.rationale).not.toBe(missing.rationale);
  });

  it('Unlicense（本物）は従来どおり public domain', () => {
    const r = evaluateExpression('Unlicense', ctx());
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toEqual([]);
  });
});

describe('Creative Commons の条件つきは permissive ではない', () => {
  it('BY-SA は strong copyleft として扱う', () => {
    // ShareAlike は改変物を同じ条件で配ることを求める。CC 自身が
    // BY-SA 4.0 から GPL-3.0 への一方向互換を宣言しており、
    // 強いコピーレフトと同等に見られている
    expect(categorize('CC-BY-SA-4.0')).toBe('strong-copyleft');
    const r = evaluateExpression('CC-BY-SA-4.0', ctx());
    expect(r.verdict).toBe('blocked');
    expect(r.obligations).toContain('same-license');
  });

  it('BY-ND は改変物の配布を許さない', () => {
    expect(categorize('CC-BY-ND-4.0')).toBe('no-derivatives');
    expect(evaluateExpression('CC-BY-ND-4.0', ctx()).verdict).toBe('review');
  });

  it('BY-NC-SA は非商用の判定が優先される', () => {
    expect(categorize('CC-BY-NC-SA-4.0')).toBe('non-commercial');
  });

  it('条件の無い BY は permissive のまま', () => {
    expect(categorize('CC-BY-4.0')).toBe('permissive');
  });
});

describe('WTFPL は表示義務を持たない', () => {
  // 唯一の条項が「好きにしろ」であり、著作権表示の保持を求めていない
  it('public domain 相当として扱う', () => {
    expect(evaluateExpression('WTFPL', ctx()).obligations).toEqual([]);
  });
});

describe('SPDX 式として読めなくても、識別子が分かるなら答える', () => {
  // spdx-expression-parse は識別子の大小文字に厳密だが、
  // Cargo や PyPI のメタデータには小文字表記が実在する。
  // 「読めない」で review に積むと、正しく判定できたものが警告に埋もれる
  it.each([
    ['gpl-3.0-only', 'blocked'],
    ['agpl-3.0-only', 'blocked'],
    ['apache-2.0', 'allowed'],
  ])('%s を %s と判定する', (expression, verdict) => {
    expect(evaluateExpression(expression, ctx()).verdict).toBe(verdict);
  });

  it('本当に未知の文字列は従来どおり review', () => {
    expect(evaluateExpression('Some Company Internal License v3', ctx()).verdict).toBe('review');
  });
});
