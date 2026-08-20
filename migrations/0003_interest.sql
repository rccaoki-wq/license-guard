-- 有料レポートへの関心表明。
--
-- Phase 0 の目的は支払意思の測定だが、クリック数だけでは
-- 好奇心と本気の区別がつかず、誰が興味を持ったかも分からず、
-- 追跡して要望を聞くこともできない。連絡先が唯一それを可能にする。
--
-- プライバシー方針: メールアドレスと、その人が見た判定の集計だけを保存する。
-- パッケージ名とマニフェスト本文は保存しない（mcp_events と同じ方針）。
-- 判定の集計を持つのは「義務が発生した人ほど関心が高いか」を知るため。

CREATE TABLE IF NOT EXISTS interest_signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  -- 見た判定の集計（例: "blocked=2,review=1,allowed=40"）
  verdict_mix TEXT,
  -- 選んでいた配布モデル。誰が困っているかの手がかりになる
  distribution_model TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_email ON interest_signals (email);
