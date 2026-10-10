# Quick Actions

English | [日本語](README.ja.md)

A Claude Code plugin of icon actions for the text you select in the conversation (the transcript) and for the conversation itself. Select some text and icons appear on the hint line under the prompt; press one to run an action on the selection (translate it, explain it simply or in depth, summarize it, or find the evidence behind it) or on the conversation (recap it, list the decisions so far, the next steps, a handoff note and more) and read the result in a pane. With nothing selected, `/quick-actions hint` brings up the hint line with the actions on the conversation. The actions you use most come first, and you can pin your own to the front in settings; every action, shown on the hint line or not, can be picked from the ⋯ at its end (from its list, or by typing in its filter). Labels, messages and answers come in English or Japanese (by default, following Claude Code's language setting and the locale).

## How it works

There are two kinds of action, mixed in one row:

- **Actions on the selection**, shown as `[icon]`: they run on the text you selected (the [first table of actions](#actions-1))
- **Context actions**, shown as `<icon>`: they run on the current conversation itself, with no selected text, in a branch (fork) of it (the [second table](#context-actions)). Their icons can be the same as some actions on the selection (🧸, 🌐, 📝); the `[ ]` or `< >` tells them apart

1. Select text in the transcript with the mouse (or, with nothing selected, run [`/quick-actions hint`](#opening-the-hint-line-without-a-selection-quick-actions-hint))
2. Icons appear on the hint line under the prompt, both kinds mixed. Hover over an icon to see its label
   - The first six are shown (change it with [`hintCount`](#hintcount)), then ✕ and ⋯. The first time, that is `[💡] <🧭> [🌐] <✅> [📝] [🔎] ✕ ⋯`
   - The order: the actions pinned in the `actions` setting first, then the rest in the order you use them, both kinds in one order. Each use is counted, and what you used most lately comes first (see [Usage counts](#usage-counts))
   - The order is settled when a session starts, and does not move during it, so an icon stays where you reach for it
   - Pressing an action's icon (of either kind) or ✕ hides the icons for that selection (selecting other text brings them back)
   - Claude Code keeps the last selection after a click elsewhere takes its highlight down, so that a press can still read it (until you select something else or your next prompt or command has run). Clicking away without pressing an icon therefore leaves the icons in place: press ✕ to close them
   - Once Claude Code reports no selection (after your next prompt or command, for example), the icons go within about 0.3 seconds. This is for a hint line shown by a selection alone; one opened with `/quick-actions hint` closes as [described below](#opening-the-hint-line-without-a-selection-quick-actions-hint)
3. Press an icon and the result is added at the top of the "Quick Actions" pane. If you had scrolled the pane down, running an action brings it back to the top (the newest result)
   - In fullscreen with a terminal at least 110 columns wide the pane docks on the right; narrower, it shows above the prompt
4. An action not on the hint line is under the ⋯ at its end: it opens a dialog (so does `/quick-actions` without an ID)
   - The actions (built-in and valid custom ones) are listed in the hint line's order, as `[icon] label` or `<icon> label`. The list shows the first 64 of that order
   - When there are more, a line under the list says `N more: type in the filter to reach them`: type an ID or a name in the filter above the list to narrow it down, and pick one (Enter runs the first)
   - Which ones fall past the first 64 follows the order. With a selection, the actions on the selection come before the context actions, apart from your pins and, the first time, the [default set](#actions). So the context actions you have not pinned, the actions on the selection you use least (the first time, later ones such as `web-check`), and newly added custom actions on the selection (they follow the built-ins until used) are reached through the filter. The actions on the selection you use most, and the pinned ones of either kind, come first
   - In the mobile app, and with [`paneTheme`](#panetheme) set to `light` / `dark`, the dialog lists every action as buttons, with no such limit
   - Opened with nothing selected (`/quick-actions` without an ID, or the ⋯ of a hint line `/quick-actions hint` opened with nothing selected), it lists the context actions alone
   - ↑ / ↓ move, Enter runs, Esc closes it running nothing. A click picks too, and the Close button closes it
   - An action on the selection picked runs on the text that was selected when the dialog opened; a context action runs on the conversation. The result shows in the "Quick Actions" pane
   - While the prompt holds text you are typing, the dialog does not get the keyboard (it says so, except in the mobile app, where you tap your pick): click your pick, or clear the prompt and open it again (with ⋯, or with `/quick-actions`, which empties the prompt as it runs)

The selected text itself is not shown on the hint line (so a multi-line selection does not make the line two rows tall).

### Opening the hint line without a selection (`/quick-actions hint`)

Run `/quick-actions hint` to bring up the hint line whether or not text is selected:

- **Nothing selected**: the context actions alone, in the same order (`<🧭> <✅> <📋> <❓> <🧸> <🌐> ✕ ⋯` the first time)
- **Text selected**: both kinds, as when the selection shows them. Running the command makes Claude Code stop reporting that selection, so the plugin takes the selected text in as the command runs: the actions on the selection run on that text, even after its highlight is gone

It closes the way the hint line of a selection does:

- **✕**, or **running an action** from it (of either kind; from its ⋯ dialog too)
- **A selection made after it opened going away**: select text while it is open and both kinds show for that text; once Claude Code reports no selection again, it closes within about 0.3 seconds

The selection taken in when the command ran is not one of these: its going (which the command itself causes) closes nothing. The trade-off: a hint line opened with text selected stays, with its actions on the selection running on that text, after the text's highlight is gone, until you press ✕ or run an action (as the icons of a selection stay after a click elsewhere, above). Selecting exactly the same text again after it opened does not count as a new selection either, so its going does not close the line: press ✕.

### What is sent, and when

- The selected text is sent through Claude Code to the model (the one the session uses, such as the Anthropic API) only when you press an icon or an action in the ⋯ dialog, or run `/quick-actions <id>`. Selecting alone, opening the ⋯ dialog, or running `/quick-actions hint` sends nothing
- `fork` actions on the selection (💬 Ask Claude and 🧾 Why so?) pass the current conversation to the model along with the selection
- [Context actions](#context-actions) pass the current conversation (a fork of the session) to the model, and no selected text, when you press one or run `/quick-actions <id>` with its ID. Everything in the conversation so far (your prompts, Claude's answers, tool results and the file contents read into it) goes with it, as for the next turn of the session
- Only when the display language is detected (`language` is `auto`), the plugin reads Claude Code's `language` setting and the environment variables `LC_ALL`, `LC_MESSAGES` and `LANG`. The values are used to pick the language and nothing else; they are not sent anywhere
- The selection is passed as the text to work on, not as instructions, but if you select untrusted text (a web page, tool output) the answer can be steered by instructions inside it. The `fork` actions, 💬 Ask Claude and 🧾 Why so?, are the most exposed, since they read the selection together with the conversation (🧾 Why so? takes it as something Claude said and reasons about it in that context). None of the standard actions can write files or run commands: of the two subagents, 🔎 Find the code has read-only tools (Read / Grep / Glob) and 📚 Check on the web has `WebSearch` / `WebFetch` alone
- 📚 Check on the web (`web-check`) sends the selection outside: words from it go to a web search service as queries, and it fetches pages at URLs written in the selection or turned up by the search. It has no tool that reads files, so nothing from the repository is put into those queries or URLs: the queries come from the selection, and the pages fetched are ones the selection names or the search found (its prompt also tells it to build queries from the selection alone and fetch only such URLs, though that part rests on the model following it). The pages it fetches can carry instructions of their own (prompt injection) that steer its answer, or what it searches and fetches next. Since it cannot change files or run commands, the effect stays within the answer in the pane. It sends only when you press 📚 on the hint line or in the ⋯ dialog, or run `/quick-actions web-check`. It is not in the first-time order, but it can always be picked in the ⋯ dialog (type `web-check` in its filter while it is past the first 64 listed), and once used it may show on the hint line in the order of use (no setting takes it out of the order). Whether it can search or fetch at all also depends on your Claude Code permissions for `WebSearch` / `WebFetch`
- Actions you add in [`customActions`](#customactions) send the selection the same way. A custom subagent you allow `WebFetch` / `WebSearch` can send the selection, and the files it read (inside the repository or out), to outside sites (instructions hidden in the selection can steer it to). Tools that run commands or change files (`Bash`, `Write`, `Edit` and the like) are not accepted (see [Adding an action from the settings](#from-the-settings-customactions))

### Usage counts

- For the hint line's order, the plugin keeps a usage score per action in the local store Claude Code gives the plugin (`$.store`, a file in Claude Code's configuration directory). It is not sent anywhere
- Only each action ID's score and the time it was last used are kept, never the selected text or a result
- A use adds 1 to the score, and a score halves every 30 days, so actions you used a lot long ago do not stay in front for good
- The score of a custom action you removed does not affect the order (it is kept for when the definition comes back). There is no screen to reset or view the counts

## Install

At the prompt of a Claude Code terminal session, run the following (replace `<owner>/<repo>` with the GitHub `owner/repository` that publishes this repository).

```
/plugin install quick-actions --marketplace <owner>/<repo>
```

1. Answer `y` to `Add marketplace?`
2. When the plugin's details show, choose a scope (the user scope enables it in every later session)
3. On the settings screen, set `actions` (the actions to pin to the front; leave it empty for the order of use), `hintCount` (how many the hint line shows; default 6), `language` (default `auto`) and `paneTheme` (the pane's colours; default `auto`). `customActions` (your own actions) can stay empty
4. Once `Installed quick-actions. Plugin is now active.` shows, it works in that session right away

### Try it from a working folder

```sh
claude --plugin-dir /path/to/quick-actions
```

## Settings (userConfig)

### `actions`

The IDs of the actions to pin to the front of the hint line, comma-separated, in the order you want them. The actions you leave out follow them in the order you use them, and can be picked from the ⋯ dialog too.

In `/config`, under `quick-actions`, enter for example the following in `actions`.

```
explain,translate,summarize,ask
```

From the command line:

```sh
echo '{"actions":"explain,translate,summarize,ask"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

Directly in `settings.json` (the key is `<plugin name>@<marketplace name>`, or `quick-actions` when loaded with `--plugin-dir`):

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": { "actions": "explain,translate,summarize,ask" }
    }
  }
}
```

- **Unset or empty**: nothing is pinned; every action is in the order of use. The first time, with no use yet, the default set `explain,recap,translate,decisions,summarize,code` (`[💡] <🧭> [🌐] <✅> [📝] [🔎]`, the two kinds in turn) leads, and the rest follow in definition order (the [actions on the selection](#actions-1), then the [context actions](#context-actions))
  - Actions used equally, or not yet, keep the definition order. So once you use any action, the default set no longer leads: what you used comes first, then the rest in definition order (`[🌐] [🔤] [💡] [🧸] …`). To keep the default set in front, write it in `actions`
- **Either kind**: the IDs of context actions (`recap`, `handoff`, …) can be pinned like those of the actions on the selection, mixed in any order. With nothing selected, the hint line skips the actions on the selection and shows the pinned context actions first
- **Unknown IDs**: ignored (no error). If no valid ID is left, nothing is pinned (as when empty)
- **Your own actions**: the IDs of the valid definitions in [`customActions`](#customactions) can be written here like the built-ins'
- **Removed IDs**: the built-ins were narrowed down (see [Actions](#actions-1) for the current ones). The IDs taken out — `command`, `error`, `regex`, `code-explain`, `review`, `stacktrace`, `log`, `security`, `test-ideas`, `glossary`, `simplify`, `proofread`, `structure`, `naming`, `usages`, `docs`, `next-step`, `send` — are ignored like unknown IDs if your `actions` setting still names them (they are simply no longer pinned; if no valid ID is left, nothing is pinned)
- Surrounding spaces and letter case are ignored; an ID written twice is used once, at its first place
- When more are pinned than [`hintCount`](#hintcount), the hint line shows the first `hintCount` of them; the rest are under ⋯

### `hintCount`

How many actions the hint line shows (default `6`); the rest are under the ⋯ at its end. Write a whole number of 1 or more: empty, `0`, a negative number, a fraction or anything not a number counts as the default 6. Keep it to what fits the hint line on one row.

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
- The pane's title, "Quick Actions", is the product name and stays the same in both languages

From the command line or in settings.json:

```sh
echo '{"language":"en"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": { "actions": "explain,translate,summarize,ask", "language": "en" }
    }
  }
}
```

A change made in `/config` reloads the plugin and takes effect at once (after `claude plugin configure` or an edit to settings.json, restart Claude Code). `auto` detects once per load of the plugin, so a change to Claude Code's language setting or to the locale while it runs takes effect on the next reload or restart.

### `paneTheme`

The colours of the docked result pane (on the right) and the ⋯ dialog.

| Value | Behaviour |
| --- | --- |
| `auto` (default) | Follows Claude Code's theme, as before: core paints the background and the text is drawn in the theme's colours |
| `light` | A fixed light palette: its own background (`#fafafa`) and text colours, whatever the theme |
| `dark` | A fixed dark palette: its own background (`#1e1e1e`) and text colours, whatever the theme |

- Use `light` or `dark` when the terminal and the theme disagree (a dark terminal on the light theme, or the other way round), or to see the pane in the brightness you like
- Every text colour of both palettes (heading, body, failures and the secondary texts) has a contrast ratio of at least 4.5:1 against its background (WCAG AA), also when a 256-colour terminal (Terminal.app, for one) rounds them to its nearest colours. A 16-colour terminal draws a rougher approximation, which may lower it
- With `light` or `dark`, the ⋯ dialog lists the actions as buttons instead of a selection list, since a selection list cannot take the palette's colours. The buttons show every action (a selection list shows the first 64). Tab (or the arrow keys) moves between them and Enter runs one; the first has the focus when the dialog opens
- The inline pane (a terminal narrower than 110 columns) is not affected: it keeps the terminal's own colours whatever the setting
- Unknown or empty values count as `auto`
- Core may still paint a thin edge around the pane in the theme's colour, outside what the plugin draws

From the command line:

```sh
echo '{"paneTheme":"dark"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

Like the other settings, a change in `/config` takes effect at once; after `claude plugin configure` or an edit to settings.json, restart Claude Code.

### `customActions`

Your own actions, as a JSON array of definitions written as one string (empty by default). The fields and examples are in [Adding an action from the settings](#from-the-settings-customactions). A valid definition joins the hint line (in the order of use) and can be picked from the ⋯ dialog like a built-in (a newly added one comes after the built-ins, so while it is past the first 64 listed, type its ID or label in the filter); put its ID in `actions` to pin it to the front. `/quick-actions <id>` runs it too.

In `/config`, under `quick-actions`, enter the array on one line in `customActions`, for example:

```
[{"id":"pirate","icon":"🦜","label":{"ja":"海賊風に言い換え","en":"Pirate talk"},"kind":"complete","model":"haiku","prompt":"Retell the selected text the way a pirate would."}]
```

From the command line (the value is a string, so the quotes inside it are escaped):

```sh
claude plugin configure quick-actions@quick-actions --values-stdin <<'EOF'
{"actions":"explain,pirate","customActions":"[{\"id\":\"pirate\",\"icon\":\"🦜\",\"label\":{\"ja\":\"海賊風に言い換え\",\"en\":\"Pirate talk\"},\"kind\":\"complete\",\"model\":\"haiku\",\"prompt\":\"Retell the selected text the way a pirate would.\"}]"}
EOF
```

Directly in `settings.json`, escaped the same way:

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

It is read again whenever the plugin reloads, like `actions` and `language`: a change in `/config` takes effect at once; after `claude plugin configure` or an edit to settings.json, restart Claude Code. Run `/quick-actions` after a change to see whether any definition was ignored, and why.

## Command

```
/quick-actions [action-id | hint]
```

Runs an action and shows the result in the pane: an action on the selection runs on the selected text (with nothing selected, it says so and runs nothing); a context action runs on the conversation, selected text or not. Without an ID it opens the same dialog as the hint line's ⋯, and the action picked there runs on the text that was selected when the command ran (with nothing selected, the dialog lists the context actions alone). `/quick-actions hint` opens the hint line, with nothing selected too (see [above](#opening-the-hint-line-without-a-selection-quick-actions-hint)). An action that is not on the hint line can still be run by its ID, your own included. An unknown ID runs nothing and lists the IDs that exist; the ID of a `customActions` definition that was ignored runs nothing and says why.

When `customActions` has problems, every result of the command (with or without an ID, with nothing selected too) ends with the list of the definitions ignored and why.

## Actions

Kinds:

- **complete**: one model call on the selection (the conversation is not used)
- **fork**: answered in a branch of the current conversation, so the answer knows what you are working on. Every context action is a fork
- **subagent**: a subagent of its own looks things up and answers. 🔎 Find the code searches the repository with read-only tools (Read / Grep / Glob); 📚 Check on the web searches and reads the web with `WebSearch` / `WebFetch` alone. The main Claude is not offered them

The built-in actions on the selection cover four purposes: translation, meaning, summary and evidence.

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

### Context actions

They run on the current conversation, with no selected text, as a fork of the session (the conversation's model answers). Each is told to work from what the conversation shows and to say so rather than guess where it does not tell, and answers in about 10 to 15 lines.

| # | ID | Icon | Label | What it does |
| --- | --- | --- | --- | --- |
| 1 | `recap` | 🧭 | Recap | What the conversation set out to do, how it went and where things stand |
| 2 | `decisions` | ✅ | Decisions so far | The decisions made and points agreed on, as bullets |
| 3 | `todo` | 📋 | Next steps | The work left, as a to-do list in the order to do it |
| 4 | `open-questions` | ❓ | Open questions | The questions still unanswered and the points on hold |
| 5 | `simplify-last` | 🧸 | Last answer, simply | Claude's last answer restated for someone with no background |
| 6 | `translate-last` | 🌐 | Translate last answer | Claude's last answer translated: into English if it is mainly in Japanese, into Japanese otherwise (this target language comes before `language`) |
| 7 | `assumptions` | 🧱 | Assumptions | The premises and assumptions the work relies on, marking those not checked |
| 8 | `risks` | ⚠️ | Risks | The risks and concerns of the current approach and changes, most serious first |
| 9 | `changed-files` | 🗂 | Changed files | The files created, changed or deleted in the session and what changed, as far as the conversation shows |
| 10 | `next-questions` | 💭 | Questions to ask next | Three to five questions worth asking Claude next |
| 11 | `handoff` | 📝 | Handoff note | A note to hand the work to another person or session: goal, status, decisions, work left, caveats |

The pane heads their results with the icon and label, followed by "this conversation" where an action on the selection quotes the text.

## Adding an action

There are two ways: in the settings (`customActions`), which needs no change to the plugin, or in the source, for developers of the plugin. Either way the hint line, the ⋯ dialog, the pane and the command treat the action like a built-in: it joins the hint line (in the order of use) and can be picked from the ⋯ dialog (a newly added one comes after the built-ins, so while it is past the first 64 listed, type its ID or label in the filter), and putting its ID in `actions` pins it to the front.

### From the settings (customActions)

Write the definitions as a JSON array in the [`customActions`](#customactions) setting. The examples below are spread over several lines to read; in `/config`, enter the array on one line.

| Field | Required | Kinds | Meaning |
| --- | --- | --- | --- |
| `id` | yes | all | The ID written in `actions` and the command: lowercase letters and digits, joined by single hyphens (`review-pr`). Not a built-in's ID, not `close` (the ✕ button) or `hint` (the command's argument), and not one an earlier custom definition already took |
| `icon` | yes | all | The icon on the hint line (one emoji) |
| `label` | yes | all | The name shown on hover and as the pane heading: one string for both languages, or `{ "ja": "…", "en": "…" }` |
| `kind` | yes | all | How it runs: `complete` / `fork` / `subagent` (as for the built-ins, see [Actions](#actions)) |
| `target` | no | all | What it works on: `selection` (the default, also when empty) or `context` (the conversation, with no selected text; `kind` must then be `fork`). It is shown as `[icon]` or `<icon>` accordingly |
| `prompt` | yes | all | complete: the system prompt; fork: the instruction that follows the selection (with `target` `context`, the instruction alone); subagent: its system prompt |
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

A context action (a fork with `target` `context`: no selected text, shown as `<📣>`, and on the hint line `/quick-actions hint` opens with nothing selected):

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

The setting holds the array of them: `[{ …pirate… }, { …cause… }, { …standup… }, { …review-pr… }]`.

#### The answer language

Write `{STYLE}` and `{ANSWER_LANGUAGE}` in a prompt literally; at run time `{STYLE}` becomes the answer language and the pane's style (`Answer in English, …` / `Answer in Japanese, …`) and `{ANSWER_LANGUAGE}` the language's name (`English` / `Japanese`), following `language`.

- **complete and subagent**: when `prompt` has neither, ` {STYLE}` is added at its end, so the answer follows the display language even if you say nothing about it. When it has either, nothing is added: you decide. A definition that must answer in a fixed language can use that, e.g. `"Translate the selected text into French. Write any note on it in {ANSWER_LANGUAGE}."`
- **subagent's `task`**: the placeholders are filled in there too, but nothing is added to it: the answer language goes in through `prompt` (the subagent's system prompt)
- **fork**: the answer language is always added when it runs, as for the built-ins. A `{STYLE}` in its prompt is dropped (it would say it twice) and only `{ANSWER_LANGUAGE}` is filled in, so a fork cannot be held to a fixed language

#### Invalid definitions

A definition is ignored, alone, when:

- its `id` is missing or not in the format above, is a built-in's ID, `close` or `hint`, or was taken by an earlier custom definition (the first one keeps it)
- a required field is missing or empty (`model` and `task` as its kind needs them), or a value is of the wrong shape (`label` with only one of `ja` / `en`, `maxTokens` out of range, `tools` empty or not an array)
- `kind` is not `complete` / `fork` / `subagent`, or `model` is not `haiku` / `sonnet` / `opus`
- `target` is not `selection` / `context` (lowercase), or is `context` with a `kind` other than `fork`, such as `target must be one of selection, context (given: foo)` or `a definition with target context must have kind fork (given: complete)`
- `tools` names a tool outside the five above: the whole definition is ignored rather than run without it, since that would run something other than what you wrote

When the setting is not valid JSON, or not an array, every custom definition is ignored. In settings.json the value must be a string (the array in quotes, its quotes escaped): Claude Code does not load the plugin with an unquoted array there. The built-ins work as before in every case. To see what was ignored and why:

- **Run `/quick-actions`** (with or without an ID; nothing need be selected; without an ID it also opens the ⋯ dialog): the result ends with every problem, one per line, such as `#3 (review-pr): tools a subagent cannot have: Bash (…)`. The number is the definition's place in the array, from 1. This always works
- A toast at the start of a session gives the count and the first problem. A change made in `/config` during a session may not show the toast again until the next one: run `/quick-actions` to check
- While the pane is open, the list also shows at its top, in the error colour

#### A word on the tools

- With `WebFetch` / `WebSearch` allowed, the subagent can send the selected text, and whatever it read with `Read` / `Grep` / `Glob` (any file Claude Code's permissions let it read, not only the repository's), to outside sites: on its own, or steered by instructions written in the selection (prompt injection; the selection is only wrapped in `<selected>…</selected>`). Allow them only for actions you will run on text you trust, and keep the default read-only tools otherwise
- Tools that run commands or change files (`Bash`, `Write`, `Edit` and the like) are not accepted in `customActions`

### In the source (for developers)

A built-in is one more definition in the `ACTIONS` array of `hooks/actions.ts`. The hint line, the pane and the runner (`hooks/register.tsx`) need no change. The action added joins the hint line (in the order of use) and can be picked from the ⋯ dialog (while it is past the first 64 listed, type its ID or label in the filter).

Common fields:

| Field | Meaning |
| --- | --- |
| `id` | The ID written in the setting (lowercase letters, digits and hyphens; unique; not `close`, which the ✕ button uses, nor `hint`, the command's argument) |
| `icon` | The icon on the hint line (one emoji) |
| `label` | The name shown on hover and as the pane heading, in both languages: `{ ja: '…', en: '…' }` |
| `kind` | How it runs: `complete` / `fork` / `subagent` |
| `prompt` | The prompt (its role depends on the kind, below) |
| `runningText` | What the pane shows while it runs, as `{ ja, en }` (default "考え中…" / "Thinking…") |
| `target` | `'context'` for a context action (a `fork` only); left out for an action on the selection |

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

A context action is a fork with `target: 'context'`: its `prompt` stands alone, with no selection before it. The built-ins write them with the `contextAction(...)` helper in `hooks/actions.ts`, which adds `kind` and `target`.

#### subagent

`prompt` is the subagent's system prompt, and `task` opens the request it is spawned with (the selection follows it). The subagent is registered as the type `quick-actions:<id>`, and the main Claude is not offered it.

```ts
{
  id: 'config-origin',
  icon: '🔧',
  label: { ja: '設定の出どころ', en: 'Config origin' },
  kind: 'subagent',
  model: 'sonnet',                       // required
  task: 'Find where the following setting is defined in this repository.',
  prompt: sys('You find where a configuration value is defined. Search with Grep and Glob, read with Read; change nothing.'),
  description: { ja: '設定の定義箇所を探します（quick-actions 専用）', en: 'Finds where a setting is defined (Quick Actions only)' }, // default: built from the label
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

`tests/actions.test.tsx` checks every definition (unique IDs, required fields in both languages) and that, with every ID pinned and `hintCount` large enough, the hint line shows them in definition order and each runs as its kind says. Run it after adding a definition. `tests/context.test.tsx` checks the context actions: the eleven built-ins, the `[ ]` / `< >` marks, `/quick-actions hint` with and without a selection and how its line closes, a context action run with no selection, one order for both kinds and pins of either, the ⋯ dialog with nothing selected, and custom context actions. `tests/custom.test.tsx` checks the `customActions` setting: reading and checking the definitions (each kind of invalid one left out alone, broken JSON leaving them all out), their place on the hint line, each kind run by a press and by the command, the answer language, and how the problems are told (the toast, every result of the command, the pane). `tests/i18n.test.tsx` checks the language detection and the display and answer language in both languages. `tests/order.test.tsx` checks the hint line's order (pins, the order of use, the decay, ties, the default set the first time, `hintCount`) and that each use is recorded; `tests/picker.test.tsx` checks the ⋯ dialog (its list (the first 64 of the order, the line on the rest and the filter reaching them), its width the same as the result pane's, a pick running, closing it, the notice without the keyboard and its absence in the mobile app, the mobile app's buttons, custom IDs that look like its own keys) and `/quick-actions` without an ID. `tests/theme.test.tsx` checks `paneTheme`: reading the setting, `auto` drawing as before, the `light` / `dark` palettes on the docked pane and the ⋯ dialog (its buttons included), a contrast ratio of at least 4.5:1 for every text colour of each palette (as written and rounded to 256 colours), and the inline pane unchanged whatever the setting.

The README comes in English (README.md) and Japanese (README.ja.md). Update both when changing either.

## Roadmap

- Actions that need no model, such as "open the URL" or "copy" (a fourth kind)
- Reading custom actions from a file of their own (such as `~/.claude/quick-actions.json`) rather than one setting
- Letting custom subagents use tools that run commands or change files, once their exposure to prompt injection and the permission prompts are worked out

## License

MIT
