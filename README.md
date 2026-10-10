# Selection Actions

English | [日本語](README.ja.md)

A Claude Code plugin for the text you select in the conversation (the transcript). Select some text and icons appear on the hint line under the prompt; press one to run an action on the selection (explain it, translate it, summarize it, find the code behind it and more) and read the result in a pane. You choose which actions are shown, and in what order, in settings. Labels, messages and answers come in English or Japanese (by default, following Claude Code's language setting and the locale).

## How it works

1. Select text in the transcript with the mouse
2. Icons appear on the hint line under the prompt (by default 💡 🌐 🔎 💬 ✕). Hover over an icon to see its label
   - Pressing an action's icon or ✕ hides the icons for that selection (selecting other text brings them back)
   - Claude Code keeps the last selection after a click elsewhere takes its highlight down, so that a press can still read it (until you select something else or your next prompt or command has run). Clicking away without pressing an icon therefore leaves the icons in place: press ✕ to close them
   - Once Claude Code reports no selection (after your next prompt or command, for example), the icons go within about 0.3 seconds
3. Press an icon and the result is added at the top of the "Selection Actions" pane. If you had scrolled the pane down, running an action brings it back to the top (the newest result)
   - In fullscreen with a terminal at least 110 columns wide the pane docks on the right; narrower, it shows above the prompt
   - While the hint line has focus, the keys 1 to 9 and 0 press the icons in order (the first ten)

The selected text itself is not shown on the hint line (so a multi-line selection does not make the line two rows tall).

### What is sent, and when

- The selected text is sent through Claude Code to the model (the one the session uses, such as the Anthropic API) only when you press an icon or run `/selection-actions`. Selecting alone sends nothing
- `fork` actions (such as 💬 Ask Claude) pass the current conversation to the model along with the selection
- Only when the display language is detected (`language` is `auto`), the plugin reads Claude Code's `language` setting and the environment variables `LC_ALL`, `LC_MESSAGES` and `LANG`. The values are used to pick the language and nothing else; they are not sent anywhere
- The selection is passed as the text to work on, not as instructions, but if you select untrusted text (a web page, tool output) the answer can be steered by instructions inside it (📨 Send to Claude in particular treats the selection as your question). None of the standard actions can write files or run commands (the subagents have read-only tools)

## Install

At the prompt of a Claude Code terminal session, run the following (replace `<owner>/<repo>` with the GitHub `owner/repository` that publishes this repository).

```
/plugin install selection-actions --marketplace <owner>/<repo>
```

1. Answer `y` to `Add marketplace?`
2. When the plugin's details show, choose a scope (the user scope enables it in every later session)
3. On the settings screen, set `actions` (leave it empty for the default set) and `language` (default `auto`)
4. Once `Installed selection-actions. Plugin is now active.` shows, it works in that session right away

### Try it from a working folder

```sh
claude --plugin-dir /path/to/selection-actions
```

## Settings (userConfig)

### `actions`

The IDs of the actions to show on the hint line, comma-separated, in the order you want them.

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

- **Unset or empty**: the default set `explain,translate,code,ask` (💡 🌐 🔎 💬) is shown
- **Unknown IDs**: ignored (no error). If no valid ID is left, the default set is shown
- Surrounding spaces and letter case are ignored; an ID written twice is used once, at its first place
- To keep the line on one row, eight to ten actions at most is a good limit

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

## Command

```
/selection-actions [action-id]
```

Runs an action on the selected text and shows the result in the pane. Without an ID it runs the first action on the hint line (💡 Explain by default). An action that is not on the hint line can still be run by its ID. An unknown ID runs nothing and lists the IDs that exist.

## Actions

Kinds:

- **complete**: one model call on the selection (the conversation is not used)
- **fork**: answered in a branch of the current conversation, so the answer knows what you are working on
- **subagent**: a read-only (Read / Grep / Glob) subagent searches the repository and answers. The main Claude is not offered it

| # | ID | Icon | Label | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| 1 | `explain` | 💡 | Explain | complete | sonnet |
| 2 | `translate` | 🌐 | To Japanese | complete | haiku |
| 3 | `code` | 🔎 | Find the code | subagent | sonnet |
| 4 | `ask` | 💬 | Ask Claude | fork | the conversation's |
| 5 | `summarize` | 📝 | Summarize | complete | haiku |
| 6 | `translate-en` | 🔤 | To English | complete | haiku |
| 7 | `command` | 💻 | Explain command | complete | sonnet |
| 8 | `error` | 🩹 | Fix the error | complete | sonnet |
| 9 | `regex` | 🧩 | Explain regex | complete | sonnet |
| 10 | `code-explain` | 📖 | Explain code | complete | sonnet |
| 11 | `review` | 🧐 | Code review | complete | sonnet |
| 12 | `stacktrace` | 🧵 | Stack trace | complete | sonnet |
| 13 | `log` | 📜 | Read logs | complete | sonnet |
| 14 | `security` | 🔒 | Security check | complete | sonnet |
| 15 | `test-ideas` | 🧪 | Test ideas | complete | sonnet |
| 16 | `glossary` | 📚 | Glossary | complete | haiku |
| 17 | `simplify` | 🌱 | Simplify | complete | haiku |
| 18 | `proofread` | ✅ | Proofread | complete | haiku |
| 19 | `structure` | 🧱 | Data structure | complete | haiku |
| 20 | `naming` | 🔖 | Name ideas | complete | haiku |
| 21 | `usages` | 🧭 | Find usages | subagent | sonnet |
| 22 | `docs` | 📄 | Find docs | subagent | haiku |
| 23 | `next-step` | 👉 | Next step | fork | the conversation's |
| 24 | `send` | 📨 | Send to Claude | fork | the conversation's |

The labels above are the English ones (see [README.ja.md](README.ja.md) for the Japanese). Answers come in the language chosen with `language`, except the translations of `translate` / `translate-en` and the corrected text of `proofread`.

## Adding an action

An action is one more definition in the `ACTIONS` array of `hooks/actions.ts`. The hint line, the pane and the runner (`hooks/register.tsx`) need no change. Put its ID in the `actions` setting to show it.

Common fields:

| Field | Meaning |
| --- | --- |
| `id` | The ID written in the setting (lowercase letters, digits and hyphens; unique; not `close`, which the ✕ button uses) |
| `icon` | The icon on the hint line (one emoji) |
| `label` | The name shown on hover and as the pane heading, in both languages: `{ ja: '…', en: '…' }` |
| `kind` | How it runs: `complete` / `fork` / `subagent` |
| `prompt` | The prompt (its role depends on the kind, below) |
| `runningText` | What the pane shows while it runs, as `{ ja, en }` (default "考え中…" / "Thinking…") |

### complete

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

### fork

`prompt` is the instruction that follows the selection. The conversation's model answers. The answer language is added at run time.

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

`tests/actions.test.tsx` checks every definition (unique IDs, required fields in both languages) and that, with every ID in the setting, the hint line shows them in definition order and each runs as its kind says. Run it after adding a definition. `tests/i18n.test.tsx` checks the language detection and the display and answer language in both languages.

The README comes in English (README.md) and Japanese (README.ja.md). Update both when changing either.

## Roadmap

- Actions that need no model, such as "open the URL" or "copy" (a fourth kind)
- Letting users add actions with their own prompts from the settings

## License

MIT
