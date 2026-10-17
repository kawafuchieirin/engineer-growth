# 測定の観点の定義（レビュー用ドラフト）

status: **draft — 未適用**。レビューを受けてから `data/levels.yaml` と
`docs/SKILLS_GUIDE.md` に反映する。この文書だけでは何も変わらない。

## この文書が決めること

`data/skills.yaml` の `level` を**何を根拠にどう決めるか**。

XP の計算規則は `docs/GAME_DESIGN.md` にあり、そこは「盛れない仕組み」になっている。
しかし XP の出発点である `level` は**手書きの数字**で、そこに歯止めがない。
`CLAUDE.md` の原則 6「XP を手で書ける場所を作らない」は、実質的に `level` のところで
破れている。この文書はその穴を埋めるためのもの。

初版（2026-10-12）の観点はわたしが即興で決めたもので、定義の根拠がなかった。
外部の確立したフレームワークから観点を取り直す。

---

## 1. 調べた情報ソース

### 公的・業界標準

| ソース | 版 | 構造 | 一次情報 |
|---|---|---|---|
| [SFIA](https://sfia-online.org/en/sfia-9/responsibilities) | 9（2024-10-30） | 責任のレベル 7 段 × 属性 16 個。スキルは 6 カテゴリ | 確認済み |
| [IPA ITSS+ 共通レベル定義](https://www.ipa.go.jp/jinzai/skill-standard/plus-it-ui/itssplus/ps6vr70000001j6e-att/000065687.pdf) | — | 7 段。軸は自律度と影響範囲 | 確認済み |
| [IPA DX推進スキル標準](https://www.ipa.go.jp/jinzai/skill-standard/dss/about_dss-p.html) | ver2.0（2026-04-16） | 6 類型。レベルは持たない | 確認済み |
| [情報処理技術者試験](https://www.ipa.go.jp/shiken/kubun/ap.html) | — | レベル 1-3 は試験合格、4 は試験＋業務経験 | 一部（レベル定義の全文は未取得） |
| [e-CF](https://www.ecompetences.eu/methodology/) | 4.0 / EN 16234-1:2019 | 5 領域（Plan/Build/Run/Enable/Manage）× e-1〜e-5 | **未取得**（規格本文が有料） |
| [NICE Framework](https://csrc.nist.gov/pubs/sp/800/181/r1/final) | SP 800-181 Rev.1 | Task/Knowledge/Skill → Work Role | 一部（習熟レベルは本体に無し） |

### 測定の方法論

| ソース | 内容 | 一次情報 |
|---|---|---|
| [Miller's Pyramid](https://pmc.ncbi.nlm.nih.gov/articles/PMC7246123/)（1990, 医学教育） | Knows → Knows how → Shows how → Does。**認知領域と行動領域の相関は低い** | 確認済み |
| [SPACE](https://queue.acm.org/detail.cfm?id=3454124)（2021） | 5 次元。単一指標で測れない。3 次元以上＋知覚指標 1 つ以上 | 二次（ACM が 403） |
| [DORA 中核指標](https://dora.dev/guides/dora-metrics-four-keys/) | 5 本。Throughput 3 / Instability 2。MTTR は廃止 | 確認済み |
| [DORA capabilities](https://dora.dev/capabilities/) | 34 件の能力カタログ | 確認済み |
| [METR の RCT](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)（2025-07） | AI 利用で作業時間 **+19%**、本人の認識は「**-20%**」 | 確認済み |
| [Anthropic の RCT](https://www.anthropic.com/research/AI-assistance-coding-skills)（2026-01） | 理解度 AI 群 ~50% / 手書き群 ~67%。**差が最大はデバッグ** | 確認済み |
| [DORA 2025](https://redmonk.com/rstephens/2025/12/18/dora2025/) | 個人の PR マージ +98% でも組織の配信性能は横ばい | 二次 |
| [Dunning-Kruger 批判](https://pmc.ncbi.nlm.nih.gov/articles/PMC8992690) | 平均への回帰と有界データで大部分が説明可能 | 確認済み |

### ドメイン固有（インフラ / SRE / クラウド）

| ソース | 構造 | 一次情報 |
|---|---|---|
| [SRE 信頼性階層](https://sre.google/sre-book/part-III-practices/)（Dickerson） | 監視 → インシデント対応 → ポストモーテム → テスト → キャパシティ → 開発 → プロダクト | 確認済み |
| [AWS Well-Architected](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html) | 6 柱 | 確認済み |
| [CNCF Platform Maturity Model](https://tag-app-delivery.cncf.io/ja/wgs/platforms/maturity-model/v1/) | 4 レベル × 5 側面を**独立に**評価 | 確認済み |
| [SFIA Technology management](https://sfia-online.org/en/sfia-9/sfia-views/full-framework-view/delivery-and-operation/technology-management) | ITOP / NTAS / CFMG / RELM / DEPL / SYSP ほか 11 スキル | 確認済み |

### 企業のコンピテンシーマトリクス

| ソース | 軸 | 一次情報 |
|---|---|---|
| [Khan Academy](https://blog.khanacademy.org/?p=368) | **Skills / Scope / Experience**（能力と担った範囲を分離） | 確認済み |
| [Dropbox](https://dropbox.github.io/dbx-career-framework/overview.html) | Scope / Collaborative Reach / Impact Levers + Results/Direction/Talent/Culture + Craft | 確認済み |
| [Rent the Runway](https://dresscode.renttherunway.com/blog/ladder) | Dex(技術) / Str(遂行) / Wis(影響) / Cha(伝達) | 確認済み |
| [37signals（Ops/SRE）](https://books.37signals.com/books/3/pages/20) | Mastery / Tech&Tooling / Scope / Judgment / Ownership ほか 10 軸 | 確認済み |
| [GitLab](https://handbook.gitlab.com/handbook/engineering/careers/matrix/) | Technical / Execution / Collaboration / Influence&Maturity | 一部（最新版は別ページ） |
| [CircleCI](https://circleci.com/blog/why-we-re-designed-our-engineering-career-paths-at-circleci) | 影響範囲を task→project→team→related teams→department で定義 | 一部（27 軸の全リストは未取得） |
| [Monzo](https://monzo.com/blog/lessons-from-implementing-progression-frameworks-at-scale) | 5 軸 → **3 軸に削減**（増やすとチェックボックス化するため） | 一部（現行版は未取得） |

---

## 2. 今の仕組みの問題（3 つ）

### 問題 1: 知識とレベルを 1 本の軸に混ぜている

SFIA 9 は、レベルの高さを示すのは `Autonomy` / `Influence` / `Complexity` の 3 つだけで、
`Knowledge` は「必要な理解の深さと広さ」であって**レベルを決める軸ではない**と明示している。
ITSS+ の 7 段も軸は自律度と影響範囲で、知識・技能はレベル 1-3 でしか言及されない。

今の `data/levels.yaml` は「知っている → 触った → 自走 → 牽引」と、
知識量と責任範囲を 1 本に並べている。そのため**知識は深いが構築経験がない**領域
（Google Cloud。14 資格の計画と合格ゲートの定義があるのにリソース作成は 0 件）と、
**知識も経験もない**領域（Kubernetes）が同じ 1 や 0 に潰れる。

同じ理由で、**3 年前に作ったが今は触っていない**領域も表現できない。
ネットワークは 2023 年に CloudFormation でマルチ AZ の VPC を構築しているが、
それ以降触っていない。「できる」と「できた」を 1 本の軸で表すと、この違いが消える。

### 問題 2: レベル 4 の定義が 1 段高い

| | 定義 |
|---|---|
| 現在の `levels.yaml` レベル 4「牽引」 | チームの技術選定を主導し、他者をレビュー・育成できる |
| [SFIA 9 Level 4 "Enable"](https://sfia-online.org/en/lor/9/4) | Autonomy: *"Works under general direction within a clear framework of accountability"* / Influence: *"Influences projects and team objectives"* / 委任は *"When required... typically within own team"* |

今の定義は SFIA の **4〜5 相当**。結果として、初版の棚卸しで**レベル 4 以上が 0 件**になった。

さらに、わたしは前回「単独開発では 4 以上は原理的に証明できない」と書いたが、これは誤り。
Khan Academy の Owner 段は *"Owners can handle significant, multiple-months-long features
all by themselves"* で、**単独完遂は高い段**として評価される。他者への影響が必須になるのは
その上の Architect 以降。つまり上限を切るのではなく、**軸を分けるべき**だった。

### 問題 3: AI 協働の扱いが定義されていない

初版では「AI 協働を理由にレベルを下げない」と判断したが、根拠は示していなかった。
2025-2026 年の研究はこの判断に直接関わる。

- [METR](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/): 熟練開発者は AI 利用で作業時間が **19% 長くなった**のに、本人は「20% 速くなった」と認識していた。**主観は実測と逆を向く。**
- [Anthropic](https://www.anthropic.com/research/AI-assistance-coding-skills): AI 利用群の理解度 ~50%、手書き群 ~67%。**差が最大だったのはデバッグ。** 概念を質問した人は 65% 超、コード生成を丸投げした人は 40% 未満。

つまり「成果物はあるが本人の理解がない」状態が実在する。測定された AI 協働率 32%
（121/382 コミット）は、この観点から無視できない。

---

## 3. 定義する観点

**4 本の独立した軸**に分ける。1 本に合成しない。
根拠は [SPACE](https://queue.acm.org/detail.cfm?id=3454124) の「単一指標では捉えられない」と、
[CNCF](https://tag-app-delivery.cncf.io/ja/wgs/platforms/maturity-model/v1/) の
「各側面は独立に検討する」という設計。

軸の本数は 4 本に抑える。Monzo が 5 軸を 3 軸に減らした理由が
「軸を増やすとチェックボックス化する」ことだったため。

### 軸 1: 習熟（M0-M5）— 何ができるか

[Miller's Pyramid](https://pmc.ncbi.nlm.nih.gov/articles/PMC7246123/) の
Knows / Knows how / Shows how / Does を土台に、「やった」側を 3 段に割る。

| | 名前 | 判定の条件 |
|---|---|---|
| **M0** | 未経験 | 痕跡がない。**測定で不在を確認した**ことを根拠にする |
| **M1** | 知っている | 学習の痕跡のみ。ノート・計画・資格勉強。**構築物はない** |
| **M2** | 手本つきで作った | 動くものを作った。ただし教材・チュートリアル水準か、他者の設計に乗っている |
| **M3** | 一人で完遂した | 設計から実装・運用まで単独で完遂し、**動いているものがある** |
| **M4** | 繰り返し再現した | **異なる文脈で複数回**再現した。かつ、非自明な問題を自分の判断で解き、**壊れたものを直した記録がある** |
| **M5** | 基準を作った | その領域の判断基準を他者が使える形で外に出し、**実際に使われている** |

M4 から「他者の育成」を外した。代わりに置いた条件の根拠は次の 2 つ。

- SFIA 9 Level 4 の Complexity: *"Work includes a broad range of complex technical or professional activities in **varied contexts**"*
- Khan Academy の要件: 証拠は一度ではなく *"totally and consistently embody ... over a significant period of time"*

M5 の「外に出して使われている」は、ITSS+ レベル 6「市場から見てもプロとして認められる」と
Khan の *"recognized far beyond our walls"* に対応する。

### 軸 2: 責任範囲（S0-S5）— 壊れたとき誰が困るか

企業のマトリクスは影響範囲を**人数**で定義する（CircleCI の task→project→team→department）。
単独開発者には使えないため、[Dropbox の Scope](https://dropbox.github.io/dbx-career-framework/overview.html)
の考え方を借りて**blast radius（壊れたときの影響範囲）**に読み替える。

| | 範囲 | 意味 |
|---|---|---|
| **S0** | 練習 | 壊れても誰も困らない。学習用 |
| **S1** | 自分の道具 | 壊れると自分の作業が止まる |
| **S2** | 自分の本番 | 動き続ける必要があり、落ちたら自分が復旧する義務がある |
| **S3** | 他者が依存 | 自分以外の誰かが使っている。落とすと迷惑がかかる |
| **S4** | 組織が依存 | チーム・会社の業務が止まる |
| **S5** | 不特定多数が依存 | 外部の利用者がいる |

この軸は習熟とは独立。**S2 で M4 は成立する**（自分の本番を何度も壊して直した）。
逆に S4 で M2 もありうる（組織のシステムを手本つきで触っている）。

### 軸 3: 証跡の強さ（E0-E3）— 何を根拠にしているか

[SFIA の独立評価ガイドライン](https://sfia-online.org/en/tools-and-resources/using-sfia/sfia-assessment/independent-objective-sfia-assessment-guidelines)
の分類をそのまま使う。同ガイドラインは
**「実際の業務経験に基づく。潜在力や願望ではない」**と明記している。

| | 種類 | 具体例 |
|---|---|---|
| **E3** | 直接証跡（第三者が検証できる） | 動いている成果物、第三者のレビュー記録、障害と復旧の記録、上司や顧客からの推薦、試験合格 |
| **E2** | 間接証跡 | 自作の成果物（自分しか使っていない）、設計文書、ポートフォリオ |
| **E1** | 自己申告のみ | 本人の記述だけ |
| **E0** | なし | 根拠が書かれていない |

**判定規則**: M3 以上は E2 必須、M4 以上は E3 必須。E1 だけの主張は M2 が上限。

SFIA は評価者を Level 4 以上が望ましいとしている。単独の自己評価では E3 の一部
（第三者のレビュー、推薦）が原理的に揃わない。**そこは「揃っていない」と記録する。**

### 軸 4: AI 非依存性（U?-U2）— 本人の理解がどこまで確認されているか

2025-2026 年の研究を根拠にした新しい軸。この軸がないと、
「成果物はあるが本人の理解がない」状態を区別できない。

| | 状態 |
|---|---|
| **U?** | 不明。記録がない |
| **U0** | AI 協働でのみ実施した |
| **U1** | AI あり / なしの両方で実施したことがある |
| **U2** | AI なしで、時間を空けて再現できた。**デバッグを含む** |

**判定規則**: M4 以上は U1 以上を要する。

「デバッグを含む」は [Anthropic の RCT](https://www.anthropic.com/research/AI-assistance-coding-skills)
で**差が最大だったのがデバッグ問題**だったことによる。生成できることと、
壊れたものを直せることは別。

この軸は AI 利用を減点するためのものではない。
AI 協働そのものは `prac-ai-collaboration` として習熟軸で評価する。
U 軸は「その技術について本人が何を確認したか」だけを記録する。

---

## 4. 領域の分類（カテゴリ）

カテゴリは自分で考えない。外部の定義を使う。

### 役割の定義

[IPA DX推進スキル標準 ver2.0](https://www.ipa.go.jp/jinzai/skill-standard/dss/about_dss-p.html)
では、独立した「インフラエンジニア」職種は定義されておらず、
**「クラウドエンジニア／SRE」**ロールに統合されている。
責務は「ソフトウェアの開発・運用環境の最適化と信頼性向上」で、
重要度 a（高い実践力と専門性が必要）のスキル項目は 3 つ。

1. クラウドインフラ活用
2. SRE プロセス
3. セキュリティ運用・保守・監視

**この 3 つを棚卸しの中核に置く。**

### インフラ能力の順序 — SRE 信頼性階層

[Google SRE book](https://sre.google/sre-book/part-III-practices/) の階層は、
**下が固まる前に上は積めない**という順序を持つ。現在の棚卸しをこの階層に当てると、
空白の形がはっきりする。

| 段 | 階層 | 初版（測定のみ） | 聞き取り後 |
|---|---|---|---|
| 7 | プロダクト | — | — |
| 6 | 開発 | M3 | **M3**（Go 10,841 行・テスト 222） |
| 5 | キャパシティプランニング | M0 | **M0**（痕跡なし。見積りの経験もない） |
| 4 | テスト | M3 | **M3**（488 ケース） |
| 3 | ポストモーテム / 根本原因分析 | M1 | **M1 ← ここだけが空白** |
| 2 | インシデント対応 | M0 | **M3**（業務で本番障害の一次対応を担当） |
| 1 | 監視 | M2 | **M3**（業務で監視ツールを日常的に扱う） |

> **初版は下 2 段を 0 と 2 と測っていたが、どちらも誤りだった。**
> 公開リポジトリには本番障害が存在しないため、測定では原理的に見えない領域だった。
> 聞き取りで下 2 段が埋まり、**空白が 3 段目のポストモーテムに移った。**
> 一次対応はできるが、再発防止を文書に残して追跡する運用がない。

初版は「上の段（開発・テスト）が下の段より進んでいる＝逆向きに積んでいる」と読んだが、
**聞き取り後はそうではなかった。** 下 2 段は業務で埋まっており、
空白は 3 段目（ポストモーテム）と 5 段目（キャパシティプランニング）の 2 つに絞られる。

この階層を観点に入れる価値は変わらない。**空白の位置が分かれば、次の順序が決まる。**
そして「測定で 0 だった段が、聞き取りで 3 になった」という事実自体が、
この観点を**自己測定だけで埋めてはいけない**ことの証拠になっている。

### 技術能力のチェックリスト — DORA capabilities

[DORA の 34 capabilities](https://dora.dev/capabilities/) から、この役割に該当するものを使う。
自分でスキル名を発明せず、外部のカタログに紐づける。

Version control / Continuous integration / Continuous delivery / Deployment automation /
Trunk-based development / Test automation / Test data management / Database change management /
Monitoring and observability / Proactive failure notification / Pervasive security /
Flexible infrastructure / Code maintainability / Documentation quality /
Working in small batches / Platform engineering / Streamlining change approval

### クラウド構成の観点 — Well-Architected 6 柱

[AWS Well-Architected](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html):
運用上の優秀性 / セキュリティ / 信頼性 / 性能効率 / コスト最適化 / 持続可能性。

初版の測定では、セキュリティ（IAM 最小権限、OIDC）とコスト最適化（Budgets）に
痕跡があり、**信頼性**（復旧手順、障害訓練）と**性能効率**（計測）が空白だった。

### スキル語彙 — SFIA Technology management

[SFIA 9](https://sfia-online.org/en/sfia-9/sfia-views/full-framework-view/delivery-and-operation/technology-management)
の 11 スキル。該当するものにコードで紐づけると、外部との対応が取れる。

`ITOP` Infrastructure operations / `NTAS` Network support / `SYSP` System software administration /
`CFMG` Configuration management / `RELM` Release management / `DEPL` Deployment /
`STMG` Storage management / `ITMG` Technology service management

### 成果の指標 — DORA 中核指標

[現行 5 本](https://dora.dev/guides/dora-metrics-four-keys/)。スキルとは別に、
**自分が運用しているものの状態**として測れる。

- Throughput: Change lead time / Deployment frequency / Failed deployment recovery time
- Instability: Change fail rate / Deployment rework rate

ただし [DORA 2025](https://redmonk.com/rstephens/2025/12/18/dora2025/) の知見により、
**個人の活動量（PR 数・コミット数）は成果の代理にしない。**

---

## 5. 測らないと決めるもの

[McNamara fallacy](https://en.wikipedia.org/wiki/McNamara_fallacy)（測れるものだけを重視し、
測れないものを存在しないと見なす誤り）への対策として、
**測らない領域を明示的に台帳に載せる。0 として平均に混ぜない。**

単独開発では原理的に証跡が出ないもの（企業マトリクスの軸から）:

| 測らない軸 | 出典 |
|---|---|
| 他者の育成 / メンタリング | Dropbox `Talent Development`、RtR `Cha` |
| 協働 / 影響範囲 | Dropbox `Collaborative Reach`、Monzo `Influence` |
| 組織文化への貢献 | Dropbox `Culture`、GitLab `Values Alignment` |
| リーダーシップ | Monzo `Leadership` |
| フィードバックの受容 | 37signals `Coachability` |

これらは `unmeasured`（測定していない）として記録し、**平均計算から除外する**。
現在は `soft-mentoring: 2` のように仮の値を入れてしまっており、
「測っていない」と「低い」が区別できていない。

業務経験も同じ扱いにする。GitHub からは見えないため、
`unmeasured` か、本人の自己申告として `E1` で明示する。

---

## 6. 設計原則

| | 原則 | 根拠 |
|---|---|---|
| 1 | **自己申告の習熟度を入力に使わない。** レベルは証拠の充足で機械的に決める | SFIA / ITSS+ は判定を責任と自律性で定義。Dreyfus・Bloom は判定者を規定しておらず、自己選択させると自己欺瞞の入口になる |
| 2 | **証拠の強さを階層化し、強い証拠にだけ上位レベルを許す** | SFIA 独立評価ガイドラインの直接/自己申告/間接の分類 |
| 3 | **AI 利用の有無を記録し、AI なしの再現を別に集計する** | Anthropic RCT（理解度 50% vs 67%、デバッグで最大差） |
| 4 | **活動量（行数・コミット数）を能力の指標に使わない** | DORA 2025（個人の PR +98% でも組織成果は横ばい）。AI で限界コストがほぼゼロ |
| 5 | **軸を 1 本に合成しない。合成値は表示用の要約に留める** | SPACE「単一指標では捉えられない」。[Goodhart の法則](https://en.wikipedia.org/wiki/Goodhart%27s_law) |
| 6 | **各指標に「測っていないこと」を併記する** | McNamara fallacy |
| 7 | **不在は測定して示す。** 0 を印象で付けない | 初版で Kubernetes 0 を 4 種類の検索で確認した方式を標準化する |
| 8 | **1 回の差で「伸びた」としない。** 同条件の再測定を要する | 平均への回帰。Dunning-Kruger 効果の見かけの大部分がこれで説明される |
| 9 | **最上位への到達を目標にしない** | CNCF「高いレベルほど資金と時間が必要で、最高レベルに達すること自体を目標とすべきでない」 |
| 10 | **軸を増やさない。** 4 本を上限とする | Monzo が 5 軸を 3 軸に減らした理由（チェックボックス化） |

---

## 7. 今のデータとの差分（適用するなら必要な変更）

| | 変更 | 影響 |
|---|---|---|
| 1 | `data/levels.yaml` を習熟軸 M0-M5 に書き換え、レベル 4 から「育成」を外す | スキーマ変更なし。レベルの意味が変わる |
| 2 | `skills[]` に `scope`（S0-S5）を追加 | schema 変更 + render 変更 |
| 3 | `skills[].evidence` を文字列配列から `{tier, text}` に変更 | schema 変更 + 既存 33 件の書き換え |
| 4 | `skills[]` に `unassisted`（U?-U2）を追加 | schema 変更 |
| 5 | `skills[]` に `unmeasured: true` を追加し、平均計算から除外 | lib/skills.ts の集計変更 |
| 6 | レベルを証拠の充足から導出する検証を `validate` に追加（E1 だけで M3 以上ならエラー） | schema の superRefine 追加 |
| 7 | カテゴリを DSS-P の役割定義に合わせ直す | 既存 ID の改名 → goals / roadmap の参照も変更 |
| 8 | SRE 信頼性階層の 7 段を可視化に追加 | render 追加 |
| 9 | XP の算出が活動量に依存していないか監査する | `docs/GAME_DESIGN.md` の確認 |

**7 は既存の 33 スキルの ID 改名を伴うため、`goals.yaml` と `roadmap.yaml` の
参照も同時に直す必要がある。** 影響が最も大きい。

---

## 8. レビューしてほしい論点

1. **軸 4 本は多すぎないか。** Monzo は 5 → 3 に減らした。
   習熟（M）と証跡（E）は残すとして、責任範囲（S）と AI 非依存性（U）の
   どちらかを落とす選択もある。わたしは U を残したい（2026 年の環境で
   これを記録しないと、1 年後に自分の実力が分からなくなるため）が、
   S を落とすと「自分の本番か練習か」が表現できなくなる。

2. **M4 の条件「壊れたものを直した記録がある」は厳しすぎないか。**
   これを課すと、現在 M3 のものはほとんど M4 に上がらない。
   ただし SRE 信頼性階層の下 3 段が空白である以上、これは実態だと考えている。

3. **`unmeasured` を導入すると平均レベルが上がる。**
   測っていない 8 件を除外すると、見かけの平均が改善する。
   数字が良くなる変更なので、意図的に慎重でありたい。
   「測っていない件数」を常に併記する形にしたいが、それで十分か。

4. **カテゴリを DSS-P に合わせると ID が変わる。**
   `infra-*` や `cloud-*` を `クラウドインフラ活用` / `SRE プロセス` /
   `セキュリティ運用・保守・監視` の 3 本に寄せるか、
   今の 7 カテゴリを維持して DSS-P との対応表だけ持つか。
   後者の方が影響は小さい。

5. **業務経験の扱い。** `unmeasured` にするか、自己申告（E1）として
   レベルを付けるか。E1 だと M2 が上限になるため、実態より低く出る可能性がある。
   ここだけ例外を作るかどうか。

6. **DORA 中核指標を自分のリポジトリで測るか。**
   Deployment frequency と Change lead time は GitHub の API から機械的に取れる。
   Change fail rate は「revert / hotfix コミットの割合」で近似できる。
   スキルとは別の「成果」として置く価値があるか。

---

# 9. 外部基準（external calibration）の提案

## 9.1 なぜ必要か

[SFIA の評価ガイドライン](https://sfia-online.org/en/tools-and-resources/using-sfia/sfia-assessment/independent-objective-sfia-assessment-guidelines)
は、評価者を Level 4 以上とし、第三者による独立評価を自己評価の上位に置いている。
**単独の自己評価には評価者がいない。** §3 の E 軸（証跡）の最上位 E3 と、
U 軸（AI 非依存性）の U2 は、自分だけでは原理的に埋まらない。

そこを外部のサービスで埋められるかを調べた。結論から書くと、
**4 種類に分かれ、能力の検証に使えるのは 2 種類だけ**だった。

## 9.2 調べたサービスの分類

| 種類 | 何を検証できるか | 代表例 | 本件での使用 |
|---|---|---|---|
| **A. 監督付き実技試験** | AI なしの実力。第三者出題・有効期限つき | CKA / CKAD / CKS、RHCSA / RHCE | **採用**（E3 + U2） |
| **B. 無監督の試験・認定** | 知識と実装力。第三者出題だが AI 利用は防げない | paiza、AtCoder、PAST、AWS / Google Cloud 認定 | **条件付き採用**（E3 のみ） |
| **C. 成果物の機械検査** | 再現可能な品質・衛生。人の評価ではない | OpenSSF Scorecard | **採用**（E3） |
| **D. 公開アウトプットの相対スコア** | 可視性と公開物の量。**能力ではない** | LAPRAS、Findy | **不採用**（別軸として記録） |
| **E. 市場の値段** | 市場の評価。能力の代理指標としては弱い | 転職ドラフト、ビズリーチ、各種年収査定 | **一部採用**（スキルとは別枠） |

## 9.3 A: 監督付き実技試験 — インフラで U2 を埋められる唯一の手段

調査の結論として、**インフラの実技を第三者が監督付きで測る仕組みは、
事実上 Kubernetes と Linux に限られる。**

| 試験 | 形式 | 有効期限 |
|---|---|---|
| [CKA / CKAD / CKS](https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/) | オンライン監督付きの実技。コマンドラインで複数タスクを解く（CKA は 2 時間） | **2 年** |
| [RHCSA / RHCE](https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam) | 実機の実技。**最終状態で採点し、再起動後も保持されている必要がある** | 3 年 |

AWS と Google Cloud の認定は、確認できた範囲では選択式だった。
監督付きで有効期限（2〜3 年）はあるため、E3 は満たすが実技ではない。

**有効期限があることが、このフレームワークにとって重要。**
原則 8（1 回の差で「伸びた」としない。同条件の再測定を要する）を、
試験側が強制してくれる。

> `CKA` はこの方にとって特殊な位置にある。Kubernetes は現在 **M0**（4 種類の検索すべてが
> 0 件）で最大の空白であり、SRE 信頼性階層の下 3 段（監視・インシデント対応・
> キャパシティ）を埋める学習とも方向が一致する。
> 「空白を埋める学習」と「U2 の外部検証」が同じ 1 本で取れる。

## 9.4 B: 無監督の試験 — E3 は満たすが U は満たさない

| サービス | ランク | 分布（公式の目安） | AI 対策 | 有効期限 |
|---|---|---|---|---|
| [paiza](https://paiza.jp/challenges/info) | S / A / B / C / D | S は上位 1%、A は 10%、B は 30% | 禁止規定あり。自宅受験 | **なし（減衰しない）** |
| [AtCoder](https://atcoder.jp/posts/1567) | レート・色 | 緑（800-1199）が 7.5%、水が 3.85% | **生成AI対策ルール 20251003版**。AI ベースのコード補完まで禁止、違反はアカウント停止 | なし |
| [PAST](https://past.atcoder.jp/feature/) | エントリー〜エキスパート | 100 点満点・15 問・5 時間 | 規約未確認 | **2 年** |

AtCoder の AI 対策は、調べた中で最も踏み込んでいる。禁止対象に
「生成AIベースのコード補完」「対話型 AI 検索」「AI 概要の閲覧」まで含み、
措置として集団アクセス禁止や法的措置も挙げている。ただし**無監督**で、
実効性を示す公式データは見つからなかった。

**paiza のランクは下がらない。** 公式に「一度取得したランクが下がることはない」とある。
これは原則 8 と正面から衝突する。取得時点のスナップショットとしてのみ扱う。

これらはいずれも**アルゴリズムと実装力**を測るもので、公式の定義文に
インフラやクラウドを示す語はない。インフラの代理にはならない。

## 9.5 C: OpenSSF Scorecard — 実際に走らせた

[OpenSSF Scorecard](https://github.com/ossf/scorecard) は 0〜10 点でリポジトリの
衛生状態を機械的に検査する。人の評価ではないが、**再現可能で、操作しづらく、
インフラの実務に近い項目を含む**。

このリポジトリに対して実行した結果（2026-10-12）:

```
総合スコア: 1.8 / 10
```

| チェック | 点 | 内容 |
|---|---|---|
| Dangerous-Workflow | 10/10 | 危険なパターンなし |
| Dependency-Update-Tool | 10/10 | dependabot を検出 |
| Pinned-Dependencies | 7/10 | **third-party 8/8 は固定済み。GitHub 製 0/9 が未固定**（→ 2026-10-17 に 9/9 固定して解消） |
| Token-Permissions | **0/10** | **過大な権限を検出** |
| Vulnerabilities | **0/10** | **既知の脆弱性 10 件** |
| License / Security-Policy / SAST / Fuzzing | 0/10 | 未整備 |

**自前の測定では見つけられなかったものが 3 つ出た。**

1. **`contents: write` を top level にも書いていた**（profile.yml:33、snapshot.yml:40）。
   ジョブ単位で最小化したつもりだったが、トップレベルも広いままで、
   最小権限になっていなかった。これは `prac-security` の自己評価を下げる事実。
2. **GitHub 製 action が 9 箇所すべて未固定**。「third-party は SHA 固定した」は
   正しかったが（8/8）、`actions/checkout` 等は対象外にしていた。
   自前測定の `gha:SHA ピン 1 / タグ参照 45` は、この区別をしていなかった。
   **2026-10-17 に 9 箇所すべてを SHA に固定し、解消した**（`actions/*` も例外にしない方針を
   ワークフローのコメントに明記）。
3. **既知の脆弱性 12 件**（`pnpm audit`。critical 4 / high 1 / moderate 7）。
   うち **`yaml@2.6.1` は本番依存**で、深くネストした入力で Stack Overflow になる
   （修正は 2.8.3 以降）。`data/*.yaml` を読む唯一のパーサがこれ。
   残りは vitest 2.1.8 系の開発依存（tinypool の Prototype Pollution → RCE など）。
   dependabot は動いているが、minor-patch グループでは vitest 2 → 4 のような
   メジャー更新を提案しない。

自前測定では `sec:IaC スキャナ 0 件` `sec:govulncheck 0 件` を**不在として記録**していた。
不在は記録できていたが、**その不在が何を見逃させているかは分かっていなかった。**
これが外部基準の価値そのもの。原則 6（測っていないことを併記する）だけでは足りず、
**測っていない領域を外部の道具で一度は塞ぐ**必要がある。

スコア自体の読み方には注意がある。公式が
*"Scorecard can only report what it can automatically detect"* /
*"A low score is therefore not a definitive indication that the project is at risk"*
と明記している。Code-Review 0/10（承認済み変更が 0）や Contributors 0/10
（貢献組織が 0）は、**単独開発では構造的に 0 になる項目**で、
これを改善対象と見なすのは誤り。§5 の「測らないと決めるもの」と同じ扱いにする。

## 9.6 D: LAPRAS と Findy — 能力ではなく可視性を測っている

### LAPRAS（算出ロジックをコードで公開している）

[lapras-inc/lapras-score-v2](https://github.com/lapras-inc/lapras-score-v2) で
算出式が公開されている。技術力スコアは `a * log1p(b * x)` の重み付き和。

| 子指標 | 重み a | 入力 |
|---|---|---|
| GitHub | 0.32 | 日別コントリビューション数 × 0.1 ＋ リポジトリ評価（コントリビューター数、本人の寄与、**スター数 / 4 の対数**） |
| 技術記事 | 0.21 | Qiita のストック数、Zenn のいいね数、AI レビュー |
| イベント | 0.20 | 参加と登壇 |
| タグ数 | 0.10 | 保有スキルタグ数 |

約 2 万人の参照母集団に対し、**平均 3.0・分散 0.5 の正規分布**になるよう正規化した
相対評価（1.0〜5.0）。**コードの中身は見ていない。**
private リポジトリは「1 日あたりの合計活動量」のみ反映され、内容は反映されない。

設計思想として「客観性・透明性・**ハックしづらさ**」を掲げている
（[doc/1_score_vision.md](https://github.com/lapras-inc/lapras-score-v2/blob/main/doc/1_score_vision.md)）。
これはこのリポジトリの原則 6 と同じ狙いで、**引用価値のある先例が 1 つある**。

> 旧版には「GitHub Star（スターを付けた数）」という軸があった。年収と相関があったが、
> ロジック公開でハックしやすいと判断して**削除された**。
> **相関する指標でも、操作可能なら捨てる。** これは原則 4 の実例として使える。

### Findy

[ペアワイズのランキング学習](https://tech.findy.co.jp/entry/skill-deviation-v3-ml)。
2 人の GitHub ユーザーのリポジトリを比べた人間のアノテーションを学習し、
人間の判断を 8 割以上模倣するとされる。出力は言語別の偏差値。

**対象は Python / JavaScript / TypeScript / Go / Ruby / PHP の 6 言語。**
[公式](https://findy-code.io/blog/skills-update-202412/)は
「プライベートリポジトリについては解析・スコア計算の対象外」と明記している。

### この方の場合、両方とも構造的に低く出る

スコアの入力になる指標を実測した。

| 入力 | 実測値 |
|---|---|
| スター | **0** |
| フォーク | **0** |
| フォロワー | **0** |
| 外部リポジトリへの PR | **0** |
| public gists | **0** |
| 技術記事（Qiita / Zenn） | **0 本** |
| イベント登壇 | 記録なし |

一方、実力側の測定値は AWS リソース 40 種類・Terraform 3,083 行
（`moved` / `value_wo` を含む）・テスト 488 ケース・OIDC で用途別ロール分離。

**Findy は主戦場を見られない。** 主要言語は Terraform（HCL）3,083 行と
YAML 11,297 行で、どちらも 6 言語に含まれない。private 3 リポジトリも対象外。

**したがって D 類型は能力の外部基準として使わない。**
これらが測っているのは「発信の到達度」で、それ自体は実在する別の軸。
`soft-writing` の notes に記録した「外部公開記事 0 本」と同じことを、
別の形で言っているだけ。

## 9.7 E: 市場の値段 — 1 つだけ構造が違う

| サービス | 出力 | 問題 |
|---|---|---|
| [ビズリーチ](https://www.bizreach.jp/content/resume/data/) | スカウト受信数 | **公式データで、職務経歴書が 2,000-3,999 文字で受信数 4.3 倍、4,000 文字以上で 5.0 倍**。スキルではなく文字量で動く |
| ミイダス / doda / リクナビNEXT | 想定年収 | 算出ロジック非開示。年齢・職種・勤務先・現年収といった**属性**の統計的推定 |
| [ASSIGN](https://assign-inc.com/news/16890/) | キャリアタイプと適性 | 24 問の回答から算出。**能力も年収も測っていない**（志向の診断） |
| [転職ドラフト](https://job-draft.jp/) | **企業が提示する実額** | **現年収は非公開**で、技術と経験から企業が年収を提示 |

ビズリーチのスカウト数は**使えない**。公式自身が出している数字が、
文字量との相関を示している。これは原則 4（活動量を能力の指標に使わない）に
そのまま該当する。

**転職ドラフトだけが構造的に違う。** 現年収を企業に見せないため、
他の査定にある最大の交絡（現年収が高いほど高く出る）が排除されている。
テンプレート文や一括送信もシステムで禁止されている。
評価者が実在し、実額を払う意思を示すという点で、E3 に最も近い。

ただし限界がある。

- 2024 年に内定承諾した人の 93% が年収アップ・平均 +160 万円という公式統計は、
  **内定承諾者だけが母数**（生存者バイアス）。
- 提示年収の上昇（平均 644 万円 → 791 万円、中央値 624 万円 → 800 万円、
  2020-01 → 2024-12）は、市場全体の上昇と登録者層の変化を分離できない。
  **同一人物の実力の伸びを示すものではない。**
- 頻度が低い（転職活動が必要）。時系列の比較には向かない。

年収そのものを目標にすると、Goodhart の法則が効いて
「年収の上がる行動」（転職回数、肩書、人気技術名の履歴書掲載）に最適化される。
**年収は XP に入れない。別枠の外部観測値として記録するだけにする。**

## 9.8 提案: 外部基準は 5 本目の軸にしない

§3 で軸は 4 本を上限とした（Monzo が 5 軸 → 3 軸に減らした理由）。
外部基準を 5 本目の軸にすると、同じ失敗をする。

**外部基準は E 軸（証跡）と U 軸（AI 非依存性）を埋める手段として扱う。**

| 外部基準 | 埋まる軸 |
|---|---|
| CKA / RHCSA（監督付き実技、有効期限つき） | **E3 + U2** |
| AWS / Google Cloud 認定（監督付き・選択式） | E3 |
| paiza / AtCoder / PAST（無監督） | E3（U は埋まらない） |
| OpenSSF Scorecard（機械検査） | E3（該当スキルのみ） |
| 転職ドラフトの提示額 | スキル軸には入れない。別記録 |
| LAPRAS / Findy | スキル軸には入れない。別記録 |

スキル軸に入れないものは、`data/calibration.yaml` として
**append-only の外部観測値**に分ける。記録には必ず「日付」と「入力条件」を添える。
算出ロジックが予告なく変わるため（LAPRAS v2.x、Findy ver.3 の実例がある）、
条件を書かない数値は後から比較できない。

### データ構造の案

```yaml
# data/calibration.yaml — 外部からの観測値。XP には入れない。
observations:
  - date: 2026-10-12
    source: openssf-scorecard
    kind: machine_check        # exam | machine_check | market | relative_score
    target: engineer-growth
    score: 1.8
    scale: "0-10"
    conditions: "scorecard v5 / 全チェック / 単独開発のため Code-Review と Contributors は構造的に 0"
    skills: [prac-security, infra-cicd]
    evidence_tier: E3
```

## 9.9 この方への具体的な順番

| | やること | 理由 | コスト |
|---|---|---|---|
| 1 | **Scorecard の指摘を直す** | すでに実在の問題が 3 つ出ている。`yaml@2.6.1` は本番依存 | 無料・即日 |
| 2 | **Scorecard を 8 リポジトリに実行し、記録する** | 再現可能・操作しづらい・インフラの実務に近い。E3 が今日から埋まる | 無料 |
| 3 | **CKA を取る** | インフラで U2 を埋められる唯一の手段。K8s は M0 で最大の空白。SRE 階層の下 3 段を埋める学習と一致。2 年の有効期限が原則 8 を強制する | 有料・数ヶ月 |
| 4 | **PAST を受ける**（任意） | 5 時間の実践型で 2 年有効。実装力の時限つき検証 | 有料・1 日 |
| 5 | **転職ドラフトに登録**（任意） | 現年収非公開で市場の実額が出る。転職の意思と無関係に、外部評価として年 1 回 | 無料・レジュメ作成の手間 |
| — | LAPRAS / Findy | 登録してもよいが**スキル軸には入れない**。「発信の到達度」の記録に留める | 無料 |

GCP 認定（現在 `cloud-gcp: M1`、14 資格の計画あり）は 2 の次に自然に入る。
ただし選択式なので U は埋まらない。E3 のみ。

## 9.10 追加で入れるべき原則

| | 原則 | 根拠 |
|---|---|---|
| 11 | **外部スコアを XP に入れない。** append-only の別記録にし、日付と入力条件を必ず添える | 算出ロジックが予告なく変わる（LAPRAS v2.x、Findy ver.3）。条件なしの数値は比較できない |
| 12 | **相関する指標でも、操作可能なら捨てる** | LAPRAS が旧「GitHub Star」軸を、年収と相関があったにもかかわらずハック容易性のため削除した先例 |
| 13 | **有効期限のある外部検証を優先する** | 原則 8 を外部が強制してくれる。paiza のように減衰しないランクは取得時点のスナップショットとしてのみ扱う |
| 14 | **単独開発で構造的に 0 になる外部指標を、改善対象にしない** | Scorecard の Code-Review / Contributors。§5 の「測らないと決めるもの」と同じ扱い |

## 9.11 追加でレビューしてほしい論点

7. **Scorecard の指摘を今すぐ直すか。** `yaml@2.6.1` は本番依存で、
   `data/*.yaml` を読む唯一のパーサ。深くネストした入力で Stack Overflow になる。
   実害は自分のデータを自分で壊す範囲だが、本番依存に既知の脆弱性を残すのは
   原則に反する。vitest 2 → 4 はメジャー更新なのでテストの修正が必要になる可能性がある。

8. **`contents: write` の二重指定を直すか。** top level を `read` にして、
   必要なジョブだけ `write` にする。小さい変更だが、わたしが
   `prac-security: 3` の根拠に「permissions をジョブ単位で最小化」と書いた
   その箇所が、実際には最小化できていなかった。

9. **CKA を取ることをロードマップに入れるか。** 入れるなら
   `m-container-prod`（2026-12〜2027-01）と `m-network-hands-on` の間に入る。
   ただし「資格を取る」ことが目的化するリスクがある（Goodhart）。
   K8s の空白を埋めることが目的で、CKA はその副産物という順序を保てるか。

10. **`data/calibration.yaml` を作るか。** スキーマと検証を足す分、
    実装コストがかかる。当面は `assessment/` に手書きの記録として残す選択もある。
