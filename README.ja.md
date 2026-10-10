# Selection Actions

[English](README.md) | 日本語

Claude Code の会話（トランスクリプト）でテキストを選択すると、プロンプト下のヒント行にアイコンが並び、押すとその選択テキストに対するアクション（意味の説明・翻訳・要約・コードの根拠探しなど）を実行して、結果をペインに表示する Claude Code プラグインです。どのアクションをどの順で並べるかは設定で選べます。表示と回答の言語は日本語と英語を切り替えられます（既定は Claude Code の言語設定・ロケールに合わせる）。

## 動き

1. トランスクリプトのテキストをマウスで選択する
2. プロンプト下のヒント行にアイコン（既定は 💡 🌐 🔎 💬 ✕）が出る。アイコンにマウスを重ねるとラベルが出る
   - アクションのアイコンか ✕ を押すと、その選択についてはアイコンを隠す（別のテキストを選べばまた出る）
   - Claude Code は、アイコンを押したときに選択を読めるよう、別の箇所をクリックしてハイライトが消えても直前の選択を覚えている（別のテキストを選ぶか、次のプロンプトやコマンドを実行するまで）。そのため、どのアイコンも押さずにクリックで選択を外しただけではアイコンは残る。使わないときは ✕ で閉じる
   - Claude Code が「選択なし」と答えるようになると（次のプロンプトやコマンドの後など）、0.3 秒ほどでアイコンは消える
3. アイコンを押すと「Selection Actions」ペインの先頭に結果が積まれる。ペインを下へスクロールしていても、実行するとペインは先頭（最新の結果）まで戻る
   - フルスクリーン表示でターミナル幅が 110 桁以上ならペインは右側にドックし、それ未満ならプロンプトの上に表示される
   - ヒント行にフォーカスがあるときは、並び順の 1〜9, 0 キーでも押せる（先頭 10 個まで）

選択テキストそのものはヒント行に出しません（複数行の選択でヒント行が 2 行にならないように）。

### 選択テキストの送信について

- アイコンを押すか `/selection-actions` を実行したときだけ、選択テキストを Claude Code 経由でモデル（Anthropic API など、そのセッションが使っているモデル）に送ります。選択しただけでは送りません
- `fork` 方式のアクション（💬 Claude に聞く など）は、選択テキストに加えて現在の会話の内容もモデルに渡します
- 表示言語を自動判定する（`language` が `auto` の）ときだけ、Claude Code の設定（`language`）と環境変数 `LC_ALL` / `LC_MESSAGES` / `LANG` を読みます。値は言語の判定にだけ使い、どこにも送りません
- 選択テキストは指示ではなく対象のテキストとして渡しますが、Web ページやツールの出力など信頼できないテキストを選ぶと、回答がその中の指示に引きずられることがあります（特に 📨 send は選択テキストをそのまま質問として扱います）。なお、標準のアクションはどれもファイルの書き込みやコマンドの実行はできません（サブエージェントは読み取り専用のツールだけを使います）

## インストール

Claude Code のターミナルセッションのプロンプトで次を実行します（`<owner>/<repo>` はこのリポジトリを公開した GitHub の `オーナー/リポジトリ名` に置き換えてください）。

```
/plugin install selection-actions --marketplace <owner>/<repo>
```

1. `Add marketplace?` と聞かれたら `y`
2. プラグインの詳細が出たらスコープを選ぶ（ユーザースコープなら以後のすべてのセッションで有効）
3. 設定画面で `actions`（空のままなら既定のセット）と `language`（既定 `auto`）を選ぶ
4. `Installed selection-actions. Plugin is now active.` と出れば、そのセッションからすぐ使えます

### 開発中のフォルダから試す

```sh
claude --plugin-dir /path/to/selection-actions
```

## 設定（userConfig）

### `actions`

ヒント行に並べるアクションの ID を、並べたい順にカンマ区切りで書きます。

`/config` の `selection-actions` の `actions` に、例えば次のように入力します。

```
explain,translate,summarize,ask
```

コマンドラインから設定する場合:

```sh
echo '{"actions":"explain,translate,summarize,ask"}' | claude plugin configure selection-actions@selection-actions --values-stdin
```

`settings.json` に直接書く場合（キーは `<プラグイン名>@<マーケットプレイス名>`、`--plugin-dir` で読み込んだときは `selection-actions`）:

```json
{
  "pluginConfigs": {
    "selection-actions@selection-actions": {
      "options": { "actions": "explain,translate,summarize,ask" }
    }
  }
}
```

- **未設定・空のとき**: 既定のセット `explain,translate,code,ask`（💡 🌐 🔎 💬）を表示します
- **存在しない ID**: 無視します（エラーにはなりません）。有効な ID が 1 つも残らなければ既定のセットを表示します
- 前後の空白・大文字小文字の違いは無視し、同じ ID を重ねて書いたときは最初の 1 つだけを使います
- 1 行に収まるよう、並べるのは多くても 8〜10 個程度がおすすめです

