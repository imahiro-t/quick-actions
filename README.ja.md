# Quick Actions

[English](README.md) | 日本語

Claude Code の会話（トランスクリプト）で選択したテキストと、会話そのものに対するアイコンアクションの Claude Code プラグインです。テキストを選択するとプロンプト下のヒント行にアイコンが並び、押すと選択テキストに対するアクション（翻訳・意味のやさしい／詳しい説明・要約・根拠探し）や、今の会話に対するアクション（会話の要約・ここまでの決定事項・次にやること・引き継ぎメモなど）を実行して、結果をペインに表示します。何も選択していなくても、`/quick-actions hint` で会話に対するアクションのヒント行を出せます。よく使うアクションほど前に並び、設定で先頭に固定（ピン留め）することもできます。ヒント行に並ばないものも含め、すべてのアクションは末尾の ⋯ から選べます。表示と回答の言語は日本語と英語を切り替えられます（既定は Claude Code の言語設定・ロケールに合わせる）。

## 動き

アクションは 2 種類あり、1 本の並びに混ざって並びます。

- **選択アクション**（`[アイコン]` で表示）: 選択したテキストに対して実行します（[アクション一覧](#アクション一覧)の 1 つ目の表）
- **コンテキストアクション**（`<アイコン>` で表示）: 選択テキストを使わず、今の会話そのものを対象に、会話を引き継いだ分岐（fork）で実行します（[2 つ目の表](#コンテキストアクション)）。選択アクションと同じアイコン（🧸・🌐・📝）のものがありますが、`[ ]` と `< >` で見分けられます

1. トランスクリプトのテキストをマウスで選択する（何も選択していないときは [`/quick-actions hint`](#選択なしでヒント行を開くquick-actions-hint) を実行する）
2. プロンプト下のヒント行に、2 種類が混ざってアイコンが出る。アイコンにマウスを重ねるとラベルが出る
   - 並ぶのは先頭の 6 個（[`hintCount`](#hintcount) で変えられる）、その後ろに ✕ と ⋯。初めて使うときは `[💡] <🧭> [🌐] <✅> [📝] [🔎] ✕ ⋯`
   - 並び順は「[`actions`](#actions) で先頭に固定（ピン留め）したもの → 残りをよく使う順」で、2 種類を 1 本の並びにする。使うたびに使用回数を記録し、最近よく使うものほど前に来る（[使用回数の保存](#使用回数の保存)）
   - 並べ替えはセッションの開始時だけ。セッション中に使っても並びは動かないので、押そうとした位置がずれることはない
   - アクションのアイコン（どちらの種類でも）か ✕ を押すと、その選択についてはアイコンを隠す（別のテキストを選べばまた出る）
   - Claude Code は、アイコンを押したときに選択を読めるよう、別の箇所をクリックしてハイライトが消えても直前の選択を覚えている（別のテキストを選ぶか、次のプロンプトやコマンドを実行するまで）。そのため、どのアイコンも押さずにクリックで選択を外しただけではアイコンは残る。使わないときは ✕ で閉じる
   - Claude Code が「選択なし」と答えるようになると（次のプロンプトやコマンドの後など）、0.3 秒ほどでアイコンは消える。これは選択だけで出たヒント行の動きで、`/quick-actions hint` で開いたヒント行の閉じ方は[後述](#選択なしでヒント行を開くquick-actions-hint)のとおり
3. アイコンを押すと「Quick Actions」ペインの先頭に結果が積まれる。ペインを下へスクロールしていても、実行するとペインは先頭（最新の結果）まで戻る
   - フルスクリーン表示でターミナル幅が 110 桁以上ならペインは右側にドックし、それ未満ならプロンプトの上に表示される
4. ヒント行に並んでいないアクションは、末尾の ⋯ を押すと開くダイアログから選べる（`/quick-actions` を ID なしで実行しても開く）
   - 組み込みと有効なカスタムアクションのすべてが、ヒント行と同じ順に `[アイコン] ラベル` か `<アイコン> ラベル` で並ぶ
   - 何も選択していないときに開いたダイアログ（ID なしの `/quick-actions`、または選択なしで `/quick-actions hint` を実行して開いたヒント行の ⋯）には、コンテキストアクションだけが並ぶ
   - ↑↓ で移動して Enter で実行、Esc で何もせずに閉じる。クリックでも選べ、「閉じる」ボタンでも閉じられる
   - 選んだ選択アクションは、ダイアログを開いたときに選択していたテキストに対して実行し、コンテキストアクションは会話に対して実行する。結果は「Quick Actions」ペインに表示する
   - プロンプトに入力中のテキストがあるときは、ダイアログにキーボードが移らない（モバイルアプリ以外ではダイアログに案内が出る。モバイルアプリではタップで選ぶ）。クリックで選ぶか、入力欄を空にしてから開き直す（⋯ を押すか、実行と同時に入力欄が空になる `/quick-actions` で）

選択テキストそのものはヒント行に出しません（複数行の選択でヒント行が 2 行にならないように）。

### 選択なしでヒント行を開く（`/quick-actions hint`）

`/quick-actions hint` を実行すると、選択の有無にかかわらずヒント行を出せます。

- **何も選択していないとき**: コンテキストアクションだけを同じ並び順で出す（初めて使うときは `<🧭> <✅> <📋> <❓> <🧸> <🌐> ✕ ⋯`）
- **テキストを選択しているとき**: 選択だけで出るときと同じく、両方の種類を出す。コマンドを実行すると Claude Code はその選択を「選択なし」と答えるようになるため、コマンドを実行した時点の選択テキストを取り込んでおき、選択アクションはハイライトが消えたあとも、そのテキストに対して実行する

閉じ方は、選択だけで出たヒント行に揃えています。

- **✕ を押す**、または**ヒント行からアクションを実行する**（どちらの種類でも。ヒント行の ⋯ から開いたダイアログで選んだときも）
- **開いたあとに新しく作った選択が消える**: 開いている間にテキストを選ぶと、そのテキストに対して両方の種類が出る。その選択を Claude Code が「選択なし」と答えるようになると、0.3 秒ほどで閉じる

コマンドを実行した時点の選択はこれに当たりません。その選択の消失（コマンドの実行そのもので起きる）では閉じません。トレードオフとして、選択した状態で開いたヒント行は、元のテキストのハイライトが消えたあとも、✕ を押すかアクションを実行するまで残り、選択アクションはそのテキストに対して動きます（上の「クリックで選択を外してもアイコンは残る」のと同じ種類の動きです）。また、開いたあとに取り込んだのとまったく同じテキストを選び直しても新しい選択とはみなさないため、その選択が消えても閉じません。✕ で閉じてください。

### 選択テキストの送信について

- アイコンや ⋯ ダイアログのアクションを押すか、`/quick-actions <id>` を実行したときだけ、選択テキストを Claude Code 経由でモデル（Anthropic API など、そのセッションが使っているモデル）に送ります。選択しただけ・⋯ ダイアログを開いただけ・`/quick-actions hint` を実行しただけでは送りません
- `fork` 方式の選択アクション（💬 Claudeに聞く と 🧾 根拠を説明）は、選択テキストに加えて現在の会話の内容もモデルに渡します
- [コンテキストアクション](#コンテキストアクション)は、押したとき、または `/quick-actions <id>` でその ID を実行したときに、選択テキストは送らず、現在の会話（セッションの fork）をモデルに渡します。それまでの会話の内容（プロンプト、Claude の回答、ツールの結果、読み込んだファイルの内容）がすべて含まれます。セッションで次のターンを送るときと同じです
- 表示言語を自動判定する（`language` が `auto` の）ときだけ、Claude Code の設定（`language`）と環境変数 `LC_ALL` / `LC_MESSAGES` / `LANG` を読みます。値は言語の判定にだけ使い、どこにも送りません
- 選択テキストは指示ではなく対象のテキストとして渡しますが、Web ページやツールの出力など信頼できないテキストを選ぶと、回答がその中の指示に引きずられることがあります。特に `fork` 方式の 💬 Claudeに聞く と 🧾 根拠を説明 は、会話の文脈と合わせて選択テキストを扱うため影響を受けやすくなります（🧾 根拠を説明 は選択テキストを Claude の発言として扱い、会話の文脈で推論します）。なお、標準のアクションはどれもファイルの書き込みやコマンドの実行はできません（2 つのサブエージェントのうち、🔎 コードの根拠 は読み取り専用のツール（Read / Grep / Glob）だけを、📚 Webで裏どり は `WebSearch` / `WebFetch` だけを使います）
- 📚 Webで裏どり（`web-check`）は、選択テキストを外部へ送ります。選択テキストの語句を Web 検索サービスへの検索クエリとして送り、選択テキストに書かれた URL や、検索結果に出てきた URL のページを取得します。ファイルを読むツールを持たないため、検索クエリや URL にリポジトリの内容が混ざることはありません。検索クエリは選択テキスト由来、取得先は選択テキスト中の URL か検索結果の URL です（プロンプトでも検索クエリを選択テキストだけから作り、取得先をこれらの URL に限るよう指示していますが、この点はモデルがそれに従うことに依存します）。取得した Web ページに書かれた指示（プロンプトインジェクション）に、回答や、次に検索・取得する内容が引きずられることがあります。ファイルの変更やコマンドの実行はできないため、影響はペインの回答にとどまります。送るのは、ヒント行や ⋯ ダイアログで 📚 を押したとき、または `/quick-actions web-check` を実行したときだけです。初めて使うときの並びには入りませんが、⋯ ダイアログからはいつでも選べ、使うとよく使う順でヒント行に出ることがあります（並びから外す設定はありません）。検索・取得ができるかどうかは、Claude Code の `WebSearch` / `WebFetch` の権限設定にもよります
- [`customActions`](#customactions) で自分で追加したアクションも、同じように選択テキストを送ります。`WebFetch` / `WebSearch` を許したカスタムのサブエージェントは、選択テキストや読んだファイルの内容（リポジトリの外のものも含む）を外部のサイトへ送り得ます（選択テキストに紛れた指示に誘導されて送ることもあります）。コマンドの実行やファイルの変更ができるツール（`Bash` / `Write` / `Edit` など）は受け付けません（[設定から追加する](#設定から追加するcustomactions)を参照）

### 使用回数の保存

- ヒント行の並び順のために、アクションごとの使用回数を、Claude Code がこのプラグイン専用に用意するローカルの保存領域（`$.store`。Claude Code の設定ディレクトリ内のファイル）に保存します。外部へは送りません
- 保存するのはアクションの ID ごとの使用スコアと最後に使った時刻だけで、選択テキストや結果は保存しません
- スコアは使うたびに 1 増え、30 日で半分になります（昔よく使ったものがいつまでも前に残らないように）
- 外したカスタムアクションのスコアは並びに影響しません（定義を戻したときのために残ります）。使用回数をリセット・閲覧する UI はありません

## インストール

Claude Code のターミナルセッションのプロンプトで次を実行します（`<owner>/<repo>` はこのリポジトリを公開した GitHub の `オーナー/リポジトリ名` に置き換えてください）。

```
/plugin install quick-actions --marketplace <owner>/<repo>
```

1. `Add marketplace?` と聞かれたら `y`
2. プラグインの詳細が出たらスコープを選ぶ（ユーザースコープなら以後のすべてのセッションで有効）
3. 設定画面で `actions`（先頭に固定したいアクション。空のままならよく使う順）、`hintCount`（ヒント行に並べる数。既定 6）と `language`（既定 `auto`）を選ぶ。`customActions`（自分で追加するアクション）は空のままで構いません
4. `Installed quick-actions. Plugin is now active.` と出れば、そのセッションからすぐ使えます

### 開発中のフォルダから試す

```sh
claude --plugin-dir /path/to/quick-actions
```

## 設定（userConfig）

### `actions`

ヒント行の先頭に固定（ピン留め）するアクションの ID を、固定したい順にカンマ区切りで書きます。書かなかったアクションも、その後ろによく使う順で並び、⋯ ダイアログからも選べます。

`/config` の `quick-actions` の `actions` に、例えば次のように入力します。

```
explain,translate,summarize,ask
```

コマンドラインから設定する場合:

```sh
echo '{"actions":"explain,translate,summarize,ask"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

`settings.json` に直接書く場合（キーは `<プラグイン名>@<マーケットプレイス名>`、`--plugin-dir` で読み込んだときは `quick-actions`）:

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": { "actions": "explain,translate,summarize,ask" }
    }
  }
}
```

- **未設定・空のとき**: ピン留めはなしで、すべてをよく使う順に並べます。使用履歴がない初回は、既定のセット `explain,recap,translate,decisions,summarize,code`（`[💡] <🧭> [🌐] <✅> [📝] [🔎]`。2 種類を交互に）を先頭に、残りを定義順（[選択アクション](#アクション一覧) → [コンテキストアクション](#コンテキストアクション)の順）に並べます
  - 使用回数が同じ・まだ使っていないアクションは定義順です。そのため、何か 1 つでも使うと、既定のセットを先頭にする並びはなくなり、使ったもの → 残りを定義順（`[🌐] [🔤] [💡] [🧸] …`）になります。既定のセットを前に置き続けたいときは `actions` に書いてください
- **どちらの種類でも**: コンテキストアクションの ID（`recap`、`handoff` など）も、選択アクションの ID と同じようにピン留めでき、混ぜて好きな順に書けます。何も選択していないときのヒント行は選択アクションを飛ばし、ピン留めしたコンテキストアクションを先頭に並べます
- **存在しない ID**: 無視します（エラーにはなりません）。有効な ID が 1 つも残らなければ、ピン留めなし（空のときと同じ）になります
- **自分で追加したアクション**: [`customActions`](#customactions) の有効な定義の ID も、標準のアクションと同じようにここに書けます
- **外した ID**: 組み込みアクションは絞り込みました（今あるものは[アクション一覧](#アクション一覧)を参照）。外した `command`, `error`, `regex`, `code-explain`, `review`, `stacktrace`, `log`, `security`, `test-ideas`, `glossary`, `simplify`, `proofread`, `structure`, `naming`, `usages`, `docs`, `next-step`, `send` を `actions` に書いたままの場合は、存在しない ID と同じく無視されます（ピン留めされなくなるだけで、有効な ID が 1 つも残らなければピン留めなしになります）
- 前後の空白・大文字小文字の違いは無視し、同じ ID を重ねて書いたときは最初の 1 つだけを使います
- ピン留めが [`hintCount`](#hintcount) より多いときは、先頭の `hintCount` 個までをヒント行に並べ、残りは ⋯ から選びます

### `hintCount`

ヒント行に並べるアクションの数です（既定 `6`）。残りは末尾の ⋯ から選べます。1 以上の整数を書きます。空・`0`・負の数・小数・数字以外は既定の 6 として扱います。ヒント行が 1 行に収まる数にしてください。

```sh
echo '{"hintCount":"8"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": { "actions": "explain,translate", "hintCount": "8" }
    }
  }
}
```

ほかの設定と同じく、`/config` で変えればすぐ反映され、`claude plugin configure` や settings.json で変えた場合は Claude Code を再起動してください。

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
- ペインのタイトル「Quick Actions」は製品名なので、どちらの言語でもそのままです

コマンドラインや settings.json で設定する場合:

```sh
echo '{"language":"ja"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": { "actions": "explain,translate,summarize,ask", "language": "ja" }
    }
  }
}
```

`/config` から変えると、プラグインが再読み込みされてすぐ反映されます（`claude plugin configure` や settings.json で変えた場合は Claude Code を再起動してください）。`auto` の判定はプラグインの読み込みごとに 1 回なので、実行中に Claude Code の言語設定やロケールを変えた場合も、再読み込みか再起動で反映されます。

### `customActions`

自分で追加するアクションの定義を、JSON の配列として 1 つの文字列で書きます（既定は空）。項目と例は[設定から追加する](#設定から追加するcustomactions)を参照してください。有効な定義は、標準のアクションと同じくヒント行（よく使う順）と ⋯ ダイアログに並びます。`actions` に ID を書くと先頭に固定できます。`/quick-actions <id>` でも実行できます。

`/config` の `quick-actions` の `customActions` に、配列を 1 行で入力します。例:

```
[{"id":"pirate","icon":"🦜","label":{"ja":"海賊風に言い換え","en":"Pirate talk"},"kind":"complete","model":"haiku","prompt":"Retell the selected text the way a pirate would."}]
```

コマンドラインから設定する場合（値は文字列なので、中の引用符をエスケープします）:

```sh
claude plugin configure quick-actions@quick-actions --values-stdin <<'EOF'
{"actions":"explain,pirate","customActions":"[{\"id\":\"pirate\",\"icon\":\"🦜\",\"label\":{\"ja\":\"海賊風に言い換え\",\"en\":\"Pirate talk\"},\"kind\":\"complete\",\"model\":\"haiku\",\"prompt\":\"Retell the selected text the way a pirate would.\"}]"}
EOF
```

`settings.json` に直接書く場合も、同じようにエスケープします:

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": {
        "actions": "explain,pirate",
        "customActions": "[{\"id\":\"pirate\",\"icon\":\"🦜\",\"label\":{\"ja\":\"海賊風に言い換え\",\"en\":\"Pirate talk\"},\"kind\":\"complete\",\"model\":\"haiku\",\"prompt\":\"Retell the selected text the way a pirate would.\"}]"
      }
    }
  }
}
```

`actions` / `language` と同じく、プラグインの再読み込みのたびに読み直します。`/config` で変えればすぐ反映され、`claude plugin configure` や settings.json で変えた場合は Claude Code を再起動してください。変えた後に `/quick-actions` を実行すると、無視された定義があるかとその理由を確認できます。

## コマンド

```
/quick-actions [action-id | hint]
```

アクションを実行して、結果をペインに表示します。選択アクションは選択中のテキストに対して実行し（何も選択していなければ、その旨を伝えて何も実行しません）、コンテキストアクションは選択の有無にかかわらず会話に対して実行します。ID を省くと、ヒント行の ⋯ と同じダイアログを開き、そこで選んだアクションを、コマンドを実行したときに選択していたテキストに対して実行します（何も選択していなければ、ダイアログにはコンテキストアクションだけが並びます）。`/quick-actions hint` は、選択していなくてもヒント行を開きます（[前述](#選択なしでヒント行を開くquick-actions-hint)）。ヒント行に並んでいないアクションも（自分で追加したものを含め）ID を指定すれば実行できます。存在しない ID を指定したときは何も実行せず、使える ID の一覧を表示します。`customActions` で無視された定義の ID を指定したときは、何も実行せずその理由を表示します。

`customActions` に問題があるときは、このコマンドのどの結果（ID の有無を問わず、何も選択していないときも）の末尾にも、無視した定義とその理由の一覧が付きます。

## アクション一覧

実行方式:

- **complete**: 選択テキストを 1 回のモデル呼び出しで処理します（会話の文脈は使いません）
- **fork**: 今の会話を引き継いだ分岐で答えるので、作業中の文脈を踏まえた回答になります。コンテキストアクションはすべてこの方式です
- **subagent**: 専用のサブエージェントが調べて答えます。🔎 コードの根拠 は読み取り専用のツール（Read / Grep / Glob）でリポジトリを、📚 Webで裏どり は `WebSearch` / `WebFetch` だけで Web を調べます。メインの Claude からは呼ばれません

組み込みの選択アクションは、翻訳・意味・要約・根拠の 4 つの用途に絞っています。

| # | 用途 | ID | アイコン | ラベル | 内容 | 実行方式 | モデル |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 翻訳 | `translate` | 🌐 | 日本語訳 | 日本語に訳す | complete | haiku |
| 2 | 翻訳 | `translate-en` | 🔤 | 英訳 | 英語に訳す | complete | haiku |
| 3 | 意味 | `explain` | 💡 | 意味 | 意味・出てきた理由・対処を説明する | complete | sonnet |
| 4 | 意味 | `eli5` | 🧸 | やさしく説明 | 前提知識ゼロ向けに、たとえを使ってやさしく説明する | complete | haiku |
| 5 | 意味 | `deep-dive` | 🔬 | 詳しく解説 | 仕組み・背景まで踏み込んで詳しく解説する | complete | sonnet |
| 6 | 意味 | `ask` | 💬 | Claudeに聞く | 今の作業の文脈で説明する | fork | 会話のモデル |
| 7 | 要約 | `summarize` | 📝 | 要約 | 数文か 5 項目以内の箇条書きで要約する | complete | haiku |
| 8 | 要約 | `tldr` | ⚡ | 一行で要約 | 一行で要約する | complete | haiku |
| 9 | 根拠 | `code` | 🔎 | コードの根拠 | リポジトリ内でその文言・挙動の出どころを探す | subagent | sonnet |
| 10 | 根拠 | `why` | 🧾 | 根拠を説明 | 会話の中の Claude の発言について、そう言える根拠を説明する | fork | 会話のモデル |
| 11 | 根拠 | `web-check` | 📚 | Webで裏どり | 選択テキストの主張を Web の出典で確かめ、裏づけられた点と、裏づけが取れない・食い違う点を出典 URL つきで分けて示す | subagent | sonnet |

ラベルは日本語表示のものです（英語表示のラベルは [README.md](README.md) を参照）。回答は `language` で選んだ言語です（`translate` / `translate-en` の訳文を除く）。ほかの用途（コードレビューやログの読み解きなど）は、自分で追加するアクションで補ってください。

### コンテキストアクション

選択テキストを使わず、今の会話を対象に、セッションの fork で実行します（モデルは会話のもの）。どれも、会話に根拠がないことは推測せず分からないと書くよう指示しており、回答はおよそ 10〜15 行です。

| # | ID | アイコン | ラベル | 内容 |
| --- | --- | --- | --- | --- |
| 1 | `recap` | 🧭 | 会話の要約 | 会話の目的・経緯・現状を短くまとめる |
| 2 | `decisions` | ✅ | ここまでの決定事項 | 決まったこと・合意したことを箇条書きにする |
| 3 | `todo` | 📋 | 次にやること | 残っている作業を、実行順の TODO として並べる |
| 4 | `open-questions` | ❓ | 未解決の疑問 | まだ答えの出ていない問い・保留点を並べる |
| 5 | `simplify-last` | 🧸 | 直前の回答をやさしく | Claude の直前の回答を、前提知識のない人向けに言い直す |
| 6 | `translate-last` | 🌐 | 直前の回答を翻訳 | Claude の直前の回答を訳す。主に日本語なら英語へ、それ以外なら日本語へ（訳す先は `language` より優先） |
| 7 | `assumptions` | 🧱 | 前提・仮定の洗い出し | 作業が頼っている前提・仮定を挙げ、確かめていないものを示す |
| 8 | `risks` | ⚠️ | リスク・懸念点 | 今の方針・変更のリスクと懸念点を、重要度の高い順に挙げる |
| 9 | `changed-files` | 🗂 | 変更したファイルとその内容 | セッションで作成・変更・削除したファイルと変更内容を、会話から分かる範囲で並べる |
| 10 | `next-questions` | 💭 | 次に聞くとよい質問 | 次に Claude に聞くとよい質問を 3〜5 個提案する |
| 11 | `handoff` | 📝 | 引き継ぎメモ | 別の人・別のセッションに渡す引き継ぎメモ（目的・現状・決定事項・残作業・注意点） |

ペインでは、結果の見出しのアイコンとラベルの後ろに、選択アクションなら選択テキストの引用、コンテキストアクションなら「今の会話」と出ます。

## アクションの追加方法

追加の方法は 2 つあります。プラグインを変更せずに設定（`customActions`）で追加する方法と、プラグインの開発者向けにソースへ追加する方法です。どちらでも、ヒント行・⋯ ダイアログ・ペイン・コマンドは標準のアクションと同じように扱います。追加したアクションはヒント行（よく使う順）と ⋯ ダイアログに並び、その ID を `actions` に書くと先頭に固定できます。

### 設定から追加する（customActions）

[`customActions`](#customactions) の設定に、定義を JSON の配列で書きます。下の例は読みやすいよう複数行に分けています。`/config` では配列を 1 行で入力してください。

| 項目 | 必須 | 方式 | 内容 |
| --- | --- | --- | --- |
| `id` | 必須 | すべて | `actions` やコマンドに書く ID。小文字英数字を 1 つずつのハイフンでつないだもの（`review-pr`）。標準アクションの ID・`close`（✕ ボタンが使う）・`hint`（コマンドの引数）・先にあるカスタム定義の ID とは重ねられない |
| `icon` | 必須 | すべて | ヒント行に出すアイコン（絵文字 1 文字） |
| `label` | 必須 | すべて | ホバー時とペインの見出しに出す名前。両言語共通の文字列 1 つか、`{ "ja": "…", "en": "…" }` |
| `kind` | 必須 | すべて | 実行方式: `complete` / `fork` / `subagent`（標準のアクションと同じ。[アクション一覧](#アクション一覧)を参照） |
| `target` | 任意 | すべて | 対象: `selection`（既定。空のときも）か `context`（選択テキストを使わず会話が対象。このとき `kind` は `fork` に限る）。ヒント行では、それぞれ `[アイコン]` / `<アイコン>` で表示する |
| `prompt` | 必須 | すべて | complete: システムプロンプト、fork: 選択テキストの後ろに続ける指示文（`target` が `context` なら指示文だけ）、subagent: サブエージェントのシステムプロンプト |
| `runningText` | 任意 | すべて | 実行中にペインに出す文言。書き方は `label` と同じ（省略時「考え中…」/「Thinking…」） |
| `model` | complete と subagent で必須 | complete, subagent | `haiku` / `sonnet` / `opus` のみ（小文字）。fork は会話のモデルを使うので無視します |
| `maxTokens` | 任意 | complete | 回答の長さの上限。1〜32000 の整数（省略時 1500） |
| `task` | subagent で必須 | subagent | サブエージェントを起動するときの依頼文の先頭。その後ろに選択テキストが付きます |
| `description` | 任意 | subagent | サブエージェントの型の説明。書き方は `label` と同じ（省略時はラベルから作る） |
| `tools` | 任意 | subagent | `Read` / `Grep` / `Glob` / `WebFetch` / `WebSearch` から選ぶ（表記どおり）。省略時は `["Read", "Grep", "Glob"]`。ほかのツールを 1 つでも書いた定義は、定義ごと無視します |

方式に関係しない項目（complete の `tools` など）や、未知の項目は無視します。

complete:

```json
{
  "id": "pirate",
  "icon": "🦜",
  "label": { "ja": "海賊風に言い換え", "en": "Pirate talk" },
  "kind": "complete",
  "model": "haiku",
  "maxTokens": 500,
  "prompt": "Retell the selected text the way a pirate would."
}
```

fork:

```json
{
  "id": "cause",
  "icon": "❓",
  "label": { "ja": "原因は？", "en": "What caused this?" },
  "kind": "fork",
  "prompt": "Explain why this happened, given what we did earlier in this session."
}
```

コンテキストアクション（`target` を `context` にした fork。選択テキストは使わず、`<📣>` と表示し、選択なしで `/quick-actions hint` を実行したヒント行にも出る）:

```json
{
  "id": "standup",
  "icon": "📣",
  "label": { "ja": "進捗報告", "en": "Status update" },
  "kind": "fork",
  "target": "context",
  "prompt": "Write a short status update on this session for the team: what is done, what is in progress, and what is blocked."
}
```

subagent（既定の読み取り専用ツールを明示した例。`tools` に `WebSearch` / `WebFetch` を足すと Web も調べられますが、先に下の注意を読んでください）:

```json
{
  "id": "review-pr",
  "icon": "🧪",
  "label": { "ja": "コードレビュー", "en": "Code review" },
  "kind": "subagent",
  "model": "sonnet",
  "task": "Review the following code, reading the files around it.",
  "prompt": "You review code for bugs and risky patterns. Search with Grep and Glob, read with Read; change nothing.",
  "runningText": { "ja": "レビュー中…", "en": "Reviewing…" },
  "tools": ["Read", "Grep", "Glob"]
}
```

設定にはこれらを並べた配列を書きます: `[{ …pirate… }, { …cause… }, { …standup… }, { …review-pr… }]`

#### 回答言語の扱い

プロンプトには `{STYLE}` と `{ANSWER_LANGUAGE}` を文字どおり書けます。実行時に、`language` に合わせて `{STYLE}` は回答言語とペイン向けの文体の指定（`Answer in Japanese, …` / `Answer in English, …`）に、`{ANSWER_LANGUAGE}` は言語名（`Japanese` / `English`）に置き換わります。

- **complete と subagent**: `prompt` にどちらも書いていなければ、末尾に ` {STYLE}` を自動で足します。言語について何も書かなくても、表示言語で答えます。どちらかを書いていれば何も足しません（言語の指定は作者に任せます）。決まった言語で答えさせたい定義はこれを使えます（例: `"Translate the selected text into French. Write any note on it in {ANSWER_LANGUAGE}."`）
- **subagent の `task`**: プレースホルダは置き換えますが、何も足しません。回答言語の指定は `prompt`（サブエージェントのシステムプロンプト）の側に入ります
- **fork**: 標準のアクションと同じく、回答言語の指定は実行時に必ず足されます。prompt に書いた `{STYLE}` は二重にならないよう取り除き、`{ANSWER_LANGUAGE}` だけを置き換えます。そのため fork は決まった言語に固定できません

#### 不正な定義の扱い

次のような定義は、その定義だけを無視します。

- `id` がない・上の書式でない・標準アクションの ID や `close`・`hint` と重なる・先にあるカスタム定義の ID と重なる（先にある方を使う）
- 必須の項目がない・空（方式に応じた `model` / `task` を含む）、または値の形が正しくない（`label` に `ja` / `en` の片方しかない、`maxTokens` が範囲外、`tools` が空や配列でない など）
- `kind` が `complete` / `fork` / `subagent` 以外、`model` が `haiku` / `sonnet` / `opus` 以外
- `target` が `selection` / `context`（小文字）以外、または `target` が `context` なのに `kind` が `fork` 以外（例: `target は selection / context のいずれかにしてください（指定: foo）`、`target が context の定義は kind を fork にしてください（指定: complete）`）
- `tools` に上の 5 つ以外のツールがある。そのツールだけ外して動かすと作者の意図と違う動きになるため、定義ごと無視します

設定が JSON として読めないとき、または配列でないときは、カスタム定義をすべて無視します。settings.json では値を文字列（配列を引用符で囲み、中の引用符をエスケープしたもの）で書いてください。引用符で囲まない配列を書くと、Claude Code がプラグインを読み込みません。どの場合も標準のアクションはそのまま動きます。無視した定義と理由は次の方法で確認できます。

- **`/quick-actions` を実行する**（ID の有無は問わず、何も選択していなくてもよい。ID なしでは ⋯ ダイアログも開く）: 結果の末尾に、問題が 1 件 1 行で並びます（例: `#3 (review-pr): subagent で使えないツール Bash を指定しています（…）`）。番号は配列の中の位置で、1 から数えます。この方法はいつでも使えます
- セッションの開始時に、件数と 1 件目の問題をトーストで知らせます。セッション中に `/config` で変えた場合は、次のセッションまでトーストが出ないことがあります。`/quick-actions` で確認してください
- ペインが開いているときは、その先頭にも失敗の色で一覧が出ます

#### ツールについての注意

- `WebFetch` / `WebSearch` を許すと、サブエージェントは選択テキストや、`Read` / `Grep` / `Glob` で読んだ内容（リポジトリに限らず、Claude Code の権限設定で読めるファイルすべて）を外部のサイトへ送り得ます。自分の判断で送ることも、選択テキストに書かれた指示（プロンプトインジェクション。選択テキストは `<selected>…</selected>` で囲んでいるだけです）に誘導されて送ることもあります。信頼できるテキストに使うアクションに限って許し、それ以外は既定の読み取り専用ツールのままにしてください
- コマンドの実行やファイルの変更ができるツール（`Bash` / `Write` / `Edit` など）は、`customActions` では受け付けません

### ソースに追加する（開発者向け）

標準のアクションは `hooks/actions.ts` の `ACTIONS` 配列に定義を 1 件足すだけで増やせます。ヒント行・ペイン・実行部分（`hooks/register.tsx`）を変更する必要はありません。足したアクションはヒント行（よく使う順）と ⋯ ダイアログに並びます。

共通の項目:

| 項目 | 内容 |
| --- | --- |
| `id` | 設定に書く ID（小文字英数字とハイフン、一意。`close` は ✕ ボタン、`hint` はコマンドの引数が使うので使えない） |
| `icon` | ヒント行に出すアイコン（絵文字 1 文字） |
| `label` | ホバー時とペインの見出しに出す名前。`{ ja: '…', en: '…' }` で両方の言語を書く |
| `kind` | 実行方式: `complete` / `fork` / `subagent` |
| `prompt` | プロンプト（方式ごとの意味は下記） |
| `runningText` | 実行中にペインに出す文言。`{ ja, en }` で書く（省略時「考え中…」/「Thinking…」） |
| `target` | コンテキストアクションなら `'context'`（`fork` に限る）。選択アクションなら書かない |

#### complete

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

#### fork

`prompt` は選択テキストの後ろに続ける指示文です。モデルは会話のものを使います。回答言語の指定は実行時に自動で足されます。

```ts
{
  id: 'cause',
  icon: '❓',
  label: { ja: '原因は？', en: 'What caused this?' },
  kind: 'fork',
  prompt: 'Explain why this happened, given what we did earlier in this session.',
},
```

コンテキストアクションは `target: 'context'` を付けた fork で、`prompt` の前に選択テキストは付きません。組み込みのものは、`kind` と `target` を足す `hooks/actions.ts` のヘルパー `contextAction(...)` で書いています。

#### subagent

`prompt` はサブエージェントのシステムプロンプト、`task` は起動時の依頼文の先頭（その後ろに選択テキストが付きます）です。サブエージェントは `quick-actions:<id>` という型で登録され、メインの Claude には提示されません。

```ts
{
  id: 'config-origin',
  icon: '🔧',
  label: { ja: '設定の出どころ', en: 'Config origin' },
  kind: 'subagent',
  model: 'sonnet',                       // 必須
  task: 'Find where the following setting is defined in this repository.',
  prompt: sys('You find where a configuration value is defined. Search with Grep and Glob, read with Read; change nothing.'),
  description: { ja: '設定の定義箇所を探します（Quick Actions 専用）', en: 'Finds where a setting is defined (quick-actions only)' }, // 省略時はラベルから作る
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

`tests/actions.test.tsx` は、すべての定義について ID の一意性・必須項目と、全 ID をピン留めし `hintCount` を十分大きくしたときにヒント行に定義順で並び、押すと定義の方式どおりに実行されることを確かめます。定義を足したらこのテストを流してください。`tests/context.test.tsx` はコンテキストアクションについて、組み込みの 11 個、`[ ]` / `< >` の表示、選択の有無それぞれでの `/quick-actions hint` とそのヒント行の閉じ方、選択なしでの実行、2 種類を 1 本にした並びとどちらの種類のピン留め、選択なしの ⋯ ダイアログ、カスタムのコンテキストアクションを確かめます。`tests/custom.test.tsx` は `customActions` の設定について、定義の読み込みと検証（不正な定義はその定義だけ無視し、壊れた JSON なら全体を無視すること）、ヒント行での並び、各方式の押下とコマンドでの実行、回答言語、問題の伝え方（トースト・コマンドのすべての結果・ペイン）を確かめます。`tests/i18n.test.tsx` は言語の判定と、両方の言語での表示・回答言語の指定を確かめます。`tests/order.test.tsx` はヒント行の並び（ピン留め・使用回数の順・減衰・同点・初回の既定のセット・`hintCount`）と使用回数の記録を、`tests/picker.test.tsx` は ⋯ ダイアログ（並び・選んで実行・閉じる・キーボードがないときの案内とモバイルアプリでは出ないこと・モバイルアプリでのボタン表示・ダイアログ自身のキーに似たカスタム ID）と ID なしの `/quick-actions` を確かめます。

README は英語版（README.md）と日本語版（README.ja.md）の 2 つがあります。内容を変えるときは両方を更新してください。

## 今後の予定

- 「URL を開く」「コピー」のようにモデルを使わないアクション（4 つ目の実行方式が必要）
- カスタムアクションを 1 つの設定ではなく専用のファイル（例: `~/.claude/quick-actions.json`）から読み込む
- カスタムのサブエージェントで、コマンドの実行やファイルの変更ができるツールを使えるようにする（プロンプトインジェクションの影響範囲と権限確認の扱いを検討したうえで）

## ライセンス

MIT
