# Selection Actions

English | [日本語](README.ja.md)

A Claude Code plugin for the text you select in the conversation (the transcript). Select some text and icons appear on the hint line under the prompt; press one to run an action on the selection (translate it, explain it simply or in depth, summarize it, or find the evidence behind it) and read the result in a pane. The actions you use most come first, and you can pin your own to the front in settings; every action, shown on the hint line or not, can be picked from the ⋯ at its end. Labels, messages and answers come in English or Japanese (by default, following Claude Code's language setting and the locale).

## How it works

1. Select text in the transcript with the mouse
2. Icons appear on the hint line under the prompt. Hover over an icon to see its label
   - The first six are shown (change it with [`hintCount`](#hintcount)), then ✕ and ⋯. The first time, that is 💡 🌐 📝 🔎 🔤 🧸 ✕ ⋯
   - The order: the actions pinned in the `actions` setting first, then the rest in the order you use them. Each use is counted, and what you used most lately comes first (see [Usage counts](#usage-counts))
   - The order is settled when a session starts, and does not move during it, so an icon stays where you reach for it
   - Pressing an action's icon or ✕ hides the icons for that selection (selecting other text brings them back)
   - Claude Code keeps the last selection after a click elsewhere takes its highlight down, so that a press can still read it (until you select something else or your next prompt or command has run). Clicking away without pressing an icon therefore leaves the icons in place: press ✕ to close them
   - Once Claude Code reports no selection (after your next prompt or command, for example), the icons go within about 0.3 seconds
3. Press an icon and the result is added at the top of the "Selection Actions" pane. If you had scrolled the pane down, running an action brings it back to the top (the newest result)
   - In fullscreen with a terminal at least 110 columns wide the pane docks on the right; narrower, it shows above the prompt
4. An action not on the hint line is under the ⋯ at its end: it opens a dialog (so does `/selection-actions` without an ID)
   - Every action, built-in and valid custom ones, is listed in the hint line's order, as icon and label
   - ↑ / ↓ move, Enter runs, Esc closes it running nothing. A click picks too, and the Close button closes it
   - The action picked runs on the text that was selected when the dialog opened, and its result shows in the "Selection Actions" pane
   - While the prompt holds text you are typing, the dialog does not get the keyboard (it says so): click your pick, or clear the prompt and open it again

The selected text itself is not shown on the hint line (so a multi-line selection does not make the line two rows tall).

### What is sent, and when

- The selected text is sent through Claude Code to the model (the one the session uses, such as the Anthropic API) only when you press an icon or an action in the ⋯ dialog, or run `/selection-actions <id>`. Selecting alone, or opening the ⋯ dialog, sends nothing
- `fork` actions (💬 Ask Claude and 🧾 Why so?) pass the current conversation to the model along with the selection
- Only when the display language is detected (`language` is `auto`), the plugin reads Claude Code's `language` setting and the environment variables `LC_ALL`, `LC_MESSAGES` and `LANG`. The values are used to pick the language and nothing else; they are not sent anywhere
- The selection is passed as the text to work on, not as instructions, but if you select untrusted text (a web page, tool output) the answer can be steered by instructions inside it. The `fork` actions, 💬 Ask Claude and 🧾 Why so?, are the most exposed, since they read the selection together with the conversation (🧾 Why so? takes it as something Claude said and reasons about it in that context). None of the standard actions can write files or run commands: of the two subagents, 🔎 Find the code has read-only tools (Read / Grep / Glob) and 📚 Check on the web has `WebSearch` / `WebFetch` alone
- 📚 Check on the web (`web-check`) sends the selection outside: words from it go to a web search service as queries, and it fetches pages at URLs written in the selection or turned up by the search. It has no tool that reads files, so nothing from the repository is put into those queries or URLs: the queries come from the selection, and the pages fetched are ones the selection names or the search found (its prompt also tells it to build queries from the selection alone and fetch only such URLs, though that part rests on the model following it). The pages it fetches can carry instructions of their own (prompt injection) that steer its answer, or what it searches and fetches next. Since it cannot change files or run commands, the effect stays within the answer in the pane. It sends only when you press 📚 on the hint line or in the ⋯ dialog, or run `/selection-actions web-check`. It is not in the first-time order, but the ⋯ dialog always lists it, and once used it may show on the hint line in the order of use (no setting takes it out of the order). Whether it can search or fetch at all also depends on your Claude Code permissions for `WebSearch` / `WebFetch`
- Actions you add in [`customActions`](#customactions) send the selection the same way. A custom subagent you allow `WebFetch` / `WebSearch` can send the selection, and the files it read (inside the repository or out), to outside sites (instructions hidden in the selection can steer it to). Tools that run commands or change files (`Bash`, `Write`, `Edit` and the like) are not accepted (see [Adding an action from the settings](#from-the-settings-customactions))

### Usage counts

- For the hint line's order, the plugin keeps a usage score per action in the local store Claude Code gives the plugin (`$.store`, a file in Claude Code's configuration directory). It is not sent anywhere
- Only each action ID's score and the time it was last used are kept, never the selected text or a result
- A use adds 1 to the score, and a score halves every 30 days, so actions you used a lot long ago do not stay in front for good
- The score of a custom action you removed does not affect the order (it is kept for when the definition comes back). There is no screen to reset or view the counts

## Install

At the prompt of a Claude Code terminal session, run the following (replace `<owner>/<repo>` with the GitHub `owner/repository` that publishes this repository).

```
/plugin install selection-actions --marketplace <owner>/<repo>
```

1. Answer `y` to `Add marketplace?`
2. When the plugin's details show, choose a scope (the user scope enables it in every later session)
3. On the settings screen, set `actions` (the actions to pin to the front; leave it empty for the order of use), `hintCount` (how many the hint line shows; default 6) and `language` (default `auto`). `customActions` (your own actions) can stay empty
4. Once `Installed selection-actions. Plugin is now active.` shows, it works in that session right away

### Try it from a working folder

```sh
claude --plugin-dir /path/to/selection-actions
```

## Settings (userConfig)

### `actions`

The IDs of the actions to pin to the front of the hint line, comma-separated, in the order you want them. The actions you leave out follow them in the order you use them, and can be picked from the ⋯ dialog too.

In `/config`, under `selection-actions`, enter for example the following in `actions`.

```
explain,translate,summarize,ask
```

From the command line:

```sh
echo '{"actions":"explain,translate,summarize,ask"}' | claude plugin configure selection-actions@selection-actions --values-stdin
```

Directly in `settings.json` (the key is `<plugin name>@<marketplace name>`, or `selection-actions` when loaded with `--plugin-dir`):

```json
{
  "pluginConfigs": {
    "selection-actions@selection-actions": {
      "options": { "actions": "explain,translate,summarize,ask" }
    }
  }
}
```

- **Unset or empty**: nothing is pinned; every action is in the order of use. The first time, with no use yet, the default set `explain,translate,summarize,code` (💡 🌐 📝 🔎, one action per purpose) leads, and the rest follow in definition order (the order of the [actions table](#actions-1))
  - Actions used equally, or not yet, keep the definition order. So once you use any action, the default set no longer leads: what you used comes first, then the rest in definition order (🌐 🔤 💡 🧸 …). To keep the default set in front, write it in `actions`
- **Unknown IDs**: ignored (no error). If no valid ID is left, nothing is pinned (as when empty)
- **Your own actions**: the IDs of the valid definitions in [`customActions`](#customactions) can be written here like the built-ins'
- **Removed IDs**: the built-ins were narrowed down (see [Actions](#actions-1) for the current ones). The IDs taken out — `command`, `error`, `regex`, `code-explain`, `review`, `stacktrace`, `log`, `security`, `test-ideas`, `glossary`, `simplify`, `proofread`, `structure`, `naming`, `usages`, `docs`, `next-step`, `send` — are ignored like unknown IDs if your `actions` setting still names them (they are simply no longer pinned; if no valid ID is left, nothing is pinned)
- Surrounding spaces and letter case are ignored; an ID written twice is used once, at its first place
- When more are pinned than [`hintCount`](#hintcount), the hint line shows the first `hintCount` of them; the rest are under ⋯

### `hintCount`

How many actions the hint line shows (default `6`); the rest are under the ⋯ at its end. Write a whole number of 1 or more: empty, `0`, a negative number, a fraction or anything not a number counts as the default 6. Keep it to what fits the hint line on one row.

```sh
echo '{"hintCount":"8"}' | claude plugin configure selection-actions@selection-actions --values-stdin
```

```json
{
  "pluginConfigs": {
    "selection-actions@selection-actions": {
      "options": { "actions": "explain,translate", "hintCount": "8" }
    }
  }
}
```

Like the other settings, a change in `/config` takes effect at once; after `claude plugin configure` or an edit to settings.json, restart Claude Code.

### `language`

The language of the hint line's labels, the pane, the command's messages and the toasts, and the language each action answers in.

| Value | Behaviour |
| --- | --- |
| `auto` (default) | Looks at Claude Code's `language` setting, then `LC_ALL`, `LC_MESSAGES`, `LANG`: Japanese if Japanese is detected, English otherwise or when nothing is found |
| `ja` | Japanese |
| `en` | English |

- When Claude Code's `language` setting is set (e.g. `"japanese"`, `"日本語"`, `"ja"`), it decides on its own (the locale is not consulted). Any language other than Japanese gives English
- From the locale, the first variable with a value is used; one starting with `ja` (`ja`, `ja_JP.UTF-8`) gives Japanese (`C`, `POSIX`, `en_US.UTF-8` and the like give English)
- Unknown or empty values count as `auto`
- The translation actions keep their target language: `translate` always translates into Japanese, `translate-en` always into English. Only their labels follow the display language ("To Japanese" and "To English" in English)
- The pane's title, "Selection Actions", is the product name and stays the same in both languages

From the command line or in settings.json:

```sh
echo '{"language":"en"}' | claude plugin configure selection-actions@selection-actions --values-stdin
```

```json
{
  "pluginConfigs": {
    "selection-actions@selection-actions": {
      "options": { "actions": "explain,translate,summarize,ask", "language": "en" }
    }
  }
}
```

A change made in `/config` reloads the plugin and takes effect at once (after `claude plugin configure` or an edit to settings.json, restart Claude Code). `auto` detects once per load of the plugin, so a change to Claude Code's language setting or to the locale while it runs takes effect on the next reload or restart.

### `customActions`

Your own actions, as a JSON array of definitions written as one string (empty by default). The fields and examples are in [Adding an action from the settings](#from-the-settings-customactions). A valid definition joins the hint line (in the order of use) and the ⋯ dialog like a built-in; put its ID in `actions` to pin it to the front. `/selection-actions <id>` runs it too.

In `/config`, under `selection-actions`, enter the array on one line in `customActions`, for example:

```
[{"id":"pirate","icon":"🦜","label":{"ja":"海賊風に言い換え","en":"Pirate talk"},"kind":"complete","model":"haiku","prompt":"Retell the selected text the way a pirate would."}]
```

From the command line (the value is a string, so the quotes inside it are escaped):

```sh
claude plugin configure selection-actions@selection-actions --values-stdin <<'EOF'
{"actions":"explain,pirate","customActions":"[{\"id\":\"pirate\",\"icon\":\"🦜\",\"label\":{\"ja\":\"海賊風に言い換え\",\"en\":\"Pirate talk\"},\"kind\":\"complete\",\"model\":\"haiku\",\"prompt\":\"Retell the selected text the way a pirate would.\"}]"}
EOF
```

Directly in `settings.json`, escaped the same way:

```json
{
  "pluginConfigs": {
    "selection-actions@selection-actions": {
      "options": {
        "actions": "explain,pirate",
        "customActions": "[{\"id\":\"pirate\",\"icon\":\"🦜\",\"label\":{\"ja\":\"海賊風に言い換え\",\"en\":\"Pirate talk\"},\"kind\":\"complete\",\"model\":\"haiku\",\"prompt\":\"Retell the selected text the way a pirate would.\"}]"
      }
    }
  }
}
```

It is read again whenever the plugin reloads, like `actions` and `language`: a change in `/config` takes effect at once; after `claude plugin configure` or an edit to settings.json, restart Claude Code. Run `/selection-actions` after a change to see whether any definition was ignored, and why.

## Command

```
/selection-actions [action-id]
```

Runs an action on the selected text and shows the result in the pane. Without an ID it opens the same dialog as the hint line's ⋯, and the action picked there runs on the text that was selected when the command ran (with nothing selected, it says so and opens no dialog). An action that is not on the hint line can still be run by its ID, your own included. An unknown ID runs nothing and lists the IDs that exist; the ID of a `customActions` definition that was ignored runs nothing and says why.

When `customActions` has problems, every result of the command (with or without an ID, with nothing selected too) ends with the list of the definitions ignored and why.

## Actions

Kinds:

- **complete**: one model call on the selection (the conversation is not used)
- **fork**: answered in a branch of the current conversation, so the answer knows what you are working on
- **subagent**: a subagent of its own looks things up and answers. 🔎 Find the code searches the repository with read-only tools (Read / Grep / Glob); 📚 Check on the web searches and reads the web with `WebSearch` / `WebFetch` alone. The main Claude is not offered them

The built-ins cover four purposes: translation, meaning, summary and evidence.

| # | Purpose | ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Translation | `translate` | 🌐 | To Japanese | Translates into Japanese | complete | haiku |
| 2 | Translation | `translate-en` | 🔤 | To English | Translates into English | complete | haiku |
| 3 | Meaning | `explain` | 💡 | Explain | What it means, why it likely appeared, what to do about it | complete | sonnet |
| 4 | Meaning | `eli5` | 🧸 | Explain simply | Explains it to someone with no background, with an everyday analogy | complete | haiku |
| 5 | Meaning | `deep-dive` | 🔬 | Deep dive | Goes into how it works, the background and why it is so | complete | sonnet |
| 6 | Meaning | `ask` | 💬 | Ask Claude | Explains it in the context of the current work | fork | the conversation's |
| 7 | Summary | `summarize` | 📝 | Summarize | A few sentences or up to five bullet points | complete | haiku |
| 8 | Summary | `tldr` | ⚡ | TL;DR | One line | complete | haiku |
| 9 | Evidence | `code` | 🔎 | Find the code | Finds where the text or behaviour comes from in the repository | subagent | sonnet |
| 10 | Evidence | `why` | 🧾 | Why so? | Explains the grounds for something Claude said in the conversation | fork | the conversation's |
| 11 | Evidence | `web-check` | 📚 | Check on the web | Checks the claims in the text against web sources, with their URLs: what they support apart from what they do not support or contradict | subagent | sonnet |

The labels above are the English ones (see [README.ja.md](README.ja.md) for the Japanese). Answers come in the language chosen with `language`, except the translations of `translate` / `translate-en`. Other uses (reviewing code, reading logs and so on) are left to actions you add yourself.

## Adding an action

There are two ways: in the settings (`customActions`), which needs no change to the plugin, or in the source, for developers of the plugin. Either way the hint line, the ⋯ dialog, the pane and the command treat the action like a built-in: it joins the hint line (in the order of use) and the ⋯ dialog, and putting its ID in `actions` pins it to the front.

### From the settings (customActions)

Write the definitions as a JSON array in the [`customActions`](#customactions) setting. The examples below are spread over several lines to read; in `/config`, enter the array on one line.

| Field | Required | Kinds | Meaning |
| --- | --- | --- | --- |
| `id` | yes | all | The ID written in `actions` and the command: lowercase letters and digits, joined by single hyphens (`review-pr`). Not a built-in's ID, not `close` (the ✕ button), and not one an earlier custom definition already took |
| `icon` | yes | all | The icon on the hint line (one emoji) |
| `label` | yes | all | The name shown on hover and as the pane heading: one string for both languages, or `{ "ja": "…", "en": "…" }` |
| `kind` | yes | all | How it runs: `complete` / `fork` / `subagent` (as for the built-ins, see [Actions](#actions)) |
| `prompt` | yes | all | complete: the system prompt; fork: the instruction that follows the selection; subagent: its system prompt |
| `runningText` | no | all | What the pane shows while it runs, as `label` is written (default "Thinking…" / "考え中…") |
| `model` | complete and subagent | complete, subagent | `haiku`, `sonnet` or `opus` only, lowercase. A fork uses the conversation's model and ignores it |
| `maxTokens` | no | complete | The longest answer, a whole number from 1 to 32000 (default 1500) |
| `task` | subagent | subagent | What opens the request the subagent is spawned with; the selection follows it |
| `description` | no | subagent | What the subagent type says it is for, as `label` is written (default: built from the label) |
| `tools` | no | subagent | Picked from `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch` (names as written here). Default: `["Read", "Grep", "Glob"]`. A definition naming any other tool is ignored as a whole |

Fields the kind does not use (`tools` on a complete action, for example) and unknown fields are ignored.

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

subagent (with the read-only tools, the default, written out; adding `WebSearch` / `WebFetch` to `tools` lets it look things up on the web too, but read the warning below first):

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

The setting holds the array of them: `[{ …pirate… }, { …cause… }, { …review-pr… }]`.

#### The answer language

Write `{STYLE}` and `{ANSWER_LANGUAGE}` in a prompt literally; at run time `{STYLE}` becomes the answer language and the pane's style (`Answer in English, …` / `Answer in Japanese, …`) and `{ANSWER_LANGUAGE}` the language's name (`English` / `Japanese`), following `language`.

- **complete and subagent**: when `prompt` has neither, ` {STYLE}` is added at its end, so the answer follows the display language even if you say nothing about it. When it has either, nothing is added: you decide. A definition that must answer in a fixed language can use that, e.g. `"Translate the selected text into French. Write any note on it in {ANSWER_LANGUAGE}."`
- **subagent's `task`**: the placeholders are filled in there too, but nothing is added to it: the answer language goes in through `prompt` (the subagent's system prompt)
- **fork**: the answer language is always added when it runs, as for the built-ins. A `{STYLE}` in its prompt is dropped (it would say it twice) and only `{ANSWER_LANGUAGE}` is filled in, so a fork cannot be held to a fixed language

#### Invalid definitions

A definition is ignored, alone, when:

- its `id` is missing or not in the format above, is a built-in's ID or `close`, or was taken by an earlier custom definition (the first one keeps it)
- a required field is missing or empty (`model` and `task` as its kind needs them), or a value is of the wrong shape (`label` with only one of `ja` / `en`, `maxTokens` out of range, `tools` empty or not an array)
- `kind` is not `complete` / `fork` / `subagent`, or `model` is not `haiku` / `sonnet` / `opus`
- `tools` names a tool outside the five above: the whole definition is ignored rather than run without it, since that would run something other than what you wrote

When the setting is not valid JSON, or not an array, every custom definition is ignored. In settings.json the value must be a string (the array in quotes, its quotes escaped): Claude Code does not load the plugin with an unquoted array there. The built-ins work as before in every case. To see what was ignored and why:

- **Run `/selection-actions`** (with or without an ID; nothing need be selected; without an ID it also opens the ⋯ dialog): the result ends with every problem, one per line, such as `#3 (review-pr): tools a subagent cannot have: Bash (…)`. The number is the definition's place in the array, from 1. This always works
- A toast at the start of a session gives the count and the first problem. A change made in `/config` during a session may not show the toast again until the next one: run `/selection-actions` to check
- While the pane is open, the list also shows at its top, in the error colour

#### A word on the tools

- With `WebFetch` / `WebSearch` allowed, the subagent can send the selected text, and whatever it read with `Read` / `Grep` / `Glob` (any file Claude Code's permissions let it read, not only the repository's), to outside sites: on its own, or steered by instructions written in the selection (prompt injection; the selection is only wrapped in `<selected>…</selected>`). Allow them only for actions you will run on text you trust, and keep the default read-only tools otherwise
- Tools that run commands or change files (`Bash`, `Write`, `Edit` and the like) are not accepted in `customActions`

### In the source (for developers)

A built-in is one more definition in the `ACTIONS` array of `hooks/actions.ts`. The hint line, the pane and the runner (`hooks/register.tsx`) need no change. The action added joins the hint line (in the order of use) and the ⋯ dialog.

Common fields:

| Field | Meaning |
| --- | --- |
| `id` | The ID written in the setting (lowercase letters, digits and hyphens; unique; not `close`, which the ✕ button uses) |
| `icon` | The icon on the hint line (one emoji) |
| `label` | The name shown on hover and as the pane heading, in both languages: `{ ja: '…', en: '…' }` |
| `kind` | How it runs: `complete` / `fork` / `subagent` |
| `prompt` | The prompt (its role depends on the kind, below) |
| `runningText` | What the pane shows while it runs, as `{ ja, en }` (default "考え中…" / "Thinking…") |

#### complete

`prompt` is the system prompt; the selection is the user's input.

```ts
{
  id: 'haiku-poem',
  icon: '🎋',
  label: { ja: '俳句にする', en: 'Haiku' },
  kind: 'complete',
  model: 'haiku',          // required
  maxTokens: 500,          // default 1500
  prompt: sys('Turn the selected text into a Japanese haiku.'),
},
```

`sys(...)` joins the sentences and ends them with the answer language and the pane's style (`STYLE`). At run time `STYLE` becomes `Answer in English, …` or `Answer in Japanese, …` to match the display language. Where a prompt needs the answer language's name mid-sentence, use `ANSWER_LANGUAGE` (it becomes `English` or `Japanese`), e.g. `` `Explain the changes in ${ANSWER_LANGUAGE}.` ``.

#### fork

`prompt` is the instruction that follows the selection. The conversation's model answers. The answer language is added at run time.

```ts
{
  id: 'cause',
  icon: '❓',
  label: { ja: '原因は？', en: 'What caused this?' },
  kind: 'fork',
  prompt: 'Explain why this happened, given what we did earlier in this session.',
},
```

#### subagent

`prompt` is the subagent's system prompt, and `task` opens the request it is spawned with (the selection follows it). The subagent is registered as the type `selection-actions:<id>`, and the main Claude is not offered it.

```ts
{
  id: 'config-origin',
  icon: '🔧',
  label: { ja: '設定の出どころ', en: 'Config origin' },
  kind: 'subagent',
  model: 'sonnet',                       // required
  task: 'Find where the following setting is defined in this repository.',
  prompt: sys('You find where a configuration value is defined. Search with Grep and Glob, read with Read; change nothing.'),
  description: { ja: '設定の定義箇所を探します（selection-actions 専用）', en: 'Finds where a setting is defined (selection-actions only)' }, // default: built from the label
  tools: ['Read', 'Grep', 'Glob'],       // default: these three read-only tools
  runningText: { ja: '設定を調査中…', en: 'Searching the config…' },
},
```

A word on widening `tools`: the selection is only wrapped in `<selected>…</selected>`, which cannot fully stop instructions written in it (prompt injection). With the default read-only tools the effect stays within the pane's answer, but before giving a subagent `Bash`, `Write`, `Edit` or the like, guard against it (for instance by stating in the prompt that the text inside the tags is data, not instructions) and check what it could reach.

### Tests

```sh
claude plugin validate .
claude plugin test .
```

`tests/actions.test.tsx` checks every definition (unique IDs, required fields in both languages) and that, with every ID pinned and `hintCount` large enough, the hint line shows them in definition order and each runs as its kind says. Run it after adding a definition. `tests/custom.test.tsx` checks the `customActions` setting: reading and checking the definitions (each kind of invalid one left out alone, broken JSON leaving them all out), their place on the hint line, each kind run by a press and by the command, the answer language, and how the problems are told (the toast, every result of the command, the pane). `tests/i18n.test.tsx` checks the language detection and the display and answer language in both languages. `tests/order.test.tsx` checks the hint line's order (pins, the order of use, the decay, ties, the default set the first time, `hintCount`) and that each use is recorded; `tests/picker.test.tsx` checks the ⋯ dialog (its list, a pick running, closing it, the notice without the keyboard) and `/selection-actions` without an ID.

The README comes in English (README.md) and Japanese (README.ja.md). Update both when changing either.

## Roadmap

- Actions that need no model, such as "open the URL" or "copy" (a fourth kind)
- Reading custom actions from a file of their own (such as `~/.claude/selection-actions.json`) rather than one setting
- Letting custom subagents use tools that run commands or change files, once their exposure to prompt injection and the permission prompts are worked out

## License

MIT
