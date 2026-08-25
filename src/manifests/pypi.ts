import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

const NAME_AND_PIN = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(?:(==)\s*([^\s]+))?/;

/** バージョン指定子（PEP 440）。長いものから並べる */
const OP = '(?:===|==|!=|~=|>=|<=|>|<)';

/**
 * PEP 508 の要求行として成立する形。
 * 名前 + 任意の extras + 任意の指定子列、または直接参照（`name @ url`）。
 */
const REQUIREMENT_LINE = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9._-]*` +
    `\\s*(?:\\[[A-Za-z0-9._,\\s-]*\\])?` +
    `\\s*(?:@\\s*\\S+|${OP}\\s*[^\\s,]+(?:\\s*,\\s*${OP}\\s*[^\\s,]+)*)?\\s*$`,
);

/**
 * 判定に意味のある行だけを取り出す。
 * パーサ本体と同じ落とし方をすること。ここだけ緩いと、
 * 「読める」と判定したのに 0 件になる入力ができてしまう。
 */
function meaningfulLines(content: string): string[] {
  const out: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.split(';')[0] ?? '';
    line = line.split('#')[0] ?? '';
    // pip-compile のハッシュ固定は行継続を使う
    line = line.replace(/\\$/, '').trim();
    if (line === '') continue;
    // -r / -e / --index-url / --hash などのディレクティブ
    if (line.startsWith('-')) continue;
    out.push(line);
  }
  return out;
}

/**
 * 内容が requirements.txt として妥当かを判定する。
 *
 * **これが無いと、対応していない形式が全部 requirements.txt になる。**
 * detectAndParse の最後の分岐は総当たりの受け皿で、requirements.txt の
 * パーサは行頭の語を名前として拾う。結果、Gemfile.lock からは `GEM`
 * `PLATFORMS` `DEPENDENCIES` という「パッケージ」が出てきて、
 * 何も検査できていないのに普通のレポートが返っていた。
 *
 * 判定は厳しい側に倒す。本物を弾けば利用者は貼り直すだけだが、
 * 別形式を通すと「異常なし」という嘘を静かに返すことになる。
 */
export function isRequirementsTxt(content: string): boolean {
  const lines = meaningfulLines(content);
  if (lines.length === 0) return false;
  const matched = lines.filter((l) => REQUIREMENT_LINE.test(l)).length;
  return matched / lines.length >= 0.8;
}

/**
 * requirements.txt から依存を抽出する。
 * requirements.txt には dev/runtime の区別が存在しないため、全て runtime とする。
 */
export function parseRequirementsTxt(content: string): Dependency[] {
  const out: Dependency[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    // 環境マーカーと行末コメントを落とす
    let line = rawLine.split(';')[0] ?? '';
    line = line.split('#')[0] ?? '';
    line = line.trim();

    if (line === '') continue;
    // -r / -e / --index-url などのディレクティブ
    if (line.startsWith('-')) continue;

    const m = NAME_AND_PIN.exec(line);
    if (!m || !m[1]) continue;
    if (!isSafePackageName(m[1])) continue;

    // 名前の正規表現は ASCII しか拾わないため、不可視文字を挟まれると
    // "bad<ZWSP>pkg" が "bad" として通ってしまう。黙って別のパッケージに
    // すり替わるのは取り違えの元なので、名前の直後が正当な区切りかを確かめる。
    const next = line[m[1].length];
    if (next !== undefined && !/[[=<>!~;\s,@]/.test(next)) continue;

    out.push({
      ecosystem: 'pypi',
      name: m[1],
      version: m[2] === '==' && m[3] ? m[3] : null,
      scope: 'runtime',
    });
  }

  return out;
}
