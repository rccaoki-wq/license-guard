import { describe, expect, it } from 'vitest';
import { parseGoMod } from '../../src/manifests/gomod';

describe('parseGoMod', () => {
  it('require ブロック内の依存を取り出す', () => {
    const deps = parseGoMod(`module example.com/foo

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)
`);
    expect(deps).toEqual([
      {
        ecosystem: 'go',
        name: 'github.com/gin-gonic/gin',
        version: 'v1.9.1',
        scope: 'runtime',
      },
      {
        ecosystem: 'go',
        name: 'github.com/stretchr/testify',
        version: 'v1.8.4',
        scope: 'runtime',
      },
    ]);
  });

  it('単一行の require を取り出す', () => {
    const deps = parseGoMod('module m\n\nrequire github.com/x/y v1.0.0\n');
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe('github.com/x/y');
  });

  it('// indirect のコメントを除去してもパースできる', () => {
    const deps = parseGoMod('require (\n\tgithub.com/a/b v1.2.3 // indirect\n)\n');
    expect(deps[0]!.version).toBe('v1.2.3');
  });

  it('module / go 行を依存として拾わない', () => {
    const deps = parseGoMod('module example.com/foo\n\ngo 1.21\n');
    expect(deps).toEqual([]);
  });

  it('replace / exclude ブロックを無視する', () => {
    const deps = parseGoMod(`require (
	github.com/a/b v1.0.0
)

replace (
	github.com/c/d => github.com/e/f v2.0.0
)
`);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe('github.com/a/b');
  });
});
