import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/ui/page';

describe('renderPage', () => {
  it('免責文を含む', () => {
    expect(renderPage()).toContain('法的助言ではありません');
  });

  it('配布モデルの選択肢を全て含む', () => {
    const html = renderPage();
    for (const v of [
      'saas',
      'distributed-binary',
      'on-prem-delivery',
      'internal-only',
      'library-published',
    ]) {
      expect(html).toContain(`value="${v}"`);
    }
  });

  it('有料レポートCTAを含む', () => {
    expect(renderPage()).toContain('id="cta-paid-report"');
  });

  it('ダークモードに対応している', () => {
    expect(renderPage()).toContain('prefers-color-scheme: dark');
  });
});
