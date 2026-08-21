import { describe, expect, it } from 'vitest';
import { FAVICON_SVG } from '../../src/ui/favicon';

describe('ファビコン', () => {
  it('SVG として妥当な入れ物になっている', () => {
    expect(FAVICON_SVG.startsWith('<svg')).toBe(true);
    expect(FAVICON_SVG.endsWith('</svg>')).toBe(true);
    expect(FAVICON_SVG).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(FAVICON_SVG).toContain('viewBox="0 0 32 32"');
  });

  it('名前空間以外の外部URLを含まない（カタログに貼られるので自己完結させる）', () => {
    const withoutNs = FAVICON_SVG.replace('http://www.w3.org/2000/svg', '');
    expect(/https?:\/\//.test(withoutNs)).toBe(false);
  });

  it('スクリプトを含まない', () => {
    expect(FAVICON_SVG).not.toContain('<script');
    expect(FAVICON_SVG).not.toContain('onload');
  });

  it('判定の色をそのまま使う（緑と赤で意味を持たせている）', () => {
    expect(FAVICON_SVG).toContain('#0a7c3f');
    expect(FAVICON_SVG).toContain('#b3261e');
  });

  it('1行で、行が膨らまない大きさに収まっている', () => {
    expect(FAVICON_SVG.includes('\n')).toBe(false);
    expect(FAVICON_SVG.length).toBeLessThan(2000);
  });

  it('アクセシブルな名前を持つ', () => {
    expect(FAVICON_SVG).toContain('aria-label="LicenseGuard"');
  });
});