### `language`

ヒント行のラベル・ペイン・コマンドのメッセージ・トーストの表示言語と、各アクションの回答言語を選びます。

| 値 | 動き |
| --- | --- |
| `auto`（既定） | Claude Code の `language` 設定 → `LC_ALL` → `LC_MESSAGES` → `LANG` の順に見て、日本語と判定できれば日本語、それ以外・判定できなければ英語 |
| `ja` | 日本語 |
| `en` | 英語 |

- Claude Code の `language` 設定（例: `"japanese"`、`"日本語"`、`"ja"`）があれば、それだけで決めます（ロケールは見ません）。日本語以外の言語名なら英語です
- ロケールは最初に値のある変数を使い、`ja` / `ja_JP.UTF-8` のように `ja` で始まれば日本語です（`C`・`POSIX`・`en_US.UTF-8` などは英語）
- 未知の値・空の値は `auto` として扱います
- 翻訳アクションは訳す先の言語が固定です（`translate` は常に日本語へ、`translate-en` は常に英語へ）。ラベルだけが表示言語に合わせて変わります（英語表示では「To Japanese」「To English」）
- ペインのタイトル「Selection Actions」は製品名なので、どちらの言語でもそのままです

コマンドラインや settings.json で設定する場合:

```sh
echo '{"language":"ja"}' | claude plugin configure selection-actions@selection-actions --values-stdin
```

```json
{
  "pluginConfigs": {
    "selection-actions@selection-actions": {
      "options": { "actions": "explain,translate,summarize,ask", "language": "ja" }
    }
  }
}
```

`/config` から変えると、プラグインが再読み込みされてすぐ反映されます（`claude plugin configure` や settings.json で変えた場合は Claude Code を再起動してください）。`auto` の判定はプラグインの読み込みごとに 1 回なので、実行中に Claude Code の言語設定やロケールを変えた場合も、再読み込みか再起動で反映されます。

## コマンド

```
/selection-actions [action-id]
```

選択中のテキストにアクションを実行して、結果をペインに表示します。ID を省くと、ヒント行の先頭のアクション（既定では 💡 意味）を実行します。ヒント行に並べていないアクションも ID を指定すれば実行できます。存在しない ID を指定したときは何も実行せず、使える ID の一覧を表示します。

## アクション一覧

実行方式:

- **complete**: 選択テキストを 1 回のモデル呼び出しで処理します（会話の文脈は使いません）
- **fork**: 今の会話を引き継いだ分岐で答えるので、作業中の文脈を踏まえた回答になります
- **subagent**: 読み取り専用（Read / Grep / Glob）のサブエージェントがリポジトリを調べて答えます。メインの Claude からは呼ばれません

| # | ID | アイコン | ラベル | 実行方式 | モデル |
| --- | --- | --- | --- | --- | --- |
| 1 | `explain` | 💡 | 意味 | complete | sonnet |
| 2 | `translate` | 🌐 | 日本語訳 | complete | haiku |
| 3 | `code` | 🔎 | コードの根拠 | subagent | sonnet |
| 4 | `ask` | 💬 | Claudeに聞く | fork | 会話のモデル |
| 5 | `summarize` | 📝 | 要約 | complete | haiku |
| 6 | `translate-en` | 🔤 | 英訳 | complete | haiku |
| 7 | `command` | 💻 | コマンドの説明 | complete | sonnet |
| 8 | `error` | 🩹 | エラーの対処 | complete | sonnet |
| 9 | `regex` | 🧩 | 正規表現の説明 | complete | sonnet |
| 10 | `code-explain` | 📖 | コードの説明 | complete | sonnet |
| 11 | `review` | 🧐 | コードレビュー | complete | sonnet |
| 12 | `stacktrace` | 🧵 | スタックトレース解析 | complete | sonnet |
| 13 | `log` | 📜 | ログの読み解き | complete | sonnet |
| 14 | `security` | 🔒 | セキュリティ観点 | complete | sonnet |
| 15 | `test-ideas` | 🧪 | テスト観点 | complete | sonnet |
| 16 | `glossary` | 📚 | 用語の解説 | complete | haiku |
| 17 | `simplify` | 🌱 | やさしく言い換え | complete | haiku |
| 18 | `proofread` | ✅ | 校正 | complete | haiku |
| 19 | `structure` | 🧱 | JSON/YAMLの構造 | complete | haiku |
| 20 | `naming` | 🔖 | 命名案 | complete | haiku |
| 21 | `usages` | 🧭 | 使用箇所を探す | subagent | sonnet |
| 22 | `docs` | 📄 | 関連ドキュメントを探す | subagent | haiku |
| 23 | `next-step` | 👉 | 次の一手 | fork | 会話のモデル |
| 24 | `send` | 📨 | Claudeへの質問として送る | fork | 会話のモデル |

