import { describe, expect, it } from 'vitest';
import { isPlausibleEmail, normalizeEmail } from '../src/interest';

describe('isPlausibleEmail', () => {
  it('通常のアドレスを受け入れる', () => {
    for (const e of ['a@b.co', 'first.last+tag@example.com', 'x_y-z@sub.example.co.jp']) {
      expect(isPlausibleEmail(e), e).toBe(true);
    }
  });

  it('形になっていないものを拒否する', () => {
    for (const e of ['', 'nope', 'a@', '@b.com', 'a b@c.com', 'a@b', 'a@@b.com']) {
      expect(isPlausibleEmail(e), e).toBe(false);
    }
  });

  it('過度に長いものを拒否する', () => {
    expect(isPlausibleEmail('a'.repeat(250) + '@example.com')).toBe(false);
  });

  it('制御文字や改行を含むものを拒否する（ヘッダ注入の防止）', () => {
    expect(isPlausibleEmail('a@b.com\nBcc: victim@x.com')).toBe(false);
    expect(isPlausibleEmail('a@b.com' + String.fromCharCode(0))).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('前後の空白を落とし小文字に揃える', () => {
    expect(normalizeEmail('  A@Example.COM ')).toBe('a@example.com');
  });
});
