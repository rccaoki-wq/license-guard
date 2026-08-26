import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

const MODULE_LINE = /^([A-Za-z0-9._~/-]+\.[A-Za-z0-9._~/-]+)\s+(v[^\s]+)$/;

/**
 * go.mod か。
 *
 * **`module` は go.mod の専有語ではない。** TOML の代入キーにも普通に現れる。
 * 以前の判定は `/^module\s+\S+/` で、`\S+` が `=` に当たるため
 * `module = ["pygments.*"]` の行が module 宣言として通っていた。実在の
 * pyproject.toml（Textualize/rich）が Go と判定され、go.mod として読まれ、
 * 依存 0 件で「No dependencies were found」が返っていた。mypy の overrides は
 * ほぼどの Python プロジェクトにもあるので、これは珍しい入力ではない。
 *
 * module 宣言の引数はモジュールパスであって代入ではない。だから
 * **「module で始まるか」ではなく「module 宣言の形か」**を見る。
 * `require (` も同様に、行がそこで終わることまで見る（Ruby の
 * `require('x')` のような別言語の呼び出しと形が違う）。
 */
export function isGoMod(content: string): boolean {
  return (
    /^module\s+"?[^\s"=:]+"?\s*(?:\/\/.*)?$/m.test(content) ||
    /^require\s*\(\s*(?:\/\/.*)?$/m.test(content)
  );
}

/**
 * go.mod から require の依存を抽出する。
 * go.mod には dev/runtime の区別が存在しないため、全て runtime とする。
 */
export function parseGoMod(content: string): Dependency[] {
  const out: Dependency[] = [];
  let block: 'require' | 'other' | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = (rawLine.split('//')[0] ?? '').trim();
    if (line === '') continue;

    if (line === ')') {
      block = null;
      continue;
    }

    const openBlock = /^(require|replace|exclude|retract)\s*\($/.exec(line);
    if (openBlock) {
      block = openBlock[1] === 'require' ? 'require' : 'other';
      continue;
    }

    const single = /^require\s+(.+)$/.exec(line);
    if (single && single[1]) {
      const m = MODULE_LINE.exec(single[1].trim());
      if (m && m[1] && m[2] && isSafePackageName(m[1])) {
        out.push({ ecosystem: 'go', name: m[1], version: m[2], scope: 'runtime' });
      }
      continue;
    }

    if (block !== 'require') continue;

    const m = MODULE_LINE.exec(line);
    if (m && m[1] && m[2] && isSafePackageName(m[1])) {
      out.push({ ecosystem: 'go', name: m[1], version: m[2], scope: 'runtime' });
    }
  }

  return out;
}
