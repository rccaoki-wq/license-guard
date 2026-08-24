# Reddit 投稿案

## 前提：Reddit は自己宣伝に最も厳しい

r/programming は自作ツールの直接投稿をほぼ確実に消す。r/opensource は
比較的寛容だが、**新規アカウント・投稿履歴なしは自動で消される**。

投稿する前に確認すること:

- アカウントに一定の karma と投稿履歴があるか（無ければ **投稿しない**。
  数週間ふつうに参加してからにする）
- 各 subreddit の rules を読む。self-promotion の項が必ずある
- **記事を投稿し、ツールは記事の末尾に置く**。ツール直リンクは広告に見える

**推奨する順序**: 記事を dev.to に出す → 数日おく → 記事へのリンクとして
r/opensource に出す。ツールの直リンクは投稿本文に置かない。

---

## r/opensource 向け

**タイトル:**

```
Copyleft obligations trigger on distribution, not on having the code — why one risk column per license is wrong
```

**本文:**

> Something I keep re-deriving by hand and finally wrote down.
>
> Most license tooling gives one verdict per license. But GPL-3.0's obligation
> triggers on conveying the work — distribution. A hosted SaaS with a GPL-3.0
> library in `node_modules`, running on your own servers, has not distributed
> anything, so the obligation doesn't arise. The same dependency in a desktop app
> you ship fires on the whole work.
>
> Same license, same version, same lockfile, opposite answers. The deciding fact
> isn't in the repository.
>
> The AGPL exists specifically because the FSF saw that gap — section 13 adds the
> network-interaction trigger the GPL lacks. Which means AGPL and GPL, filed
> under the same "strong copyleft" heading almost everywhere, give *opposite*
> answers for the deployment model most companies actually run.
>
> Same for dev dependencies (not in the shipped artifact → no distribution of
> them → no obligation), and for static vs dynamic linking with LGPL, where Go
> and Rust default to static and the lockfile doesn't say so.
>
> Wrote the whole thing up here, including where this *doesn't* apply — MIT and
> Apache-2.0 don't vary by shipping model at all, and MPL-2.0 is a third
> mechanism entirely (per-file copyleft):
>
> [記事URL]
>
> Curious whether people here handle this differently. Does anyone's tooling
> actually take the deployment model as an input, or is everyone doing what I was
> doing and reasoning about it manually each time?

**末尾の問いかけは削らないこと。** 議論を招く投稿は残り、宣言だけの投稿は消える。

---

## その他の候補

| subreddit | 見込み | 注意 |
|---|---|---|
| r/opensource | ◎ | 上記そのまま |
| r/ExperiencedDevs | ○ | ツールリンク厳禁。記事のみ、経験談の形にする |
| r/golang | ○ | 静的リンクと LGPL の節だけに絞ると刺さる |
| r/rust | ○ | 同上 |
| r/devops | △ | CI に組み込む話にしないと浮く |
| r/programming | ✕ | 自作物は消される。出さない |

---

## Stack Overflow について

**新規投稿はしない。** 既存の license 系の質問に答える形なら価値があるが、
SO は自己宣伝の検出が厳しく、リンクを貼るなら
「I built this」を明記する必要がある（規約上の義務）。

回答として価値があるのは、質問が「GPL を SaaS で使えるか」型のとき。
**まず質問に完全に答え**、リンクは補足として最後に1行、開示付きで置く。
リンクなしで答えるだけでも、その回答自体が LLM に読まれる資産になる。
