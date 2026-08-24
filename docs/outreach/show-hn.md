# Show HN 投稿案

## 出す前に読むこと

HN は宣伝に厳しいが、**Show HN は宣伝が明示的に許されている唯一の枠**。
規則は次の3つ。守れば問題にならない。

- 自分で作ったもので、人が今すぐ触れること（登録・課金の壁なし → 該当する）
- タイトルに煽り文句を入れない。`Show HN: ` の後は事実だけ
- 投稿後は**コメントに張り付いて全部返す**。ここが本体。返信しない Show HN は沈む

投稿時刻は**平日の US 東部 午前 8〜10 時**（= 日本時間 21〜23 時）が最も見られる。

---

## タイトル案（80字以内）

推奨:

```
Show HN: License Guard – open source license obligations, per deployment model
```

代替（ツール名を出さず問題を前に出す形。名前が他社と衝突しているので、
こちらの方が有利かもしれない）:

```
Show HN: A license checker that asks how you ship before answering
```

**名前の問題**: `licenseguard.io` `licenseguard.net`、Salesforce AppExchange の
"License Guard"、Dreamstime の "LicenseGuard" が既に存在する。うち
licenseguard.io は**ほぼ同じもの**（lockfile を読んで GPL リスクを出す）で、
検索で既に上位にいる。タイトルで名前を売っても勝てない。**問題の方を売る。**

---

## 本文（最初のコメントとして自分で投稿する）

> Most license scanners give you one verdict per license — `GPL-3.0` is red,
> `MIT` is green. But copyleft obligations attach to *events*, not to code. GPL-3.0
> triggers on distribution. If you run a hosted SaaS and never ship a binary, it
> never fires. The same dependency in a desktop app fires on your whole work.
>
> That's not a subtlety — it's the difference between "you're fine" and "you must
> publish your source", and the scanner can't tell, because the deciding fact
> isn't in your repo.
>
> So this takes the shipping model as an input: hosted SaaS, distributed binary,
> on-prem delivery, internal only, or published library. You paste a lockfile
> (package-lock.json, requirements.txt, go.sum, Cargo.lock, and a few more) and
> get the answer per model, with the clause that produced it rather than a risk
> score.
>
> A few things that fell out of building it:
>
> - AGPL vs GPL is one clause (section 13) and it's the only one that matters for
>   a hosted service. Tools that file both under "strong copyleft" are hiding the
>   one distinction their users need.
> - Dev dependencies aren't in the shipped artifact, so distribution-triggered
>   obligations don't arise. Every ecosystem already marks them in the manifest.
>   Most reports still show one risk column.
> - Static vs dynamic linking flips LGPL. Go and Rust link statically by default
>   and nothing in the lockfile says so.
>
> It's free and there's no signup. The manifest isn't stored — it's parsed in the
> request. Package names that resolve to a license on a public registry are
> cached as name → license so the next lookup is free, with no record of who
> asked; names that don't resolve, which is what an internal package looks like,
> are never written. It also runs as an MCP server so a coding agent can call it
> instead of guessing.
>
> Source: https://github.com/rccaoki-wq/license-guard (Apache-2.0)
>
> Not legal advice. It tells you which clause is implicated and why — the
> mechanical part. Whether it applies to you isn't mechanical.

---

## 想定される厳しい質問と、正直な答え

**「licenseguard.io と何が違うのか」**
→ 正直に答える。「配布モデルを入力として取る点。向こうは一律の判定を出す。
名前が近いのは偶然で、こちらが後発」。**ここで誤魔化すと終わる。**

**「FOSSA / Snyk / ScanCode があるが」**
→ 競合しない、と言う。あれらは SBOM と検出が本体で、判定は一律。こちらは
検出をせず（宣言ライセンスしか見ない）、判定だけを配布モデル別に出す。
**弱点を先に言う:** ソースにコピペされたコードは検出できない。

**「法的助言ではないなら何の役に立つのか」**
→ 「どの条項が効くか」は機械的で、「あなたに当てはまるか」は機械的でない。
前者だけをやっている。弁護士に持ち込む前の絞り込みには足りる。

**「精度は？ 判定は誰が書いた」**
→ 条項ごとにルールが書いてあり、判定文はそのルールの出力そのまま。
テストで表と説明文が食い違わないことを固定している。リポジトリで読める。

---

## 投稿しない方がいい条件

- コメントに 4〜6 時間張り付けない日
- 同時期に類似ツールが Show HN に出た直後
