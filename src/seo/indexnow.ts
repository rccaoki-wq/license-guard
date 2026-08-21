/**
 * IndexNow。更新した URL を検索索引へ直接投げる。
 *
 * **これは人間向けの SEO ではない。** 狙いは AI 検索が引ける場所に存在すること。
 * この製品が答える問い（「AGPL は SaaS で使えるのか」「GPL と AGPL の違いは」）は、
 * いま検索窓よりチャットに投げられている。そしてチャット側は、その場で
 * ウェブを検索して答えを作る。索引に無いものは引用されない。
 *
 * IndexNow は Bing・Yandex・Seznam・Naver 等が参加する共通プロトコルで、
 * 申請も審査もアカウントも要らない。鍵を公開し、URL を POST するだけ。
 *
 * **鍵は秘密ではない。** 公開URLに置くことが所有証明の手段なので、
 * ソースに直書きして構わない。漏れて困る種類のものではない。
 */
export const INDEXNOW_KEY = '6807469585f9daf1bd72471cfcbd661f';

/** 鍵ファイルの中身は鍵そのもの（仕様） */
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;
