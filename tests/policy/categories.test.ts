import { describe, expect, it } from 'vitest';
import { categorize } from '../../src/policy/categories';

describe('categorize', () => {
  it('MIT を permissive に分類する', () => {
    expect(categorize('MIT')).toBe('permissive');
  });

  it('AGPL-3.0 系を network-copyleft に分類する', () => {
    expect(categorize('AGPL-3.0-only')).toBe('network-copyleft');
    expect(categorize('AGPL-3.0-or-later')).toBe('network-copyleft');
    expect(categorize('AGPL-3.0')).toBe('network-copyleft');
  });

  it('GPL を strong-copyleft に分類する', () => {
    expect(categorize('GPL-3.0-only')).toBe('strong-copyleft');
    expect(categorize('GPL-2.0')).toBe('strong-copyleft');
  });

  it('LGPL / MPL を weak-copyleft に分類する', () => {
    expect(categorize('LGPL-3.0-only')).toBe('weak-copyleft');
    expect(categorize('MPL-2.0')).toBe('weak-copyleft');
  });

  it('SSPL / BSL / Elastic を source-available に分類する', () => {
    expect(categorize('SSPL-1.0')).toBe('source-available');
    expect(categorize('BUSL-1.1')).toBe('source-available');
    expect(categorize('Elastic-2.0')).toBe('source-available');
  });

  it('NC 系を non-commercial に分類する', () => {
    expect(categorize('CC-BY-NC-4.0')).toBe('non-commercial');
  });

  it('大文字小文字を無視する', () => {
    expect(categorize('mit')).toBe('permissive');
  });

  it('未知の識別子を unknown に分類する', () => {
    expect(categorize('WTF-9000')).toBe('unknown');
  });
});
