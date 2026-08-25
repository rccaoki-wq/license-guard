-- 公開するパッケージページの索引。**license_cache とは別の表。**
--
-- license_cache の鍵は (ecosystem, package, version) で、版が定まらない依存は
-- 鍵が作れないため書けない（cache.put は version が null なら何もしない）。
-- 一方 /pkg のページは版を持たない――「lodash は商用で安全か」に版は要らない
-- ――ので、あの表には一行も入らなかった。
--
-- 結果として、公開できるページは「誰かが版付きのロックファイルを貼った
-- パッケージ」だけになっていた。人が実際に検索するパッケージを用意しようと
-- 要求しても表に入らないので、一覧にも sitemap にも出てこない。
-- 控え（cache）と索引（index）は別の仕事なので、表を分ける。
--
-- **時刻の列を作らないこと。** cache 側の resolved_at は registry-latest の
-- 期限判定に要るが、索引には要らない。到達が少ないうちは「パッケージごとの
-- 時刻」は「誰がいつ何を調べたか」とほぼ同じで、「誰が尋ねたかは記録しない」
-- という公開の約束（/ の説明文）を破る。
--
-- spdx を NOT NULL にしてあるのは、「解決できなかった名前は書かない」という
-- 同じ約束を表の側で守るため。解決できない名前は社内パッケージの形をしている。
CREATE TABLE IF NOT EXISTS package_index (
  ecosystem TEXT NOT NULL,
  package   TEXT NOT NULL,
  spdx      TEXT NOT NULL,
  PRIMARY KEY (ecosystem, package)
);
