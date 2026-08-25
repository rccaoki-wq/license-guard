import { isSafePackageName } from './name-safety';
import type { Dependency, Scope } from '../types';

/**
 * PEP 508 の要求文字列から名前だけを取り出す。
 * `"requests>=2.31.0"` / `"tomli ; python_version < '3.11'"` / `"ruff"`
 */
function nameFromRequirement(raw: string): string | null {
  const s = raw.trim().replace(/^["']|["']$/g, '').trim();
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(s);
  if (!m || !m[1]) return null;

  // 名前の直後が正当な区切りであること。ASCII しか拾わない正規表現なので、
  // 不可視文字を挟まれると "bad<ZWSP>pkg" が "bad" として通る
  const next = s[m[1].length];
  if (next !== undefined && !/[[=<>!~;\s,@]/.test(next)) return null;

  return isSafePackageName(m[1]) ? m[1] : null;
}

/**
 * セクション名 → そのセクションの依存が持つスコープ。
 * 依存を書く場所でないセクションは null。
 */
function scopeForSection(section: string): Scope | null {
  // PEP 621 の extras は「開発用」ではない。myapp[postgres] を入れた
  // 利用者には同梱される。dev に倒すと義務が丸ごと消えるため、
  // 出荷されうる側（optional）として扱う
  if (section === 'project.optional-dependencies') return 'optional';

  // PEP 735。名前のとおり開発用のまとまりで、配布物には入らない
  if (section === 'dependency-groups') return 'dev';

  if (section === 'tool.poetry.dependencies') return 'runtime';
  if (section === 'tool.poetry.dev-dependencies') return 'dev';
  // [tool.poetry.group.<name>.dependencies]。main 以外のグループは
  // 既定の配布対象ではない
  if (/^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)) return 'dev';

  return null;
}

/**
 * pyproject.toml から直接依存を取り出す。
 *
 * 現代の Python プロジェクトの本体で、2 つの方言が併存する。
 *   PEP 621: [project] dependencies = ["requests>=2.31.0", ...]
 *   Poetry : [tool.poetry.dependencies] requests = "^2.31.0"
 *
 * 対応していなかった頃は requirements.txt の受け皿に落ちて、
 * `name` `version` `python` といったメタデータのキーが「パッケージ」に
 * なっていた。行単位で読むので、TOML の全機能は解釈しない。
 * 依存が書かれる場所の形だけを見る。
 */
export function parsePyprojectToml(content: string): Dependency[] {
  const found = new Map<string, Scope>();
  let section = '';
  // 複数行にまたがる配列を読んでいる最中のスコープ
  let arrayScope: Scope | null = null;

  const add = (name: string | null, scope: Scope) => {
    if (!name) return;
    // Poetry は対応する Python のバージョンを依存と同じ場所に書く。
    // 拾うと PyPI の "python" という別物を問い合わせることになる
    if (name.toLowerCase() === 'python') return;
    if (!found.has(name)) found.set(name, scope);
  };

  /** 配列リテラルの中身（`[` `]` の間）から要求文字列を拾う */
  const addItems = (chunk: string, scope: Scope) => {
    for (const item of chunk.split(',')) {
      if (item.trim() === '') continue;
      add(nameFromRequirement(item), scope);
    }
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') continue;

    // 配列の続き。`]` が出るまで要素として読む
    if (arrayScope !== null) {
      const end = line.indexOf(']');
      addItems(end === -1 ? line : line.slice(0, end), arrayScope);
      if (end !== -1) arrayScope = null;
      continue;
    }

    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1]!.trim();
      continue;
    }

    const assign = /^([A-Za-z0-9._"'-]+)\s*=\s*(.*)$/.exec(line);
    if (!assign) continue;
    const key = assign[1]!.replace(/^["']|["']$/g, '');
    const value = assign[2]!;

    // [project] の中で依存を持つのは dependencies だけ。
    // name / version / requires-python を拾わないための明示的な条件
    if (section === 'project') {
      if (key !== 'dependencies') continue;
      const open = value.indexOf('[');
      if (open === -1) continue;
      const close = value.indexOf(']', open);
      if (close === -1) {
        addItems(value.slice(open + 1), 'runtime');
        arrayScope = 'runtime';
      } else {
        addItems(value.slice(open + 1, close), 'runtime');
      }
      continue;
    }

    const scope = scopeForSection(section);
    if (!scope) continue;

    // extras とグループは「キー = 要求の配列」
    if (scope === 'optional' || scope === 'dev') {
      const open = value.indexOf('[');
      if (open !== -1) {
        const close = value.indexOf(']', open);
        if (close === -1) {
          addItems(value.slice(open + 1), scope);
          arrayScope = scope;
        } else {
          addItems(value.slice(open + 1, close), scope);
        }
        continue;
      }
    }

    // Poetry は「パッケージ名 = 制約」。値は文字列でもテーブルでもよい
    add(isSafePackageName(key) ? key : null, scope);
  }

  return [...found].map(([name, scope]) => ({
    ecosystem: 'pypi' as const,
    name,
    // pyproject.toml のバージョンは範囲指定。確定版はロックファイル側にある
    version: null,
    scope,
  }));
}

/**
 * pyproject.toml か。
 *
 * ロックファイル（`[[package]]` を持つ）や Cargo.toml と取り違えないこと。
 * 判定の根拠は pyproject.toml にしか現れないセクション名に限る。
 */
export function isPyprojectToml(content: string): boolean {
  if (/^\[\[package\]\]/m.test(content)) return false;
  return (
    /^\[project\]/m.test(content) ||
    /^\[project\.optional-dependencies\]/m.test(content) ||
    /^\[tool\.poetry/m.test(content) ||
    /^\[dependency-groups\]/m.test(content)
  );
}