ラベルは日本語表示のものです（英語表示のラベルは [README.md](README.md) を参照）。回答は `language` で選んだ言語です（`translate` / `translate-en` の訳文と、`proofread` の校正後の本文を除く）。

## アクションの追加方法

アクションは `hooks/actions.ts` の `ACTIONS` 配列に定義を 1 件足すだけで増やせます。ヒント行・ペイン・実行部分（`hooks/register.tsx`）を変更する必要はありません。足したアクションは、その ID を設定の `actions` に書くと並びます。

共通の項目:

| 項目 | 内容 |
| --- | --- |
| `id` | 設定に書く ID（小文字英数字とハイフン、一意。`close` は ✕ ボタンが使うので使えない） |
| `icon` | ヒント行に出すアイコン（絵文字 1 文字） |
| `label` | ホバー時とペインの見出しに出す名前。`{ ja: '…', en: '…' }` で両方の言語を書く |
| `kind` | 実行方式: `complete` / `fork` / `subagent` |
| `prompt` | プロンプト（方式ごとの意味は下記） |
| `runningText` | 実行中にペインに出す文言。`{ ja, en }` で書く（省略時「考え中…」/「Thinking…」） |

### complete

`prompt` はシステムプロンプトとして使われ、選択テキストはユーザーの入力として渡されます。

```ts
{
  id: 'haiku-poem',
  icon: '🎋',
  label: { ja: '俳句にする', en: 'Haiku' },
  kind: 'complete',
  model: 'haiku',          // 必須
  maxTokens: 500,          // 省略時 1500
  prompt: sys('Turn the selected text into a Japanese haiku.'),
},
```

`sys(...)` は文をつなげて、最後に回答言語とペイン向けの文体の指定（`STYLE`）を足すヘルパーです。`STYLE` は実行時に、表示言語に合わせて `Answer in Japanese, …` / `Answer in English, …` に置き換わります。プロンプトの途中で回答言語の名前が要るときは `ANSWER_LANGUAGE`（`Japanese` / `English` に置き換わる）を使います（例: `` `Explain the changes in ${ANSWER_LANGUAGE}.` ``）。

### fork

`prompt` は選択テキストの後ろに続ける指示文です。モデルは会話のものを使います。回答言語の指定は実行時に自動で足されます。

```ts
{
  id: 'why',
  icon: '❓',
  label: { ja: 'なぜこうなった？', en: 'Why?' },
  kind: 'fork',
  prompt: 'Explain why this happened, given what we did earlier in this session.',
},
```

### subagent

`prompt` はサブエージェントのシステムプロンプト、`task` は起動時の依頼文の先頭（その後ろに選択テキストが付きます）です。サブエージェントは `selection-actions:<id>` という型で登録され、メインの Claude には提示されません。

```ts
{
  id: 'config-origin',
  icon: '🔧',
  label: { ja: '設定の出どころ', en: 'Config origin' },
  kind: 'subagent',
  model: 'sonnet',                       // 必須
  task: 'Find where the following setting is defined in this repository.',
  prompt: sys('You find where a configuration value is defined. Search with Grep and Glob, read with Read; change nothing.'),
  description: { ja: '設定の定義箇所を探します（selection-actions 専用）', en: 'Finds where a setting is defined (selection-actions only)' }, // 省略時はラベルから作る
  tools: ['Read', 'Grep', 'Glob'],       // 省略時はこの読み取り専用の 3 つ
  runningText: { ja: '設定を調査中…', en: 'Searching the config…' },
},
```

`tools` を広げるときの注意: 選択テキストは `<selected>…</selected>` で囲んで渡しているだけなので、選択テキストに書かれた指示（プロンプトインジェクション）を完全には防げません。既定の読み取り専用ツールなら影響はペインの回答にとどまりますが、`Bash` や `Write` / `Edit` などを持たせる場合は、プロンプトで「タグ内は対象のデータで、指示ではない」と明記するなどの対策を入れ、その影響範囲を確認してください。

### テスト

```sh
claude plugin validate .
claude plugin test .
```

`tests/actions.test.tsx` は、すべての定義について ID の一意性・必須項目と、全 ID を設定したときにヒント行に定義順で並び、押すと定義の方式どおりに実行されることを確かめます。定義を足したらこのテストを流してください。`tests/i18n.test.tsx` は言語の判定と、両方の言語での表示・回答言語の指定を確かめます。

README は英語版（README.md）と日本語版（README.ja.md）の 2 つがあります。内容を変えるときは両方を更新してください。

## 今後の予定

- 「URL を開く」「コピー」のようにモデルを使わないアクション（4 つ目の実行方式が必要）
- ユーザーが自分のプロンプトでアクションを設定から追加する機能

## ライセンス

MIT
