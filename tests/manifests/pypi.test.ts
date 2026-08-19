import { describe, expect, it } from 'vitest';
import { parseRequirementsTxt } from '../../src/manifests/pypi';

describe('parseRequirementsTxt', () => {
  it('== の固定バージョンを取り出す', () => {
    const deps = parseRequirementsTxt('requests==2.31.0');
    expect(deps).toEqual([
      { ecosystem: 'pypi', name: 'requests', version: '2.31.0', scope: 'runtime' },
    ]);
  });

  it('コメントと空行を無視する', () => {
    const deps = parseRequirementsTxt('# comment\n\nflask==3.0.0\n   \n');
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe('flask');
  });

  it('行末コメントを除去する', () => {
    const deps = parseRequirementsTxt('django==5.0  # web framework');
    expect(deps[0]!.version).toBe('5.0');
  });

  it('extras を名前から除去する', () => {
    const deps = parseRequirementsTxt('celery[redis]==5.3.0');
    expect(deps[0]!.name).toBe('celery');
    expect(deps[0]!.version).toBe('5.3.0');
  });

  it('>= などの範囲指定は version を null にする', () => {
    const deps = parseRequirementsTxt('numpy>=1.24');
    expect(deps[0]!.name).toBe('numpy');
    expect(deps[0]!.version).toBeNull();
  });

  it('バージョン指定なしを扱える', () => {
    const deps = parseRequirementsTxt('pandas');
    expect(deps[0]!).toEqual({
      ecosystem: 'pypi',
      name: 'pandas',
      version: null,
      scope: 'runtime',
    });
  });

  it('-r や -e で始まるディレクティブを無視する', () => {
    const deps = parseRequirementsTxt(
      '-r base.txt\n-e .\n--index-url https://x\nrich==13.0.0',
    );
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe('rich');
  });

  it('環境マーカーを除去する', () => {
    const deps = parseRequirementsTxt('tomli==2.0.1 ; python_version < "3.11"');
    expect(deps[0]!.name).toBe('tomli');
    expect(deps[0]!.version).toBe('2.0.1');
  });
});
