import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

const MODULE_LINE = /^([A-Za-z0-9._~/-]+\.[A-Za-z0-9._~/-]+)\s+(v[^\s]+)$/;

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
