/**
 * ファビコン。
 *
 * 盾を割って、片側を「義務なし」の緑、片側を「義務あり」の赤にした。
 * **同じ依存が、届け方によって真逆になる**というこの製品の中身そのものを図にしている。
 * 色は UI の判定色（--ok / --bad）と同じものを使う。
 *
 * 分割を斜めにしたのは、縦割り・横割りだと 16px で国旗にしか見えなかったため。
 * 4 案を実際に 16/24/32/96px で描いて見比べて決めている。
 *
 * SVG にしているのは、カタログ（Docker Desktop、Glama、mcp.so）が
 * アイコン URL をそのまま参照するため。ラスタだと解像度ごとに増える。
 */
const OK = '#0a7c3f';
const BAD = '#b3261e';

/** 盾の輪郭 */
const SHIELD = 'M16 2 28 7v9c0 7.4-5.6 12.4-12 14C9.6 28.4 4 23.4 4 16V7z';

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="LicenseGuard"><defs><clipPath id="s"><path d="${SHIELD}"/></clipPath></defs><g clip-path="url(#s)"><rect width="32" height="32" fill="${OK}"/><path d="M32 0v32H2z" fill="${BAD}"/><path d="M32-2-2 32" stroke="#fff" stroke-width="2.4" fill="none"/></g></svg>`;
