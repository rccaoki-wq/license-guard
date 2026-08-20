import { describe, expect, it } from 'vitest';
import { categorize } from '../../src/policy/categories';
import { normalizeLicenseString } from '../../src/policy/normalize';
import { evaluateExpression } from '../../src/policy/engine';
import type { PolicyContext } from '../../src/types';

const ctx: PolicyContext = {
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'saas',
};

describe('SPDX 語彙の網羅', () => {
  it('実在するがマイナーな permissive を認識する', () => {
    for (const id of [
      'BlueOak-1.0.0',
      'BSL-1.0',
      'Artistic-2.0',
      'WTFPL',
      'NCSA',
      'X11',
      'libpng',
      'Ruby',
      'PostgreSQL',
    ]) {
      expect(categorize(id), id).toBe('permissive');
    }
  });

  it('Boost(BSL-1.0) と Business Source(BSL-1.1) を取り違えない', () => {
    // 紛らわしいが片方は permissive、もう片方は商用提供を制限する
    expect(categorize('BSL-1.0')).toBe('permissive');
    expect(categorize('BSL-1.1')).toBe('source-available');
    expect(categorize('BUSL-1.1')).toBe('source-available');
  });
});

describe('npm の旧表記の正規化', () => {
  it('MIT/X11 を MIT に正規化する', () => {
    expect(normalizeLicenseString('MIT/X11')).toBe('MIT');
  });

  it('ライセンス族の総称を、その族に共通する性質で解釈する', () => {
    expect(categorize(normalizeLicenseString('BSD'))).toBe('permissive');
    expect(categorize(normalizeLicenseString('Apache'))).toBe('permissive');
    // 総称の GPL は最も制約の強い解釈に倒す
    expect(categorize(normalizeLicenseString('GPL'))).toBe('strong-copyleft');
    expect(categorize(normalizeLicenseString('LGPL'))).toBe('library-copyleft');
    expect(categorize(normalizeLicenseString('AGPL'))).toBe('network-copyleft');
  });

  it('Public Domain 表記を扱う', () => {
    expect(categorize(normalizeLicenseString('Public Domain'))).toBe('public-domain');
  });

  it('既に SPDX の文字列は変更しない', () => {
    expect(normalizeLicenseString('Apache-2.0')).toBe('Apache-2.0');
    expect(normalizeLicenseString('(MIT OR Apache-2.0)')).toBe('(MIT OR Apache-2.0)');
  });

  it('未知の文字列はそのまま返す（勝手に決めつけない）', () => {
    expect(normalizeLicenseString('Weird-Custom-Thing')).toBe('Weird-Custom-Thing');
  });
});

describe('正規化が判定に効く', () => {
  it('BlueOak-1.0.0 が review でなく allowed になる', () => {
    expect(evaluateExpression('BlueOak-1.0.0', ctx).verdict).toBe('allowed');
  });

  it('MIT/X11 が review でなく allowed になる', () => {
    expect(evaluateExpression('MIT/X11', ctx).verdict).toBe('allowed');
  });

  it('BSD が review でなく allowed になる', () => {
    expect(evaluateExpression('BSD', ctx).verdict).toBe('allowed');
  });

  it('本当に未知のものは review のまま', () => {
    expect(evaluateExpression('Weird-Custom-Thing', ctx).verdict).toBe('review');
  });
});
