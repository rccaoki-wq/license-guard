/**
 * パッケージ名として受け入れてよい形かを判定する。
 *
 * 目的は主に表示偽装の防止にある。双方向テキスト制御文字を含む名前は、
 * 端末やブラウザ上で実際とは異なる文字列として表示される。たとえば
 * "evil" の後ろに U+202E(RIGHT-TO-LEFT OVERRIDE) を挟んで "sj.lpga" と
 * 続けると、画面上は "evilagpl.js" と読める。Trojan Source
 * (CVE-2021-42574) と同種の問題であり、ライセンス判定という信頼される
 * 出力の中でパッケージ名が別物に見えることは許容できない。
 *
 * ゼロ幅文字と制御文字も同じ理由で除外する。いずれも実在するパッケージ名に
 * 現れることはないため、落として困る正当な入力は無い。
 *
 * 正規表現ではなくコードポイントで判定するのは、不可視文字をソースコードに
 * 直接書かないため。ソース自体が偽装の対象になっては本末転倒になる。
 */

/** 単独で不可視・書字方向に影響するコードポイント */
const FORBIDDEN_CODE_POINTS = new Set([
  0x00ad, // SOFT HYPHEN
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x200e, // LEFT-TO-RIGHT MARK
  0x200f, // RIGHT-TO-LEFT MARK
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
  0x202a, // LEFT-TO-RIGHT EMBEDDING
  0x202b, // RIGHT-TO-LEFT EMBEDDING
  0x202c, // POP DIRECTIONAL FORMATTING
  0x202d, // LEFT-TO-RIGHT OVERRIDE
  0x202e, // RIGHT-TO-LEFT OVERRIDE
  0x2060, // WORD JOINER
  0x2066, // LEFT-TO-RIGHT ISOLATE
  0x2067, // RIGHT-TO-LEFT ISOLATE
  0x2068, // FIRST STRONG ISOLATE
  0x2069, // POP DIRECTIONAL ISOLATE
  0xfeff, // ZERO WIDTH NO-BREAK SPACE (BOM)
]);

function isForbidden(cp: number): boolean {
  // C0 制御文字（NUL や改行を含む）と DEL
  if (cp < 0x20 || cp === 0x7f) return true;
  // C1 制御文字
  if (cp >= 0x80 && cp <= 0x9f) return true;
  // 各種のタグ文字（不可視のまま任意の ASCII を埋め込める）
  if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  return FORBIDDEN_CODE_POINTS.has(cp);
}

/** npm のパッケージ名上限に合わせる */
const MAX_LENGTH = 214;

export function isSafePackageName(name: string): boolean {
  if (name.trim() === '') return false;
  if (name.length > MAX_LENGTH) return false;

  for (const ch of name) {
    if (isForbidden(ch.codePointAt(0)!)) return false;
  }

  return true;
}
