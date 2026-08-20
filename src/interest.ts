/**
 * 有料レポートへの関心表明の受け付け。
 *
 * クリック数だけでは支払意思を測れない。好奇心と本気の区別がつかず、
 * 誰が興味を持ったのかも分からず、何が必要なのかを聞くこともできない。
 * 連絡先だけがそれを可能にする。
 */

/** ヘッダ注入や不可視文字を弾いたうえで、形として妥当かを見る */
export function isPlausibleEmail(raw: string): boolean {
  const v = raw.trim();
  if (v.length === 0 || v.length > 254) return false;

  // 制御文字・改行（メールヘッダ注入の常套手段）
  for (const ch of v) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f) return false;
  }

  // 厳密な検証はしない。実在確認は結局送ってみるまで分からないため、
  // 明らかに形になっていないものだけを落とす
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
