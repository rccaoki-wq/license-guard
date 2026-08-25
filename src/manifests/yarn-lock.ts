import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

/**
 * yarn.lock を解析する。
 *
 * v1（classic）と v2 以降（Berry）で書式が異なるが、いずれも
 * 「見出し行にパッケージ指定、続く行に version」という構造は共通なので
 * その形だけを拾う。YAML パーサは持ち込まない（Berry は YAML だが v1 は
 * 独自形式で、両方を扱うには結局この程度の走査が要る）。
 *
 * package-lock.json と違いライセンスを内包しないため、解決には上流照会か
 * 共有キャッシュが必要になる。
 */
export function parseYarnLock(content: string): Dependency[] {
  const found = new Map<string, { version: string; origin: Dependency['origin'] }>();
  let pending: { name: string; origin: Dependency['origin'] } | null = null;

  for (const raw of content.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;

    // 見出し行はインデントが無く、コロンで終わる
    if (!/^\s/.test(raw) && raw.trimEnd().endsWith(':')) {
      const head = raw.trimEnd().slice(0, -1);
      // Berry のメタデータ節
      if (head.startsWith('__')) {
        pending = null;
        continue;
      }
      // "a@^1, b@~2" のように複数指定されることがある。最初の1件で足りる
      const first = head.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
      pending = splitSpecifier(first);
      continue;
    }

    if (pending === null) continue;

    // v1 は version "4.18.2"、Berry は version: 4.18.2
    const m = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(raw);
    if (m && m[1]) {
      if (isSafePackageName(pending.name) && !found.has(pending.name)) {
        found.set(pending.name, { version: m[1], origin: pending.origin });
      }
      pending = null;
    }
  }

  return [...found].map(([name, v]) => ({
    ecosystem: 'npm' as const,
    name,
    version: v.version,
    scope: 'runtime' as const,
    ...(v.origin ? { origin: v.origin } : {}),
  }));
}

/**
 * "express@^4.18.0" や "@types/node@npm:^22" を名前と出所に分ける。
 *
 * 区切りは**最初の @**（スコープの @ を除く）。パッケージ名に @ は
 * 先頭のスコープ以外に現れないので、これで必ず正しく切れる。
 * 最後の @ で切ると `from-git@git+ssh://git@github.com/...` が
 * `from-git@git+ssh://git` という実在しない名前になる。
 */
function splitSpecifier(spec: string): { name: string; origin: Dependency['origin'] } | null {
  if (spec === '') return null;
  // スコープ付きは先頭の @ を名前の一部として残す
  const from = spec.startsWith('@') ? 1 : 0;
  const at = spec.indexOf('@', from);
  if (at <= 0) return { name: spec, origin: undefined };
  return { name: spec.slice(0, at), origin: originOfRange(spec.slice(at + 1)) };
}

/**
 * 指定の右辺から、npm を引く意味があるかを決める。
 *
 * **これは速度ではなく誤答の防止である。** yarn workspaces の内部
 * パッケージを `left-pad` と名付けると、印を付けないかぎり npm 上の
 * 無関係な `left-pad` を引き、`0.0.0-use.local` は存在しないので
 * 最新版に落ちて WTFPL / allowed を返す。見たこともないパッケージの
 * ライセンスを、最も強い判定で貼ることになる。
 *
 * 判定できない右辺は registry に倒す。Berry の `patch:` は元が npm 上に
 * あるのでそれで正しい。
 */
function originOfRange(range: string): Dependency['origin'] {
  // workspace: / file: / link: / portal: はいずれもローカルの実体を指す
  if (/^(workspace|file|link|portal):/.test(range)) return 'workspace';
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(range)) return 'git';
  return 'registry';
}

export function isYarnLock(content: string): boolean {
  return (
    /^#\s*yarn lockfile v1/m.test(content) ||
    /^__metadata:/m.test(content) ||
    /^"?[^\s:]+@npm:/m.test(content)
  );
}
