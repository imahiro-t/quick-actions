# Quick Actions

English | [日本語](README.ja.md)

A Claude Code plugin of icon actions for the text you select in the conversation (the transcript), for the conversation itself, and for small jobs that need neither. Select some text and icons appear on the hint line under the prompt; press one to run an action on the selection (translate, explain, summarize, proofread, read code, find the evidence, convert data and more), on the conversation (recap it, list the decisions, the next steps, restate the last answer, draft a commit message and more), or on neither (a timer, a calendar, a calculator, a password, a template, a repository overview and more), and read the result in a pane. There are 311 built-in actions of three kinds; the hint line shows one kind at a time, switched by the buttons at its start. With nothing selected, `/quick-actions hint` brings up the hint line, and `/quick-actions <id> [argument]` runs an action by its ID (e.g. `/quick-actions timer 5m`). An action that takes an argument asks for it on an argument screen when pressed on the hint line or in the ⋯ dialog too, and a timer's result has buttons to run it again with the same argument. The actions you use most come first, and you can pin your own to the front in settings; every action, shown on the hint line or not, can be picked from the ⋯ at its end, and its dialog finds one by its ID or name as you type. Labels, messages and answers come in English or Japanese (by default, following Claude Code's language setting and the locale).

Every built-in action can be browsed and searched in the **[action catalog](https://imahiro-t.github.io/quick-actions/)**, by category, in English and Japanese.

## How it works

There are three kinds of action, and the hint line shows one kind at a time (switch with the [kind buttons](#switching-the-kind-shown)):

- **Actions on the selection**, shown as `[icon]`: they run on the text you selected ([the list](#actions-on-the-selection))
- **Context actions**, shown as `<icon>`: they run on the current conversation itself, with no selected text, in a branch (fork) of it ([the list](#context-actions))
- **Standalone actions**, shown as `{icon}`: they use neither the selection nor the conversation. Some are worked out inside the plugin (local: timers, a calculator, ID generators); others ask a model (templates, ideas). `/quick-actions <id> <argument>`, or the [argument screen](#the-argument-screen) that opens when one is pressed on the hint line or in the ⋯ dialog, hands them an argument; with none they run on their default ([the list](#standalone-actions))

The same icon can stand for actions of different kinds (`[🧸]`, `<🧸>` and `{🧸}`, for one); the `[ ]`, `< >` or `{ }` tells them apart.

1. Select text in the transcript with the mouse (or, with nothing selected, run [`/quick-actions hint`](#opening-the-hint-line-without-a-selection-quick-actions-hint))
2. The hint line appears under the prompt: the kind buttons `[selection] <context> {standalone}` first, then the icons of the kind shown, then ✕ and ⋯. Hover over an icon to see its label
   - With a selection it opens on the actions on the selection; with none, on the context actions (see [Switching the kind shown](#switching-the-kind-shown))
   - How many icons are shown follows the line's width: as many as fit beside the kind buttons, ✕, ⋯ and the permission mode shown at the line's left (`⏵⏵ auto mode on ·` and the like), with room kept after ⋯ for the label shown on hover: 2 on an 80-column line, 2 on 100 and 7 on 160 (see [How many icons the hint line shows](#how-many-icons-the-hint-line-shows))
   - The order within each kind: the actions pinned in the [`pinActions`](#pinactions) setting first, then the rest in the order you use them. Each use is counted, and what you used most lately comes first (see [Usage counts](#usage-counts))
   - The first time (no pins and no use yet) the [default set](#pinactions) leads each kind: the actions on the selection `[💡] [🌐] [📝] [🔎] [🔤] [🀄] ✕ ⋯`, the context actions `<🧭> <✅> <📋> <❓> <🧸> <🌐> ✕ ⋯`, the standalone actions from `{⏳}`
   - The order follows each use during the session too, and shows from the next time the hint line comes up. Pressing an icon puts that line away, so the icons you are looking at never move under the pointer
   - Pressing an action's icon (of any kind) or ✕ hides the icons for that selection (selecting other text brings them back). The icon of a standalone action that takes an argument opens its argument screen instead, and the icons go when it runs from there
   - Claude Code keeps the last selection after a click elsewhere takes its highlight down, so that a press can still read it (until you select something else or your next prompt or command has run), and it tells the plugin nothing when the highlight goes. Clicking away without pressing an icon therefore leaves the icons of the selection in place: press ✕ to close them, or switch to `<context>` or `{standalone}` to use the other kinds
   - Once Claude Code reports no selection (after your next prompt or command, for example), the icons go within about 0.3 seconds. This is for a hint line shown by a selection alone; one opened with `/quick-actions hint` closes as [described below](#opening-the-hint-line-without-a-selection-quick-actions-hint)
3. Press an icon and the result is added at the top of the "Quick Actions" tab of the right pane (it keeps the newest 20). If you had scrolled the pane down, running an action brings it back to the top (the newest result)
   - A result's heading shows the icon and label, then the quoted selection for an action on the selection, "this conversation" for a context action, and for a standalone action the argument given to the command or on the argument screen ("standalone" when there was none)
   - For an action on a selection inside one transcript row, the result has a "Go to selection" button that scrolls back to that row (see [Going back to the selection](#going-back-to-the-selection))
   - In fullscreen with a terminal at least 110 columns wide the pane docks on the right; narrower, it shows above the prompt
   - The pane always has two tabs, "Quick Actions" (the results) and "Select an action" (the ⋯ dialog), and one Esc closes both (see [The right pane's two tabs](#the-right-panes-two-tabs))
   - A standalone action that takes an argument (`{⏳}` the timer, say), pressed on the hint line, does not run at once: it opens the pane on its "Select an action" tab, on the action's [argument screen](#the-argument-screen). Enter with the field empty runs it on its default, Enter after typing runs it with what you typed. One that takes no argument (`{🏃}` the stopwatch, say) still runs as soon as it is pressed
   - Where there is no input field (in the mobile app, for one), there is no argument screen: a press runs the action on its default at once. To hand it an argument there, use `/quick-actions <id> <argument>` (see [Command](#command))
4. An action not on the hint line is under the ⋯ at its end: it opens the pane on its "Select an action" tab (so does `/quick-actions` without an ID), where typing in the filter finds it (see [The ⋯ dialog and its filter](#the--dialog-and-its-filter))

The selected text itself is not shown on the hint line (so a multi-line selection does not make the line two rows tall).

### Switching the kind shown

The hint line starts with a button per kind: `[selection]`, `<context>` and `{standalone}` (`[選択]`, `<会話>` and `{単独}` in Japanese). Press one and the line shows the icons of that kind; the kind shown is drawn bold, the others dim. Hover over a button to see which actions it shows.

- **Where it opens**: on the actions on the selection when there is text to run on (a selection, or the text `/quick-actions hint` took in), on the context actions otherwise. With no text there is no `[selection]` button
- **How long a switch holds**: while the line is up. It opens on its starting kind again after a new selection (other text than before), `/quick-actions hint`, ✕, or running an action. Selecting exactly the same text again does not count as a new selection, so the kind you switched to stays
- **Why the buttons**: Claude Code keeps answering the last selection after its highlight is gone and does not tell the plugin when it goes, so the line cannot tell a selection you can see from one you clicked away. When the actions on the selection are still shown after you clicked away, switch to `<context>` or `{standalone}`
- **On a narrow line**: when drawn with their names they would leave room for fewer than two actions (or fewer than there are, when that is less), the buttons are drawn as their marks alone (`[ ]`, `< >`, `{ }`; hover for which), as on an 80-column line. On a line too narrow for even those beside ✕ and ⋯, they are left out and the kind shown stays as it is
- **Their names**: screen readers and the desktop app's native buttons read each button by what it shows, the one shown saying so, such as "Actions on the selection (shown)" ("選択範囲へのアクション（表示中）" in Japanese), whatever the button draws

### How many icons the hint line shows

How many actions the hint line shows follows its width; the rest are under the ⋯ at its end.

- **Never more than fit**: icons are counted from the front while they fit on the one row beside the kind buttons, ✕, ⋯ and the permission mode shown at the line's left, so the line never runs over and no button is split across two rows. When not even one fits, none is; ✕ and ⋯ always stay, and every action can be picked from ⋯. Should the row still be narrower than counted, only the end of the actions is cut: the kind buttons, ✕ and ⋯ stay whole
- **Each button as drawn**: a button is drawn `[ label ]`, flush against the next, so each counts its label and the four cells of its frame
- **Room for the hover label**: the label shown when the pointer is over an icon goes after ⋯. 24 cells are kept clear for it (enough for `Actions on the conversation` or most action names whole; a longer one ends in `…`), and fewer icons are laid out for it. Where the line is too short for that, as much is kept as leaves the kind buttons drawn as they would be and two actions beside them (at 80 columns, next to none)
- **What that comes to** (with a selection, each icon a single emoji): 2 at 80 columns (the kind buttons as their marks alone), 2 at 100 (2 in English, the kind buttons as their marks) and 7 at 160 (5 in English). At 60 columns, 2 with no kind buttons; at 45, none: only ✕ and ⋯
- **Beside a docked pane**: the hint line runs under this plugin's docked pane across the whole terminal, so this plugin's pane docking on the right takes nothing off it: the line shows as many icons with the pane open as with it closed. (For a moment as the pane opens, before it is first drawn, the line may count the transcript's width alone.) Another plugin's docked pane cannot be seen from here, so beside it the line counts the transcript's width, that pane's taken off, and may show fewer
- **Beside the permission mode**: Claude Code draws the permission mode at the line's left (the one shift+tab cycles: `⏵⏵ auto mode on ·`, `⏵⏵ accept edits on ·`, `⏸ plan mode on ·` and the like), with two columns clear at each side of the row. The plugin cannot tell which mode is up, so 30 cells are always kept for it, enough for the longest, `⏵⏵ bypass permissions on ·`
- Each icon with an emoji is given one column to spare, since terminals draw emoji at slightly different widths
- Where the width is not known, 6 icons are shown

### The right pane's two tabs

The right pane (above the prompt on a narrow terminal) always opens with two tabs: **"Quick Actions"**, the results, and **"Select an action"**, the [⋯ dialog](#the--dialog-and-its-filter).

- **Which tab is in front**: pressing an icon on the hint line shows "Quick Actions". The ⋯ on the hint line, and `/quick-actions` without an ID show "Select an action", with the keyboard in its filter (when Claude Code lets it have the keyboard)
- **Picking an action** in "Select an action" brings "Quick Actions" to the front with the result; "Select an action" stays open behind it, its filter emptied, ready for the next pick
- **Closing**: one action closes the whole pane, both tabs at once: Esc, the close mark on either tab (ctrl+x x), or the Close button in "Select an action"
  - Esc closes the pane while you type in the filter too, rather than emptying the filter: use the Clear button beside the field (or delete the text) to empty it
  - Esc pressed at an idle, empty prompt closes the pane too (with both tabs), though the keyboard is at the prompt
  - Closing stops every [action that runs over time](#actions-that-run-over-time). A model call or subagent under way goes on, and its answer lands in "Quick Actions", shown the next time the pane opens
- On a Claude Code that does not bring a reopened tab to the front, the plugin closes that tab and opens it again to show it, so a tab may close and reopen for a moment
  - When you run an action from "Select an action" while it has the keyboard (as after picking in its list or typing an argument), Claude Code keeps that tab in front even over a tab opened again, so the plugin closes both tabs and opens them again, "Quick Actions" last, to bring the result to the front. The keyboard goes back to the prompt then: to pick another action, click "Select an action" (or ctrl+x tab), and Esc at an idle, empty prompt closes the pane as usual

### Opening the hint line without a selection (`/quick-actions hint`)

Run `/quick-actions hint` to bring up the hint line whether or not text is selected:

- **Nothing selected**: the context and standalone actions, in the same order. It opens on the context actions (`<🧭> <✅> <📋> <❓> <🧸> <🌐> ✕ ⋯` the first time), and `{standalone}` switches to the standalone ones; there is no `[selection]` button
- **Text selected**: every kind, as when the selection shows them, opening on the actions on the selection. Running the command makes Claude Code stop reporting that selection, so the plugin takes the selected text in as the command runs: the actions on the selection run on that text, even after its highlight is gone

`hint` takes no argument (`/quick-actions hint foo` answers `hint takes no argument: foo` and does nothing).

It closes the way the hint line of a selection does:

- **✕**, or **running an action** from it (of any kind; from its ⋯ dialog too)
- **A selection made after it opened going away**: select text while it is open and every kind shows for that text; once Claude Code reports no selection again, it closes within about 0.3 seconds

The selection taken in when the command ran is not one of these: its going (which the command itself causes) closes nothing. The trade-off: a hint line opened with text selected stays, with its actions on the selection running on that text, after the text's highlight is gone, until you press ✕ or run an action (as the icons of a selection stay after a click elsewhere, above). Selecting exactly the same text again after it opened does not count as a new selection either, so its going does not close the line: press ✕.

### The ⋯ dialog and its filter

Press the ⋯ at the end of the hint line, or run `/quick-actions` without an ID, to open a dialog of every action. It is the "Select an action" tab of the right pane, shown in front of the "Quick Actions" tab (see [The right pane's two tabs](#the-right-panes-two-tabs)).

- The actions are listed most used first, as `[icon] label`, `<icon> label` or `{icon} label`, every kind mixed: the actions pinned in [`pinActions`](#pinactions) first, then the rest by their usage score (see [Usage counts](#usage-counts)), those used equally or not yet in definition order. Unlike the hint line, the default set does not lead the first time: with no pin and no use yet, the list is in definition order
- Above the list are the kind buttons, `all`, `[ ] selection`, `< > context` and `{ } standalone`. When the dialog opens it lists every kind: `all` is drawn bold and the others dim. Press a kind to list that kind alone (the same order, the most used of it first): that button is drawn bold and the others dim. Press `all`, or the kind shown again, to list every kind again. Each time the dialog opens it starts on every kind; a run picked in it keeps the kind while the dialog stays open behind the result
- Opened with nothing selected (`/quick-actions` without an ID run with no selection, or the ⋯ of a hint line `/quick-actions hint` opened with nothing selected), it lists the context and standalone actions alone, and there is no `[ ] selection` button
- The list is a column of buttons, shown as soon as the dialog opens (nothing to open first)
- The list fills the pane's height: it shows as many actions as fit from the top of the order (a long label that wraps onto two rows takes two), and lists them again when the terminal is resized (shrunk and grown back, it fills the height again). When there are more, page buttons under it, `[ Prev ] 2 / 5 (120) [ Next ]`, reach every one of them without the filter. `Next` on the last page goes round to the first, and `Prev` on the first to the last. Typing in the filter, switching the kind and picking an action go back to the first page
- An action on the selection picked runs on the text that was selected when the dialog opened, or on the one selected since if you select again while the pane is open; a context action runs on the conversation. A standalone action that takes an argument turns the list into its [argument screen](#the-argument-screen); one that takes none runs at once. The result shows in the "Quick Actions" tab, brought to the front; the dialog stays open behind it, keeping that text, with its filter emptied
- Tab or ↓ moves from the filter to the first action; ↑ / ↓ (or Tab / Shift+Tab) move between the actions, and Enter runs the one with the focus. ↓ on the last action goes on to the Close button, and Shift+Tab on the first back to the filter. A click picks too. Esc and the Close button close the whole pane, both tabs, running nothing
- While the prompt holds text you are typing, the dialog does not get the keyboard: click your pick (or a kind button), or clear the prompt and open it again (with ⋯, or with `/quick-actions`, which empties the prompt as it runs)

**The filter**: above the list is a field, "Filter (ID, name, kind)", which has the keyboard when the dialog opens (empty each time it opens). The list narrows as you type.

- **What it searches**: each action's ID, its label (in both English and Japanese, whatever the display language), and the names of its kind (`selection`, `context`, `standalone`, `none`, and the Japanese `選択`, `会話`, `コンテキスト`, `単独`, `コンテキストなし`)
- **How it matches**: anywhere in the text. Words split by spaces (half- or full-width) must all match (AND). Full- and half-width characters, upper and lower case, and katakana and hiragana count as the same (`ＴＩＭＥＲ`, `ﾀｲﾏｰ` or `たいまー` find `timer`)
- **Narrowing by kind**: `[` (or `[]`), `<` (or `<>`) and `{` (or `{}`), written as a word of their own, keep the actions on the selection, the context actions or the standalone actions alone (e.g. `{ clock`). Marks of two different kinds match nothing
- It narrows the kind listed: with a kind button pressed, only the actions of that kind that match are left (and Enter runs the first of them)
- The order stays as it was, except that the action whose ID is the whole query comes first
- **Enter** runs the first action left (the field says "run first"; when nothing matches it says "no match" and Enter runs nothing)
- While the field holds text, a Clear button beside it empties it and lists everything again (as deleting the text does)
- Move the keyboard from the field to the list (Tab or ↓) and ↑ / ↓ and Enter pick from it
- **In the mobile app** there is no filter field: every action is listed as a button, with no limit, to tap
- With [`paneTheme`](#panetheme) set to `light` / `dark`, the filter and the list work the same, the buttons drawn in the palette's colours
- **While Claude asks a question** (AskUserQuestion), the pane is closed and cannot be opened (see below)

### While Claude asks you a question (AskUserQuestion)

While Claude's question dialog (AskUserQuestion) is up, it holds the keyboard and the prompt is gone. Claude Code gives the pane neither the keyboard nor its tab switch meanwhile, so Quick Actions is put away:

- **When the question comes up**: the right pane closes, both tabs. As with its close button, a run over time (a timer and the like) stops
- **While the question is up**: there is no hint line, and `/quick-actions` runs nothing (it answers `Quick Actions cannot be used while a question dialog is up.`)
- **After you answer or cancel the question**: everything works as usual. The pane closed by the question is not reopened by itself

### Going back to the selection

Once the pane opens, Claude Code no longer shows what was selected. So that you can get back to the text a result is about, an action run on a selection inside one transcript row gives its result a **Go to selection** button: it scrolls the transcript back to that row (to the middle of the view). The rows it works for are your messages, Claude's answers, tool calls and their results, groups of tool calls, tool progress, command output, notices, the turn duration line and question dialogs (`AskUserQuestion`).

- The transcript itself is left as Claude Code draws it: neither the row nor the selected words are marked. Claude Code tells the plugin which row a selection lies in, but not where in that row, and a plugin cannot color part of a row Claude Code draws (an answer's Markdown, a tool's output, your prompt) without drawing the row itself and so losing that drawing. Highlighting the whole row instead did not show which words were picked, so it is not done
- Each result has its own button (two commands run on one selection give two results, each with one). The button stays while the result is in the pane: closing the pane, running other actions and a plugin reload keep it, and it goes when its result is pushed out of the pane's 20
- When the row is no longer kept in the transcript, pressing the button does nothing

No button is shown, and the action runs as before, when:

- the selection spans more than one row, or lies outside the transcript (in the pane, the prompt, the hint line or a dialog): Claude Code reports no row for it
- the result is from a context action or a standalone action (they work on no selection)

The button works inside Claude Code and sends nothing.

#### The argument screen

Pick a standalone action that takes an argument in the ⋯ dialog (a built-in whose Argument column in [the list](#standalone-actions) is not "none", or one of your [`customActions`](#customactions) with `target` `none`), from the list or with Enter in the filter, and the dialog turns from the list to that action's argument screen. Pressing its icon on the hint line, or a timer result's Set duration (or the like) button, opens the pane on the "Select an action" tab on this screen too.

- The screen shows the action's icon and label, how to write the argument with examples (e.g. `a duration from 1 second to 24 hours, e.g. 25m, 90s, 1h30m, 5:00; 25 minutes when left out`), what an empty Enter does (`Enter with it empty: run with the default (25m)`, or `Enter with it empty: run with no argument` when there is no default), the field, and Back and Close buttons. The field has the keyboard when it opens
- **Enter with the field empty** (or "run") runs it on its default; **Enter after typing** runs it with that argument, written as for `/quick-actions <id> <argument>`
- **An argument written wrong** (`99h` for `timer`, say) runs nothing (and counts no use): the screen shows the same error the command gives, `Invalid argument for timer: 99h (a duration from 1 second to 24 hours, …)`. What you typed stays in the field, so fix it and press Enter. The error stays until the next Enter
- **Esc** (or Back) goes back to the list running nothing (the filter keeps its text and gets the keyboard back). Esc again on the list closes the whole pane, both tabs. The tab's close mark (×) also goes back to the list first on this screen; the Close button closes the whole pane there and then
- Running it from the screen turns the tab back to its list (the filter emptied, the text kept) and puts the result at the top of the "Quick Actions" tab, brought to the front, headed by the argument typed ("standalone" when the field was empty). Opened from the hint line, the run hides that selection's icons, and closes a hint line `/quick-actions hint` opened
- **Where there is no input field** (in the mobile app, for one) there is no argument screen: picking (or pressing) the action runs it on its default at once, as before

### Actions that run over time

`timer`, `stopwatch`, `pomodoro`, `countdown-to`, `breathing` and `eye-rest` do not answer at once: their result in the pane changes as time goes by (see [Timers](#timers)).

- The time left or gone by shows in the result, with a Stop button under it. Pressing it stops the run there and then, showing `Stopped (after mm:ss)`
- Once a run has ended or stopped (failed at the limit of runs at once, or stopped by a reload of the plugin, too), these buttons take the Stop button's place
  - **Again** (all six): runs it once more with the same argument (with none, if it had none), as a new result at the top of the pane, under the same rules as any run (the limit of runs at once and the rest)
  - **A button to set the argument** (`timer`, `pomodoro`, `countdown-to` and `breathing`, which take one): opens the [argument screen](#the-argument-screen) with the last argument filled in. It is named for the argument: Set duration for `timer`, Set count for `pomodoro`, Set time for `countdown-to`, Choose type for `breathing`. Where there is no input field (in the mobile app, for one) it is not shown, only Again
- Closing the right pane (Esc, the close mark on either tab, or the Close button: each closes both tabs) stops every run (each shows "Stopped (after …)"). A run also stops when its result is pushed out of the pane's 20, and when the plugin reloads (after a change of settings, say)
- Up to 5 can run at once. A sixth fails with `Up to 5 can run at once. Stop one, then run this again`
- A run goes on for 24 hours at most, then stops (`stopwatch` never ends by itself, so it runs until you stop it or for 24 hours)
- A run that comes to its end says so in a toast (e.g. `⏳ Timer 25:00 is done`). No toast is shown when you stop it, close the pane, or it stops at 24 hours
- A timer takes its time as an argument, as in `/quick-actions timer 5m`, or on the argument screen when pressed on the hint line or in the ⋯ dialog; with none (an empty field) it is 25 minutes. Write `90s`, `5m`, `1h30m`, `5:00` (minutes:seconds), `1:30:00` (hours:minutes:seconds) or a number alone (minutes), from 1 second to 24 hours

### What is sent, and when

What goes out depends on the kind of action and how it runs.

- **Local actions** (those whose kind is "local" in the [Action list](#action-list): 16 actions on the selection such as `count-text`, `format-json`, `base64-decode`, `decode-jwt` and `hash-text`, and the 50 standalone timers, clock and calendar, random and generated, calculation and conversion, and reference actions) are worked out inside the plugin. They call no model, send nothing anywhere, and touch no file, network or shell. A local action on the selection sends the selected text nowhere
- The random and generated local actions (`password`, `passphrase`, `random-token`, `uuid` and the rest) use only crypto's random numbers (`crypto.getRandomValues`). Where those cannot be had, they make no value and show an error instead (`Failed: no secure random numbers are available …`); they never fall back on a weaker source such as `Math.random`
- The decoding actions (`url-decode`, `parse-url`, `base64-decode`, `format-json` / `minify-json`, `decode-jwt`) show control characters, bidirectional controls, every invisible format character (U+00AD, U+200B and the like), the other invisible fillers (U+034F, the Hangul fillers and the like), the line and paragraph separators, tag characters (U+E0000–U+E007F) and stray variation selectors escaped (as `\u202e`, or `\udb40\udc41` for a character past U+FFFF), so hidden text does not slip into the pane unseen. A ZWJ joining emoji, the tags of a flag emoji (such as England's) and one variation selector on a character it can vary are kept as they are: U+FE0E or U+FE0F on an emoji character (☀️, the `#` of a keycap), another selector on a kanji (a kanji's variant), or one of the Mongolian free variation selectors (FVS1–4: U+180B–U+180D, U+180F) on a Mongolian letter. The Mongolian vowel separator (U+180E) is kept only between two Mongolian letters (or between one free variation selector kept on a letter and the next letter). Any other selector — at the start, after another selector, or after a letter of another script, space or line break — is escaped, as is any other vowel separator, so a run of selectors, or one slipped in after each letter of a sentence, shows up. This is not a complete defense: one selector kept on each kanji, emoji or Mongolian letter, and a vowel separator between Mongolian letters, can still carry a little hidden data unseen, since a pane cannot tell them from real variants and spelling. This covers the decoding actions' output alone: a model's answer is shown as it comes
- **Actions on the selection** (other than local ones): the selected text is sent through Claude Code to the model (the one the session uses, such as the Anthropic API) only when you press an icon or an action in the ⋯ dialog, or run `/quick-actions <id>`. Selecting alone, opening the ⋯ dialog, or running `/quick-actions hint` sends nothing
- `fork` actions on the selection (💬 Ask Claude and 🧾 Why so?) pass the current conversation to the model along with the selection
- **Context actions** pass the current conversation (a fork of the session) to the model, and no selected text, when you press one or run `/quick-actions <id>` with its ID. Everything in the conversation so far (your prompts, Claude's answers, tool results and the file contents read into it) goes with it, as for the next turn of the session
- **Standalone actions that use a model** (of kind `complete` or `subagent`) send the model the action's prompt and the argument alone: neither the selected text nor the conversation (run with text selected, they leave the selection unused and hide its icons). An argument is sent, as written, only when you write it in `/quick-actions <id> <argument>` or on the argument screen; without one, an action with a default sends that default (`node` for `gitignore-template`, say), and one without sends no argument
- **Repository surveys** (the seven whose IDs start with `repo-`, such as `repo-overview`) are subagents that read the repository in the working directory with read-only tools (Read / Grep / Glob). What they read goes to the model. They change no file and run no command
- Only when the display language is detected (`language` is `auto`), the plugin reads Claude Code's `language` setting and the environment variables `LC_ALL`, `LC_MESSAGES` and `LANG`. The values are used to pick the language and nothing else; they are not sent anywhere
- The selection is passed as the text to work on, not as instructions: it is wrapped in `<selected>…</selected>`, any such tag inside it, opening or closing, in any case and with spaces or invisible characters in it (`</SELECTED>`, `</selected >`, `< / selected>` and the like), is made harmless first (its `<` written `&lt;`) so the text cannot close the wrapping early, and the prompt says the text inside is data, not instructions. The same applies to actions you add in `customActions`. This is no complete defense, though: if you select untrusted text (a web page, tool output) the answer can still be steered by instructions inside it. The `fork` actions, 💬 Ask Claude and 🧾 Why so?, are the most exposed, since they read the selection together with the conversation (🧾 Why so? takes it as something Claude said and reasons about it in that context). The built-in `complete` actions have no tools, and the built-in `subagent` actions have only read-only tools (Read / Grep / Glob) or the web tools (`WebSearch` / `WebFetch`): none of them can write files or run commands
- **The actions that check the web** (📚 Check on the web `web-check`, 📘 Official docs `official-docs`, 🚑 Search the error `search-error`, 📦 Package info `package-info`) send the selection outside: words from it go to a web search service as queries, and they fetch pages at URLs written in the selection or turned up by the search. They have no tool that reads files, and like every subagent of this plugin they run without CLAUDE.md (yours, the project's or the rules) in their context, so nothing from the repository or CLAUDE.md is put into those queries or URLs: the queries come from the selection, and the pages fetched are ones the selection names or the search found (their prompts also tell them to build queries from the selection alone and fetch only such URLs, though that part rests on the model following it). The pages they fetch can carry instructions of their own (prompt injection) that steer the answer, or what is searched and fetched next. Since they cannot change files or run commands, the effect stays within the answer in the pane. They send only when you press one on the hint line or in the ⋯ dialog, or run `/quick-actions <id>`. They are not in the first-time order, but they can always be picked in the ⋯ dialog (type `web-check` or the like in its filter), and once used they may show on the hint line in the order of use (no setting takes them out of the order). Whether they can search or fetch at all also depends on your Claude Code permissions for `WebSearch` / `WebFetch`
- Actions you add in [`customActions`](#customactions) send the same way as their kind (the selection, the conversation, or the prompt and the argument). A custom subagent you allow `WebFetch` / `WebSearch` can send the selection, its argument and the files it read (inside the repository or out) to outside sites (instructions hidden in the selection can steer it to). Tools that run commands or change files (`Bash`, `Write`, `Edit` and the like) are not accepted (see [Adding an action from the settings](#from-the-settings-customactions))

### Usage counts

- For the order of the hint line and the ⋯ dialog, the plugin keeps a usage score per action in the local store Claude Code gives the plugin (`$.store`, a file in Claude Code's configuration directory). It is not sent anywhere
- Only each action ID's score and the time it was last used are kept, never the selected text, an argument or a result
- A use adds 1 to the score, and a score halves every 30 days, so actions you used a lot long ago do not stay in front for good
- The order is worked out again after each use, and shows from the next time the hint line or the ⋯ dialog is drawn, in the middle of a session too
- The score of a custom action you removed does not affect the order (it is kept for when the definition comes back). There is no screen to reset or view the counts

## Install

At the prompt of a Claude Code terminal session, run the following (replace `<owner>/<repo>` with the GitHub `owner/repository` that publishes this repository).

```
/plugin install quick-actions --marketplace <owner>/<repo>
```

1. Answer `y` to `Add marketplace?`
2. When the plugin's details show, choose a scope (the user scope enables it in every later session)
3. On the settings screen, set `pinActions` (the actions to pin to the front; leave it empty for the order of use), `language` (default `auto`) and `paneTheme` (the pane's colours; default `auto`). `customActions` (your own actions) can stay empty
4. Once `Installed quick-actions. Plugin is now active.` shows, it works in that session right away

## Settings (userConfig)

### `pinActions`

The IDs of the actions to pin to the front of the hint line, comma-separated, in the order you want them. The actions you leave out follow them in the order you use them, and can be picked from the ⋯ dialog too.

In `/config`, under `quick-actions`, enter for example the following in `pinActions`.

```
explain,translate-ja,summarize,timer
```

From the command line:

```sh
echo '{"pinActions":"explain,translate-ja,summarize,timer"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

Directly in `settings.json` (the key is `<plugin name>@<marketplace name>`):

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": { "pinActions": "explain,translate-ja,summarize,timer" }
    }
  }
}
```

- **Unset or empty**: nothing is pinned; every action is in the order of use. The first time, with no use yet, the default set `explain,recap,translate-ja,decisions,summarize,code,timer` leads, and the rest follow in definition order (the [actions on the selection](#actions-on-the-selection), then the [context actions](#context-actions), then the [standalone actions](#standalone-actions)). Each kind shown on the hint line starts with the default set's actions of that kind: `[💡] [🌐] [📝] [🔎]` for the actions on the selection, `<🧭> <✅>` for the context actions, `{⏳}` for the standalone actions
  - Actions used equally, or not yet, keep the definition order. So once you use any action, the default set no longer leads: what you used comes first, then the rest in definition order (after a context action, for one, the actions on the selection read `[🌐] [🔤] [🀄] …`). To keep the default set in front, write it in `pinActions`
- **Any kind**: the IDs of context actions (`recap`, `handoff`, …) and standalone actions (`timer`, `calc`, …) can be pinned like those of the actions on the selection, mixed in any order. Each kind's pins lead that kind on the hint line (`explain,recap` puts `[💡]` first among the actions on the selection and `<🧭>` first among the context actions), and they lead the ⋯ dialog's list in the order written
- **Unknown IDs**: ignored (no error). If no valid ID is left, nothing is pinned (as when empty)
- **Your own actions**: the IDs of the valid definitions in [`customActions`](#customactions) can be written here like the built-ins'
- **Changed and removed IDs**: see [Changed IDs](#changed-ids). An old ID left in the setting is ignored like an unknown one
- Surrounding spaces and letter case are ignored; an ID written twice is used once, at its first place
- When more of one kind are pinned than the hint line shows (see [How many icons the hint line shows](#how-many-icons-the-hint-line-shows)), it shows the first of them; the rest are under ⋯

### `language`

The language of the hint line's labels, the pane, the ⋯ dialog, the command's messages and the toasts, and the language each action answers in.

| Value | Behaviour |
| --- | --- |
| `auto` (default) | Looks at Claude Code's `language` setting, then `LC_ALL`, `LC_MESSAGES`, `LANG`: Japanese if Japanese is detected, English otherwise or when nothing is found |
| `ja` | Japanese |
| `en` | English |

- When Claude Code's `language` setting is set (e.g. `"japanese"`, `"日本語"`, `"ja"`), it decides on its own (the locale is not consulted). Any language other than Japanese gives English
- From the locale, the first variable with a value is used; one starting with `ja` (`ja`, `ja_JP.UTF-8`) gives Japanese (`C`, `POSIX`, `en_US.UTF-8` and the like give English)
- Unknown or empty values count as `auto`
- The translation actions keep their target language: `translate-ja` always translates into Japanese, `translate-en` always into English, `translate-zh` and the others into their own language, and `easy-japanese` always rewrites into Easy Japanese. Only their labels follow the display language ("To Japanese", "To English" and so on in English). The target of `translate-last`, `translate-last-en` and `translate-last-ja`, which translate the last answer, also comes before `language`
- The ⋯ dialog's filter finds actions by their English and Japanese labels alike, whatever the display language
- The results tab's title, "Quick Actions", is the product name and stays the same in both languages; the ⋯ dialog's tab, "Select an action", reads "アクションを選択" in Japanese

From the command line or in settings.json:

```sh
echo '{"language":"en"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": { "pinActions": "explain,translate-ja,summarize,timer", "language": "en" }
    }
  }
}
```

A change made in `/config` reloads the plugin and takes effect at once (after `claude plugin configure` or an edit to settings.json, restart Claude Code). `auto` detects once per load of the plugin, so a change to Claude Code's language setting or to the locale while it runs takes effect on the next reload or restart.

### `paneTheme`

The colours of the docked result pane (on the right) and the ⋯ dialog.

| Value | Behaviour |
| --- | --- |
| `auto` (default) | Follows Claude Code's theme: core paints the background and the text is drawn in the theme's colours |
| `light` | A fixed light palette: its own background (`#fafafa`) and text colours, whatever the theme |
| `dark` | A fixed dark palette: its own background (`#1e1e1e`) and text colours, whatever the theme |

- Use `light` or `dark` when the terminal and the theme disagree (a dark terminal on the light theme, or the other way round), or to see the pane in the brightness you like
- Every text colour of both palettes (heading, body, failures and the secondary texts) has a contrast ratio of at least 4.5:1 against its background (WCAG AA), also when a 256-colour terminal (Terminal.app, for one) rounds them to its nearest colours. A 16-colour terminal draws a rougher approximation, which may lower it
- With `light` or `dark`, the ⋯ dialog's action buttons are drawn in the palette's body colour. The filter field and the list work as without a palette
- The Stop button of an action that runs over time is drawn in the palette too
- The inline pane (a terminal narrower than 110 columns) is not affected: it keeps the terminal's own colours whatever the setting
- Unknown or empty values count as `auto`
- Core may still paint a thin edge around the pane in the theme's colour, outside what the plugin draws

From the command line:

```sh
echo '{"paneTheme":"dark"}' | claude plugin configure quick-actions@quick-actions --values-stdin
```

Like the other settings, a change in `/config` takes effect at once; after `claude plugin configure` or an edit to settings.json, restart Claude Code.

### `customActions`

Your own actions, as a JSON array of definitions written as one string (empty by default). The fields and examples are in [Adding an action from the settings](#from-the-settings-customactions). A valid definition joins the hint line (in the order of use) and can be picked from the ⋯ dialog like a built-in (a newly added one comes after the built-ins, so while it is past those that fit in the list, type its ID or label in the filter); put its ID in `pinActions` to pin it to the front. `/quick-actions <id>` runs it too.

In `/config`, under `quick-actions`, enter the array on one line in `customActions`, for example:

```
[{"id":"pirate","icon":"🦜","label":{"ja":"海賊風に言い換え","en":"Pirate talk"},"kind":"complete","model":"haiku","prompt":"Retell the selected text the way a pirate would."}]
```

From the command line (the value is a string, so the quotes inside it are escaped):

```sh
claude plugin configure quick-actions@quick-actions --values-stdin <<'EOF'
{"pinActions":"explain,pirate","customActions":"[{\"id\":\"pirate\",\"icon\":\"🦜\",\"label\":{\"ja\":\"海賊風に言い換え\",\"en\":\"Pirate talk\"},\"kind\":\"complete\",\"model\":\"haiku\",\"prompt\":\"Retell the selected text the way a pirate would.\"}]"}
EOF
```

Directly in `settings.json`, escaped the same way:

```json
{
  "pluginConfigs": {
    "quick-actions@quick-actions": {
      "options": {
        "pinActions": "explain,pirate",
        "customActions": "[{\"id\":\"pirate\",\"icon\":\"🦜\",\"label\":{\"ja\":\"海賊風に言い換え\",\"en\":\"Pirate talk\"},\"kind\":\"complete\",\"model\":\"haiku\",\"prompt\":\"Retell the selected text the way a pirate would.\"}]"
      }
    }
  }
}
```

It is read again whenever the plugin reloads, like `pinActions` and `language`: a change in `/config` takes effect at once; after `claude plugin configure` or an edit to settings.json, restart Claude Code. Run `/quick-actions` after a change to see whether any definition was ignored, and why.

### Changed IDs

- **`translate` → `translate-ja`**: the action that translates the selection into Japanese (🌐 To Japanese) now has the ID `translate-ja`. If your `pinActions` setting says `translate`, change it to `translate-ja` (left as it is, it is ignored as an unknown ID and no longer pinned). `/quick-actions translate` becomes `/quick-actions translate-ja` too (`translate` now answers as an unknown ID, with candidates)
- **Removed IDs**: of the earlier built-ins, `command`, `error`, `regex`, `code-explain`, `review`, `stacktrace`, `log`, `security`, `test-ideas`, `glossary`, `simplify`, `proofread`, `structure`, `naming`, `usages`, `docs`, `next-step` and `send` are gone. Left in your `pinActions` setting, they are ignored like unknown IDs (they are simply no longer pinned; if no valid ID is left, nothing is pinned). Some of their uses have actions under other IDs (`explain-regex`, `explain-stacktrace`, `explain-log`, `check-writing`, `find-usages`, `unit-test-ideas`, `security-check`, for example)
- A custom definition in [`customActions`](#customactions) with a built-in's ID is ignored. If the ID of a custom action you already had is now taken by a new built-in, give your custom action another ID (run `/quick-actions` to see the definitions ignored and why)

## Command

```
/quick-actions [<id> [<argument>] | hint]
```

- **`/quick-actions <id>`**: runs an action and shows the result in the pane. An action on the selection runs on the selected text (with nothing selected, it answers `No text is selected` and runs nothing); a context action runs on the conversation, selected text or not; a standalone action runs on neither. An action that is not on the hint line can still be run by its ID, your own included. Letter case in the ID is ignored
- **`/quick-actions <id> <argument>`**: hands a standalone action its argument: everything after the first space following the ID (trimmed; its case and inner spaces kept). For example `/quick-actions timer 5m`, `/quick-actions calc (1+2)*3`, `/quick-actions unit-convert 10 km mi`, `/quick-actions brainstorm a team study session`. How to write each argument, and its default, are in the [list of standalone actions](#standalone-actions). Left out, the default is used
  - A free-text argument takes up to 500 characters
  - **An argument to an action that takes none** (an action on the selection, a context action, a standalone action with no argument, or `hint`): nothing runs, and it answers `<id> takes no argument: <argument>`
  - **An argument written wrong** (`/quick-actions timer 99h`, say): nothing runs, and it answers `Invalid argument for <id>: <argument> (<how to write it>)`. A mistake the action finds only when it reads the argument (dice with too many sides for `dice`, say) shows in the pane as a failure, `Invalid argument: …`
- **`/quick-actions`** (no ID): opens the same dialog as the hint line's ⋯ (the right pane, on its "Select an action" tab), and the action picked there runs on the text that was selected when the command ran, or on the one selected since while the pane is open (with nothing selected, the dialog lists the context and standalone actions alone)
- **`/quick-actions hint`**: opens the hint line, with nothing selected too (see [above](#opening-the-hint-line-without-a-selection-quick-actions-hint))
- **An unknown ID**: nothing runs, and it answers `Unknown action ID: <id> (candidates: …). Run /quick-actions (no ID) to search the list`. The candidates are up to ten actions that the ID matches in the ⋯ dialog's filter, in the order (none are listed when nothing matches)
- The ID of a `customActions` definition that was ignored runs nothing and says why

A standalone action that takes an argument, pressed on the hint line or in the ⋯ dialog, asks for it on the [argument screen](#the-argument-screen) (empty: its default). The argument typed there is parsed and checked as this command's is, and one written wrong shows the same error on the screen. Where there is no input field (in the mobile app, for one) there is no screen, and it runs on its default.

When `customActions` has problems, every result of the command (with or without an ID, with nothing selected too) ends with the list of the definitions ignored and why.

## Action list

The [action catalog](https://imahiro-t.github.io/quick-actions/) ([docs/index.html](docs/index.html) in the repository) lists the same actions with a search box and filters by kind and by how they run.

Kinds:

- **complete**: one model call (the conversation is not used). An action on the selection is given the selected text; a standalone one, its argument alone
- **fork**: answered in a branch of the current conversation, so the answer knows what you are working on. Every context action is a fork
- **subagent**: a subagent of its own looks things up and answers. Those that search the repository (`code`, `find-usages`, `find-tests` and the repository surveys starting with `repo-`) have read-only tools alone (Read / Grep / Glob); those that check the web (`web-check`, `official-docs`, `search-error`, `package-info`), `WebSearch` / `WebFetch` alone. The main Claude is not offered them
- **local**: no model; worked out inside the plugin (see [What is sent, and when](#what-is-sent-and-when)). A result is cut at 20,000 characters, ending with `(truncated)`

The labels below are the English ones (see [README.ja.md](README.ja.md) for the Japanese). Answers come in the language chosen with `language`, except where the language is the point (a translation or a rewrite, for one). "The conversation's" in the Model column is the model the session uses.

- [Actions on the selection](#actions-on-the-selection) (104): [Translation](#translation) (14), [Meaning](#meaning) (12), [Summary and structure](#summary-and-structure) (12), [Writing](#writing) (10), [Code](#code) (22), [Evidence](#evidence) (3), [Research](#research) (5), [Data](#data) (21), [Learning](#learning) (2), [Checks](#checks) (3)
- [Context actions](#context-actions) (102): [Essentials](#essentials) (11), [Looking back](#looking-back) (12), [The last answer](#the-last-answer) (20), [How the work goes on](#how-the-work-goes-on) (16), [Checks from one point of view](#checks-from-one-point-of-view) (14), [Drafts](#drafts) (11), [Learning from the conversation](#learning-from-the-conversation) (12), [Analysing the conversation](#analysing-the-conversation) (6)
- [Standalone actions](#standalone-actions) (105): [Timers](#timers) (6), [Clock and calendar](#clock-and-calendar) (11), [Random and generated](#random-and-generated) (15), [Calculations and conversions](#calculations-and-conversions) (14), [Reference tables](#reference-tables) (4), [Ideas](#ideas) (6), [Drafting commands and code](#drafting-commands-and-code) (7), [Templates](#templates) (11), [Conventions and checklists](#conventions-and-checklists) (7), [Learning and knowledge](#learning-and-knowledge) (9), [Team communication](#team-communication) (4), [A break](#a-break) (4), [Repository surveys](#repository-surveys) (7)

### Actions on the selection

They run on the text you selected (104 of them). Run with `/quick-actions <id>`, they work on the text selected then. None takes an argument.

#### Translation

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `translate-ja` | 🌐 | To Japanese | Translates into Japanese (code, identifiers, paths and commands kept as they are) | complete | haiku |
| `translate-en` | 🔤 | To English | Translates into English (code, identifiers, paths and commands kept as they are) | complete | haiku |
| `translate-zh` | 🀄 | To Chinese (Simplified) | Translates into Simplified Chinese | complete | haiku |
| `translate-zh-tw` | 🏮 | To Chinese (Traditional) | Translates into Traditional Chinese as used in Taiwan | complete | haiku |
| `translate-ko` | 🌏 | To Korean | Translates into Korean | complete | haiku |
| `translate-es` | 💃 | To Spanish | Translates into Spanish | complete | haiku |
| `translate-fr` | 🥐 | To French | Translates into French | complete | haiku |
| `translate-de` | 🥨 | To German | Translates into German | complete | haiku |
| `translate-pt` | ⚽ | To Portuguese | Translates into Brazilian Portuguese | complete | haiku |
| `translate-vi` | 🛵 | To Vietnamese | Translates into Vietnamese | complete | haiku |
| `easy-japanese` | 🌱 | Plain Japanese | Rewrites it, in Japanese or another language, as Easy Japanese: short sentences and basic words | complete | haiku |
| `furigana` | 🈁 | Readings (furigana) | Adds the reading in hiragana, in parentheses, after each hard-to-read or kanji word | complete | haiku |
| `translation-variants` | 🔀 | Literal vs natural | Translates Japanese into English or English into Japanese twice, literally and naturally, and shows how they differ | complete | sonnet |
| `check-translation` | 🪞 | Check a translation | Compares a source text with its translation: mistranslations, omissions and unnatural phrases, each with a fix | complete | sonnet |

#### Meaning

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `explain` | 💡 | Explain | What it means, why it likely appeared, what to do about it | complete | sonnet |
| `eli5` | 🧸 | Explain simply | Explains it to someone with no background, with an everyday analogy | complete | haiku |
| `deep-dive` | 🔬 | Deep dive | Goes into how it works, the background and why it is so | complete | sonnet |
| `ask` | 💬 | Ask Claude | Explains it in the context of the current work | fork | the conversation's |
| `define-terms` | 📖 | Define terms | Picks out about ten technical terms and concepts and defines each in a line or two | complete | haiku |
| `examples` | 🧪 | Examples | Two or three concrete examples of the concept or claim (with a short snippet where code suits) | complete | sonnet |
| `analogy` | 🎭 | Analogy | Puts it in an everyday analogy or two, with where the analogy breaks down | complete | haiku |
| `background` | 📜 | Background | Why the technology, term or convention came about, how it developed and where it stands today | complete | sonnet |
| `pros-cons` | 🪙 | Pros and cons | The advantages and disadvantages of the approach or technology, and when it suits | complete | sonnet |
| `compare-items` | 🆚 | Compare | Compares the options, terms or versions in a table (one alone: against its usual alternatives) | complete | sonnet |
| `counterargument` | 🥊 | Counterpoints | Three to five counterarguments, other views and cases where its assumptions break down | complete | sonnet |
| `expand-acronyms` | 🔠 | Expand acronyms | Expands each abbreviation and acronym to its full name, with a line on its meaning | complete | haiku |

#### Summary and structure

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `summarize` | 📝 | Summarize | A few sentences or up to five bullet points | complete | haiku |
| `tldr` | ⚡ | TL;DR | One line | complete | haiku |
| `key-points` | 📌 | Three key points | The three most important points, each with why it matters | complete | haiku |
| `to-bullets` | 🔘 | As bullet points | Restructured as bullet points, nothing dropped (not a summary) | complete | haiku |
| `outline` | 📑 | Outline | Its structure as an outline: nested headings, each with a one-line gist | complete | haiku |
| `action-items` | 🎬 | Action items | The things to be done, with who and by when where given (from notes, an email, an issue…) | complete | haiku |
| `extract-numbers` | 🔢 | Numbers and dates | The numbers, amounts, dates and durations in a table, each with what it stands for | complete | haiku |
| `extract-entities` | 📇 | Names and entities | The proper nouns by kind: people, organizations, products, file names, URLs… | complete | haiku |
| `title-ideas` | 🪧 | Title ideas | Five headings, titles or subject lines, shortest first | complete | haiku |
| `to-faq` | 🙋 | As an FAQ | Reworked into three to seven likely questions with their answers | complete | haiku |
| `to-timeline` | 📅 | As a timeline | The events (a log, a history, notes…) in order of time, one line each | complete | haiku |
| `to-diagram` | 🌳 | As a diagram | The steps, relations or structure as a Mermaid diagram | complete | sonnet |

#### Writing

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `check-writing` | 🧐 | Proofread | Typos, grammar and inconsistent notation, each with the fix, then the whole text corrected | complete | sonnet |
| `check-english` | 🔍 | Check English | Grammar mistakes and unnatural phrases in English prose, with what a native speaker would write and why | complete | sonnet |
| `keigo` | 🎩 | Make it polite | Rewritten politely: keigo for Japanese, polite business English for English | complete | haiku |
| `casual-tone` | 👕 | Make it casual | Rewritten in a relaxed tone for a chat, the meaning kept | complete | haiku |
| `make-concise` | 🤏 | Make it concise | Rewritten to about half its length, no meaning lost | complete | haiku |
| `rewrite-clear` | 🪟 | Rewrite clearly | Rewritten to read more easily for the same readers: structure and wording, not detail or content | complete | sonnet |
| `paraphrase` | 🔁 | Paraphrase | Three paraphrases with different nuances, each with a note on its nuance | complete | haiku |
| `tone-check` | 👂 | Tone check | How it is likely to come across (harsh, vague, rude…), with softer versions of the phrases that may land badly | complete | haiku |
| `draft-reply` | 📨 | Draft a reply | A reply to the message (an email, a chat, a review comment…) in its tone, covering its points | complete | sonnet |
| `fill-in-blanks` | 🧩 | What is missing | The information the document, request or issue lacks (purpose, assumptions, deadline, steps to reproduce…), as questions to ask | complete | sonnet |

#### Code

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `explain-code` | 💻 | Walk through code | Walks through the code in the order it runs, then its inputs, outputs and side effects | complete | sonnet |
| `code-complexity` | 📈 | Complexity | Its time and space complexity, with the parts each rests on and any bottleneck | complete | sonnet |
| `find-bugs` | 🐛 | Possible bugs | Possible bugs (boundaries, null, races, leaks…), most serious first, each with a fix | complete | sonnet |
| `security-check` | 🔐 | Security check | Possible vulnerabilities in code or configuration (injection, missing authorization, secrets…), most serious first, with fixes | complete | sonnet |
| `perf-check` | 🚀 | Performance tips | Performance problems (needless loops, N+1 queries, wasted allocations…), each with an improvement | complete | sonnet |
| `suggest-refactor` | 🧹 | Refactoring ideas | A more readable, maintainable rewrite in a code block, each change explained | complete | sonnet |
| `edge-cases` | 🧗 | Edge cases | The edge cases to handle, each marked handled, not handled or unclear | complete | sonnet |
| `unit-test-ideas` | 🧫 | Unit test ideas | Test cases as a table of input and expected result (with a short test snippet where it helps) | complete | sonnet |
| `pseudocode` | 📐 | As pseudocode | Rewritten as language-neutral pseudocode, or numbered steps | complete | haiku |
| `port-code` | 🔄 | Port to another language | Rewritten in another language (the one asked for; else TypeScript, or Python for TypeScript code) | complete | sonnet |
| `explain-types` | 🧬 | Read the types | Explains a type definition, type error or generics in plain words | complete | sonnet |
| `name-ideas` | 🔖 | Naming ideas | Five names for the variable, function or class, each with its reason | complete | haiku |
| `docstring` | 📓 | Doc comment | A documentation comment in the language's form (JSDoc, a docstring…) | complete | haiku |
| `explain-regex` | 🧵 | Explain regex | Explains a regular expression part by part, with strings it matches and does not | complete | sonnet |
| `explain-sql` | 💾 | Explain SQL | What the SQL reads or changes, clause by clause, with the performance points to watch | complete | sonnet |
| `explain-shell` | 🐚 | Explain command | A shell command or pipeline, one command and option at a time, warning of anything dangerous | complete | sonnet |
| `explain-stacktrace` | 🥞 | Read a stack trace | Reads a stack trace: the exception, where it was thrown, the call path and likely causes | complete | sonnet |
| `explain-diff` | ➕ | Explain a diff | Explains a diff file by file: what each change is for and what it affects | complete | sonnet |
| `explain-config` | 🔧 | Explain config | Each setting in a configuration (YAML, JSON, TOML, a Dockerfile…), its meaning and what to watch | complete | sonnet |
| `explain-cron` | ⏰ | Explain cron | Breaks a cron expression into its fields and says when it runs, with examples | complete | haiku |
| `explain-http` | 📡 | Explain HTTP | An HTTP request, response, status or headers: what each part means and the likely causes of anything wrong | complete | haiku |
| `explain-log` | 🪵 | Read the logs | Sums up what the log lines show in order, pointing out the abnormal ones and what to check next | complete | sonnet |

#### Evidence

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `code` | 🔎 | Find the code | Finds where the text or behaviour comes from in the repository | subagent | sonnet |
| `why` | 🧾 | Why so? | Explains the grounds for something Claude said in the conversation | fork | the conversation's |
| `web-check` | 📚 | Check on the web | Checks the claims against web sources, with their URLs: what they support apart from what they do not support or contradict | subagent | sonnet |

#### Research

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `find-usages` | 🎯 | Find usages | Finds the definition and every use of the identifier (a function, type, variable, setting key…) in the repository | subagent | sonnet |
| `find-tests` | 🧯 | Find related tests | Finds the tests in the repository related to the code, identifier or error message | subagent | sonnet |
| `official-docs` | 📘 | Official docs | Finds the official documentation of the API, option or error on the web | subagent | sonnet |
| `search-error` | 🚑 | Search the error | Finds the known causes and fixes of the error on the web (issue trackers, Q&A sites, official docs) | subagent | sonnet |
| `package-info` | 📦 | Package info | Looks up a library or package on the web: what it is for, its latest version, its maintenance and caveats | subagent | sonnet |

#### Data

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `to-table` | 📊 | As a table | A list, a log or items in prose as a Markdown table, nothing left out or added | complete | haiku |
| `json-to-yaml` | 📄 | JSON to YAML | Converts JSON into YAML with the same content | complete | haiku |
| `yaml-to-json` | 📃 | YAML to JSON | Converts YAML into JSON with the same content | complete | haiku |
| `json-to-types` | 🧷 | Types from JSON | Infers TypeScript type definitions from JSON | complete | haiku |
| `infer-schema` | 🧱 | Infer a schema | Infers a schema from the data (a JSON Schema for JSON, CREATE TABLE for tabular data) | complete | sonnet |
| `count-text` | 🧮 | Count characters | Counts characters (with and without white space), words, lines and UTF-8 bytes | local | — |
| `format-json` | 🎀 | Format JSON | Lays JSON out with two-space indentation | local | — |
| `minify-json` | 🪶 | Minify JSON | Puts JSON on one line with no white space | local | — |
| `csv-to-table` | 📋 | CSV to table | CSV (or TSV) as a Markdown table, its first record the header | local | — |
| `sort-lines` | 🔽 | Sort lines | Sorts the lines (case ignored, by code point) | local | — |
| `dedupe-lines` | 👯 | Remove duplicate lines | Removes repeated lines and says how many | local | — |
| `case-variants` | 🔡 | Case variants | The word or identifier in camelCase, PascalCase, snake_case, kebab-case and CONSTANT_CASE | local | — |
| `base64-decode` | 🔓 | Base64 decode | Decodes Base64 (standard or URL-safe) as UTF-8 text | local | — |
| `base64-encode` | 🔒 | Base64 encode | Encodes the text in Base64 | local | — |
| `url-decode` | 🔗 | URL decode | Decodes percent-encoding | local | — |
| `url-encode` | 🔣 | URL encode | Percent-encodes the text | local | — |
| `parse-url` | 🧭 | Parse a URL | Takes a URL apart: scheme, user (password hidden), host, port, path, query and fragment | local | — |
| `decode-jwt` | 🎫 | Decode a JWT | Decodes a JWT's header and payload (exp, iat, nbf as dates; the signature is not verified) | local | — |
| `epoch-to-date` | ⌛ | Epoch to date | A UNIX time (seconds or milliseconds) as a date in UTC and local time (ISO 8601) | local | — |
| `hash-text` | 🆔 | Hash | The SHA-256 and SHA-1 of the text | local | — |
| `color-convert` | 🎨 | Convert a color | A colour (#RGB, #RRGGBB, rgb(), hsl()) as HEX, RGB and HSL | local | — |

#### Learning

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `make-quiz` | ❔ | Make a quiz | A three-to-five-question quiz on the text, the answers together at the end | complete | haiku |
| `learn-more` | 🎓 | What to learn next | Three to five related topics worth learning next, with keywords to search | complete | sonnet |

#### Checks

| ID | Icon | Label | What it does | Kind | Model |
| --- | --- | --- | --- | --- | --- |
| `weak-claims` | 🚩 | Weak claims | The claims with no evidence, overstated or needing a check, each with why (nothing is looked up) | complete | sonnet |
| `logic-check` | 🧠 | Check the logic | Points out leaps in logic, contradictions, circular reasoning and missing premises | complete | sonnet |
| `calc-check` | ➗ | Check the math | Recomputes the calculations and checks the figures (totals, percentages, units…), showing the working for each mistake | complete | sonnet |

### Context actions

They run on the current conversation, with no selected text, as a fork of the session (102 of them; every one a fork, answered by the conversation's model). Each is told to work from what the conversation shows and to say so rather than guess where it does not tell. All but the Essentials are also told to change no file, run no command and use no tool, and to answer from the conversation alone. None takes an argument.

#### Essentials

| ID | Icon | Label | What it does |
| --- | --- | --- | --- |
| `recap` | 🧭 | Recap | What the conversation set out to do, how it went and where things stand |
| `decisions` | ✅ | Decisions so far | The decisions made and points agreed on, as bullets |
| `todo` | 📋 | Next steps | The work left, as a to-do list in the order to do it |
| `open-questions` | ❓ | Open questions | The questions still unanswered and the points on hold |
| `simplify-last` | 🧸 | Last answer, simply | Claude's last answer restated for someone with no background |
| `translate-last` | 🌐 | Translate last answer | Claude's last answer translated: into English if it is mainly in Japanese, into Japanese otherwise (this target comes before `language`) |
| `assumptions` | 🧱 | Assumptions | The premises and assumptions the work relies on, marking those not checked |
| `risks` | ⚠️ | Risks | The risks and concerns of the current approach and changes, most serious first |
| `changed-files` | 🗂️ | Changed files | The files created, changed or deleted in the session and what changed, as far as the conversation shows |
| `next-questions` | 💭 | Questions to ask next | Three to five questions worth asking Claude next |
| `handoff` | 📝 | Handoff note | A note to hand the work to another person or session: goal, status, decisions, work left, caveats |

#### Looking back

| ID | Icon | Label | What it does |
| --- | --- | --- | --- |
| `recap-oneline` | 🪶 | One-line recap | What the conversation is for and where it stands, in one line |
| `recap-recent` | 🔁 | Recent recap | A recap of the last three to five exchanges alone |
| `session-timeline` | 🕒 | Session timeline | What happened in order: requests, investigations, changes, facts found, changes of direction |
| `goal` | 🎯 | Session goal | The final goal of the conversation and what would count as done (saying what is unclear) |
| `my-requests` | 🙋 | Status by request | Each thing the user asked for, in order, marked done, partly done or not done |
| `key-facts` | 📌 | Key facts | The facts established by investigation or command results, each with what backs it |
| `commands-run` | 📟 | Commands run | The shell commands run in the session, in order, each with its purpose and whether it worked |
| `errors-seen` | 🧯 | Errors and fixes | Each error that came up: its cause, what was done and whether it is solved |
| `files-read` | 📖 | Files read | The files read but not changed, each with what it was read to check |
| `failed-attempts` | 🔙 | Failed attempts | The approaches that failed or were dropped, and why |
| `alternatives-considered` | 🔀 | Alternatives considered | The options weighed, each taken or turned down, and why |
| `constraints` | 📏 | Constraints | The constraints and requirements set out (technical, the spec, the user's instructions), marking those not yet met |

#### The last answer

| ID | Icon | Label | What it does |
| --- | --- | --- | --- |
| `translate-last-en` | 🔤 | Last answer to English | Claude's last answer translated into English (this target comes before `language`) |
| `translate-last-ja` | 🗾 | Last answer to Japanese | Claude's last answer translated into Japanese (this target comes before `language`) |
| `summarize-last` | 📄 | Summarize last answer | Claude's last answer in a few sentences or up to five bullets |
| `tldr-last` | ⚡ | Last answer TL;DR | Claude's last answer in one line |
| `explain-last` | 🔬 | Last answer in depth | Claude's last answer in more depth: background, how it works, why, what to watch |
| `example-last` | 📎 | Examples for last answer | Two or three concrete examples for Claude's last answer (code, input and output, situations) |
| `steps-last` | 🪜 | Last answer as steps | Claude's last answer as numbered steps to follow, each with how to check it worked |
| `table-last` | 📊 | Last answer as table | Claude's last answer organized as a Markdown table |
| `diagram-last` | 🌳 | Last answer as diagram | The structure or flow of Claude's last answer as a text diagram (ASCII or Mermaid) |
| `terms-last` | 🔠 | Terms in last answer | The technical terms and abbreviations in Claude's last answer, explained |
| `counter-last` | 🥊 | Counterpoints to last answer | Three to five counterarguments or other views on Claude's last answer |
| `verify-last` | 🔍 | Check last answer | Sorts the claims in Claude's last answer into backed by the conversation, general knowledge or a guess, pointing out the shaky parts |
| `caveats-last` | 🚸 | Caveats of last answer | What to watch when using Claude's last answer as it stands: caveats, preconditions, cases it does not fit |
| `alternatives-last` | 🚏 | Alternatives to last answer | Two or three other ways than Claude's last answer, each with its strengths and weaknesses |
| `questions-last` | ❔ | Questions on last answer | Three to five questions worth asking back to understand or judge Claude's last answer |
| `code-explain-last` | 💻 | Explain last code | The code last shown or written in the conversation, explained block by block |
| `command-explain-last` | 🐚 | Explain last command | The shell command last run or suggested: each option and what running it does |
| `error-explain-last` | 🚨 | Explain last error | The last error in the conversation: what it means, its likely cause, what to check next |
| `change-explain-last` | 🧾 | Explain last change | The last file change: what changed and why, and how the behaviour differs |
| `review-last` | 🧐 | Review last change | Reviews the last file change for possible bugs, readability and missing tests (it fixes nothing) |

#### How the work goes on

| ID | Icon | Label | What it does |
| --- | --- | --- | --- |
| `next-move` | 👣 | Next move | The one thing to do first right now, with why and how |
| `blind-spots` | 🔦 | Blind spots | The points of view not yet considered and the work that seems missing |
| `unstuck` | 🆘 | Get unstuck | Where the work is stuck, and three ways out not yet tried, in the order to try them |
| `root-cause` | 🌱 | Root-cause hypotheses | Hypotheses about the cause of the problem being chased, most likely first, each with its grounds and how to check it |
| `debug-plan` | 🐞 | Debug plan | What to check next for the bug being chased: logs, steps to reproduce, how to narrow it down |
| `simpler-approach` | 🪄 | Simpler approach | Whether there is a simpler or smaller way than the current approach, and what taking it would give up |
| `devil-advocate` | 😈 | Devil's advocate | The three strongest criticisms of the overall approach, taking the opposing side on purpose |
| `premortem` | 🪦 | Pre-mortem | Supposing the work later failed: the ways it could have, and what to do now to prevent them |
| `tradeoffs` | 🤝 | Trade-offs | What the current approach gains and gives up, aspect by aspect (speed, maintainability, complexity…) |
| `scope-check` | 🧩 | Scope check | Compares the work with the original request: within scope, grown too wide, anything missing |
| `done-check` | 🏁 | Done check | Goes through the stated completion criteria one by one: met, not met or unclear |
| `verify-plan` | 🩺 | How to verify | Numbered steps to check the changes work, each with what to run and the expected result (nothing is run) |
| `rollback-plan` | ⏪ | Rollback plan | The steps to undo the changes, with what to watch (nothing is run) |
| `impact` | 💥 | Impact | The places the changes could affect: callers, settings, users, other features |
| `effort-estimate` | ⏳ | Effort estimate | The remaining work item by item as large, medium or small, with the assumptions behind it |
| `task-dependencies` | 🧶 | Task dependencies | The dependencies among the remaining work: what can run in parallel and what must come in order |

#### Checks from one point of view

| ID | Icon | Label | What it does |
| --- | --- | --- | --- |
| `session-tests` | 🧪 | Session test ideas | The test cases worth checking for the changes, as normal cases, error cases and boundary values |
| `session-edge-cases` | 🧷 | Session edge cases | The boundary conditions and unusual inputs or situations the current approach should be checked for |
| `session-security` | 🔐 | Session security review | Checks the changes and approach for security: input validation, permissions, secrets, injection |
| `session-perf` | 🚄 | Session performance review | Checks the changes and approach for performance (cost, I/O, memory, needless work), with improvements |
| `session-error-handling` | 🦺 | Session error handling review | Checks the error handling in the changed places for gaps: behaviour on failure, messages, cleanup |
| `session-compat` | 🧬 | Session compatibility review | How the changes affect compatibility with existing users, settings, APIs and data, and whether any is breaking |
| `session-a11y` | ♿ | Session accessibility review | Checks the UI and output dealt with for accessibility: colour, screen readers, keyboard use… |
| `session-i18n` | 🌏 | Session i18n review | Checks the changes for internationalization: untranslated text, date and number formats, character widths |
| `session-observability` | 🪵 | Session observability review | Checks whether a problem with the changes would be noticed and traced: logs, error display, measurements |
| `session-refactor` | 🔨 | Session refactor ideas | Improvements to the code touched, for readability, duplication and separation of concerns (nothing is changed) |
| `session-tech-debt` | 🧹 | Session tech debt | The technical debt created or found (stopgaps, TODOs, workarounds), with when to pay it back |
| `session-docs` | 📚 | Session docs to update | The documentation likely to need updating with the changes (README, comments, sample settings…) |
| `session-naming` | 🪧 | Session naming ideas | Name ideas for what was or is about to be made (functions, files, features) |
| `session-release-check` | 🚀 | Session pre-release check | A checklist of what to check before releasing or merging the changes |

#### Drafts

| ID | Icon | Label | What it does |
| --- | --- | --- | --- |
| `draft-commit` | 💾 | Commit message draft | A commit message for the changes: a one-line summary and a body |
| `draft-pr` | 📬 | PR description draft | A pull request description for the changes: title, summary, changes, how to verify |
| `draft-changelog` | 📰 | Changelog entry draft | Changelog or release-note entries for the people who use the product |
| `draft-status` | 📣 | Status update draft | A status update for the team or a manager: done, where things stand, next, blockers |
| `draft-issue` | 🐛 | Issue draft | An issue for a problem or piece of work left over that the conversation found |
| `draft-review-request` | 🙏 | Review request draft | A message asking a reviewer to review the changes |
| `draft-question` | 📨 | Question draft | A self-contained question about the current problem for a colleague or a forum |
| `draft-adr` | 📜 | ADR draft | An ADR for the main design decision made: Context, Decision, Rationale, Consequences |
| `draft-resume-prompt` | 🎬 | Resume prompt | A prompt to paste into a new Claude Code session to pick the work up again |
| `draft-stakeholder-update` | 👔 | For non-engineers | Explains the work to non-engineers: why, what it achieved, what changes for them, without jargon |
| `draft-retro` | 🔄 | Retrospective (KPT) | A KPT retrospective of the session: Keep, Problem, Try |

#### Learning from the conversation

| ID | Icon | Label | What it does |
| --- | --- | --- | --- |
| `learnings` | 🎓 | Learnings | The lessons learned, written to help the next time the same situation comes up |
| `session-glossary` | 📒 | Session glossary | A glossary of the technical terms, abbreviations and project names that came up anywhere in the conversation |
| `concepts` | 🧠 | Key concepts | The background knowledge and concepts needed to follow the conversation |
| `session-cheatsheet` | 📇 | Session cheat sheet | A cheat sheet of the commands, APIs and settings actually used, by purpose |
| `session-quiz` | 🎲 | Session quiz | Three to five questions on what the conversation covered, the answers at the end |
| `session-faq` | 💁 | Session FAQ | What the conversation covered as an FAQ others are likely to ask |
| `study-next` | 🔖 | Next study topics from session | Topics worth studying next to go deeper, with why and how to look into them (no web search) |
| `session-keywords` | 🔑 | Session search keywords | Search keywords for the current problem or topic, in Japanese and English |
| `tips` | 💡 | Tricks picked up | The little-known or surprising tricks from the conversation alone |
| `mistakes` | 🙈 | Claude's mistakes | The mistakes Claude made and where it was corrected, with what was right |
| `prompt-tips` | 💬 | Prompting tips | How the user's instructions could be put so the work goes faster and more accurately |
| `claude-md-ideas` | 📐 | CLAUDE.md ideas | From instructions the user had to repeat, what is worth putting in CLAUDE.md, with the text (CLAUDE.md is not edited) |

#### Analysing the conversation

| ID | Icon | Label | What it does |
| --- | --- | --- | --- |
| `contradictions` | 🔃 | Contradictions | The statements, policies or facts that contradict each other, and which is newer or more likely right |
| `code-map` | 🏠 | Code map | A map of the files, functions and modules that came up and how they relate (calls, imports, contains) |
| `workflow-diagram` | 🧵 | Workflow diagram | The flow of the work as a whole (investigating, changing, checking, loops back) as a text diagram |
| `environment` | 💽 | Environment | The environment the conversation shows: OS, versions of languages and tools, relevant settings |
| `packages` | 📦 | Packages changed | The packages and dependencies added, updated or removed in the session, each with what it is for |
| `links` | 🔗 | Links mentioned | The references that came up (URLs, documents, issue and PR numbers…), each with what it is |

### Standalone actions

They use neither the selected text nor the conversation (105 of them). The Argument column says how to write the argument handed with `/quick-actions <id> <argument>`, and the default used without one (as when the [argument screen](#the-argument-screen) is run with the field empty, or when pressed on the hint line or in the ⋯ dialog in the mobile app); the argument screen takes the same writing; "none" means it takes no argument. For example `/quick-actions timer 5m` (25 minutes with no argument), `/quick-actions date-offset -7`, `/quick-actions password 32`, `/quick-actions gitignore-template python macos`.

#### Timers

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `timer` | ⏳ | Timer | Counts down the time given and tells you with a toast when it is up | a duration from 1 second to 24 hours, e.g. 25m, 90s, 1h30m, 5:00; 25 minutes when left out | local | — |
| `stopwatch` | 🏃 | Stopwatch | Counts up from zero (it never ends by itself: press Stop) | none | local | — |
| `pomodoro` | 🍅 | Pomodoro | Rounds of 25 minutes of work and 5 of break | rounds of 25 minutes of work and 5 of break, from 1 to 8; 4 when left out | local | — |
| `countdown-to` | 🔜 | Count down to a time | Counts down to the time given | a time as HH:MM on the 24-hour clock, tomorrow when it has passed; 18:00 when left out | local | — |
| `breathing` | 🫁 | Breathing guide | Says each second which way to breathe and for how long (four cycles) | box (4-4-4-4 seconds) or 478 (4-7-8 seconds); box when left out | local | — |
| `eye-rest` | 👀 | Eye rest (20 s) | Counts down a 20-second eye break (the 20-20-20 rule) | none | local | — |

#### Clock and calendar

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `clock` | 🕙 | Current time | The time now (local and UTC, ISO 8601, UNIX time) with the weekday, ISO week and day of the year | none | local | — |
| `calendar` | 📆 | Calendar | The month holding the date given, Sunday first, the date marked | a date, e.g. 2026-10-10, 2026/10/10, tomorrow, +7d, -1m; today when left out | local | — |
| `date-info` | 📅 | Date info | What the date is: weekday, ISO week, day of the year, days left in it and from today, Japanese era and sexagenary year | a date, e.g. 2026-10-10, 2026/10/10, tomorrow, +7d, -1m; today when left out | local | — |
| `date-offset` | 🛫 | Date after N days | The date N days from today (before it when negative), with N in weeks and months | a number of days from -36500 to 36500, before today when negative; 30 when left out | local | — |
| `business-days` | 💼 | Business days | The days from today to the date given and the weekdays (Monday to Friday) among them | a date, e.g. 2026-12-25, +2w, +3m; a month from today when left out | local | — |
| `wareki` | 🎌 | Japanese era | Converts between Western years and Japanese era years (from Meiji on) | a year or a Japanese era year, e.g. 2026, 令和8, R8, H31; this year and the eras when left out | local | — |
| `year-progress` | 📶 | Year progress | How much of this year, month, week and day has gone by, as bars and percentages | none | local | — |
| `time-after` | ⏩ | Time after | The time a duration from now | a duration from 1 second to 24 hours, e.g. 90m, 2h, 1h30m; an hour when left out | local | — |
| `duration-convert` | ⌚ | Convert a duration | A duration as hours, minutes and seconds, as a total in each unit, and in ISO 8601 | a duration from 1 second to 24 hours, e.g. 90m, 1h30m, 5400s; 90 minutes when left out | local | — |
| `sleep-calc` | 😴 | Bedtime calculator | Bedtimes for a wake-up time: 6 down to 3 sleep cycles of 90 minutes, plus 15 minutes to fall asleep | the time to wake up, HH:MM on the 24-hour clock; 07:00 when left out | local | — |
| `moon-phase` | 🌕 | Moon phase | The moon's age and phase now, and the days to the next new and full moon (roughly) | none | local | — |

#### Random and generated

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `uuid` | 🆕 | UUID | Five UUIDs | v4 (random) or v7 (the time and random); v4 when left out | local | — |
| `ulid` | 🧿 | ULID | Five ULIDs | none | local | — |
| `nanoid` | 🔟 | Short ID (Nano ID) | Five short IDs of URL-safe characters (Nano ID) | a length from 4 to 64; 21 when left out | local | — |
| `password` | 🔑 | Password | Three passwords with every kind of character, with their estimated entropy | a length from 8 to 128; 20 when left out | local | — |
| `passphrase` | 🔏 | Passphrase | Three passphrases of built-in words joined by hyphens, with their estimated entropy | a number of words from 3 to 10; 5 when left out | local | — |
| `random-token` | 🎫 | Random token | Random bytes in hexadecimal and Base64URL | a number of bytes from 8 to 256; 32 when left out | local | — |
| `dice` | 🎲 | Roll dice | Rolls dice: each die and the total | NdM or NdM+K, e.g. 2d6+1 (N from 1 to 100, M from 2 to 1000, K from 0 to 10000); 1d6 when left out | local | — |
| `coin-flip` | 🪙 | Flip a coin | Flips a coin once | none | local | — |
| `random-number` | 🔢 | Random number | A whole number from 1 to N | the largest number N, from 2 to 1000000000; 100 when left out | local | — |
| `pick-one` | 👉 | Pick one | Picks one of the candidates | 2 to 100 candidates separated by commas or spaces, e.g. sushi, ramen, curry; yes or no when left out | local | — |
| `shuffle` | 🔀 | Shuffle | The candidates in a random order, numbered | 2 to 100 candidates separated by commas or spaces, e.g. Alice Bob Carol; 1 to 10 when left out | local | — |
| `random-color` | 🌈 | Random colors | Five random colours as HEX, RGB and HSL | none | local | — |
| `lorem` | 📃 | Lorem ipsum | Paragraphs of Lorem ipsum | a number of paragraphs from 1 to 20; 3 when left out | local | — |
| `dummy-ja` | 🎎 | Japanese dummy text | Paragraphs of meaningless Japanese, for checking a layout | a number of paragraphs from 1 to 20; 3 when left out | local | — |
| `break-idea` | 🧘 | Break idea | One short way to spend a break | none | local | — |

#### Calculations and conversions

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `calc` | 🧮 | Calculator | Works out an expression | an expression, e.g. (1+2)*3, 2^10, sqrt(2); what can be written, with examples, when left out | local | — |
| `unit-convert` | 📏 | Convert units | Converts a value between units of one quantity (length, weight, temperature…) | &lt;value&gt; &lt;unit&gt; &lt;unit&gt;, e.g. 10 km mi, 100 F C, 5 kg lb; a table of common conversions when left out | local | — |
| `base-convert` | 🔃 | Number bases | A whole number in bases 2, 8, 10 and 16 | a whole number, e.g. 255, 0xff, 0b1010, 0o17; 255 when left out | local | — |
| `byte-size` | 💽 | Data size | A data size in bytes and in decimal (KB…) and binary (KiB…) units | a data size, e.g. 1GiB, 500MB, 123456789; 1GiB when left out | local | — |
| `tax-calc` | 💴 | Consumption tax | Japanese consumption tax at 10% and 8%, from the amount before and with tax (fractions of a yen rounded down) | an amount in yen from 0 to 1000000000000; 1000 when left out | local | — |
| `split-bill` | 🧾 | Split the bill | Each person's share of a bill and the remainder, and how to collect it rounded up to 1 or 100 yen | &lt;amount&gt;/&lt;people&gt;, e.g. 10000/3 (2 to 1000 people); 10000/3 when left out | local | — |
| `factorize` | 🧩 | Factorize | Prime factors, the count and list of divisors (up to 100), and whether it is prime | a whole number from 2 to 1000000000000; 360 when left out | local | — |
| `roman-numeral` | 🏺 | Roman numerals | Converts between whole numbers and Roman numerals | a whole number from 1 to 3999 or a Roman numeral, e.g. 2024, MMXXIV; 2024 when left out | local | — |
| `number-reading` | 🔣 | Read a number | A number with grouped digits, in Japanese 万 units and kanji, and read in English | a whole number, e.g. 1234567, 1,234,567, below 10^24; 1234567 when left out | local | — |
| `semver-bump` | 🔼 | Next versions | The next patch, minor, major and prerelease versions after a semantic version | a semantic version, e.g. 1.4.2, 2.0.0-rc.1; 1.4.2 when left out | local | — |
| `ip-calc` | 🌐 | Subnet calculator | An IPv4 CIDR block's network, broadcast, host range and count, mask and wildcard | an IPv4 CIDR block, e.g. 10.0.0.0/8; 192.168.0.0/24 when left out | local | — |
| `aspect-ratio` | 📐 | Aspect ratio | The ratio of a width and height in lowest terms, with common sizes of that ratio | &lt;width&gt;x&lt;height&gt;, e.g. 1280x720 (each from 1 to 100000); 1920x1080 when left out | local | — |
| `px-rem` | 🔍 | px and rem | A size in px, rem, em and pt, on a 16px root | a value and unit, e.g. 16px, 1.5rem, 12pt, 2em, on a 16px root; 16px when left out | local | — |
| `chmod-calc` | 🔐 | File permissions | File permissions between octal and symbols, each class's rights spelt out | permissions in octal or symbols, e.g. 644, 4755, rwxr-xr-x; 755 when left out | local | — |

#### Reference tables

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `ascii-table` | 🔡 | ASCII table | The printable ASCII characters (decimal, hexadecimal) and the main control characters | none | local | — |
| `http-status` | 🚦 | HTTP status codes | HTTP status codes: name and meaning | a status code or part of its name, e.g. 404, teapot; the common codes when left out | local | — |
| `mime-types` | 📂 | MIME types | Extensions to MIME types and back | an extension or a MIME type, e.g. json, image/png; the common extensions when left out | local | — |
| `port-numbers` | 🚪 | Port numbers | Port numbers to services and back | a port number or a service name, e.g. 5432, ssh; the main ports when left out | local | — |

#### Ideas

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `brainstorm` | 🌟 | Brainstorm | Ten ideas on a topic | a topic, e.g. a team study session; a random software development topic when left out | complete | sonnet |
| `project-names` | 🔖 | Project name ideas | Ten names for a project, tool or service | what the project is, e.g. a CLI that searches logs; a fictional developer tool when left out | complete | haiku |
| `fermi` | 🤔 | Fermi estimate | A Fermi estimate, with its assumptions and working | a question, e.g. how many elevators there are in Japan; a classic one when left out | complete | sonnet |
| `decision-matrix` | 🧭 | Decision matrix | A weighted decision matrix for the options | the options, e.g. PostgreSQL / MySQL / SQLite; a blank matrix to fill in when left out | complete | sonnet |
| `color-palette` | 🎨 | Color palette | A colour palette of 5 or 6 colours, in a table | a mood or use, e.g. a calm admin dashboard; a general light theme when left out | complete | haiku |
| `sample-data` | 🍱 | Sample data | Fictional sample data as JSON | the data, e.g. 5 orders with id,name,price; 5 users when left out | complete | haiku |

#### Drafting commands and code

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `cron-build` | ⏰ | Build a cron expression | A cron expression for when something should run, each field explained | when to run, e.g. weekdays at 9:30; 10 common examples when left out | complete | haiku |
| `regex-build` | 🧵 | Build a regex | A regular expression for a pattern, explained part by part | the pattern, e.g. a Japanese postal code; 10 common examples when left out | complete | sonnet |
| `shell-oneliner` | 🐚 | Shell one-liner | A shell command that does what you need, each part explained, with pitfalls | what to do, e.g. find logs older than a week; 10 handy one-liners when left out | complete | sonnet |
| `git-recipe` | 🌿 | Git recipe | The git steps to do something, in order | what to do, e.g. undo the last commit; the usual troubles when left out | complete | sonnet |
| `sql-build` | 💾 | Write SQL | SQL for a query, with the dialect and tables it assumes | the query, e.g. monthly sales totals, table definitions welcome; common examples when left out | complete | sonnet |
| `api-design` | 🔌 | API design | A REST API design: its endpoints in a table | a resource or feature, e.g. reservation management; a to-do app when left out | complete | sonnet |
| `schema-design` | 🏢 | Database schema | A database schema: its tables and relations | the domain, e.g. lending at a library; a blog when left out | complete | sonnet |

#### Templates

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `gitignore-template` | 🙈 | .gitignore template | A .gitignore template | languages or environments, e.g. node, python macos; node when left out | complete | haiku |
| `dockerfile-template` | 🐳 | Dockerfile template | A multi-stage Dockerfile template | a language and use, e.g. node, python fastapi; node when left out | complete | sonnet |
| `ci-template` | 🤖 | CI workflow template | A GitHub Actions workflow template that runs the tests and the build | a language, e.g. node, go; node when left out | complete | sonnet |
| `makefile-template` | 🔨 | Makefile template | A Makefile template with the usual targets (build, test, lint, clean…) | the kind of project, e.g. a Go CLI; a general one when left out | complete | haiku |
| `readme-template` | 📘 | README template | A README template (overview, installation, usage, configuration, license…) | what the project is, e.g. a CLI that compresses images; a general one when left out | complete | haiku |
| `pr-template` | 📬 | PR template | A pull request template: summary, changes, how to verify, checklist | the team or project, e.g. a mobile app; a general one when left out | complete | haiku |
| `issue-template` | 🐞 | Issue template | An issue template, for a bug or a feature request | bug or feature; bug when left out | complete | haiku |
| `adr-template` | 📒 | ADR template | An ADR template: title, context, decision, reasons, consequences | the decision, e.g. choosing a state management library; a blank template when left out | complete | haiku |
| `test-plan-template` | 🧪 | Test plan template | A test plan template: scope, what to test, test cases, exit criteria | a feature, e.g. resetting a password; a login feature when left out | complete | haiku |
| `meeting-agenda` | 📢 | Meeting agenda | A meeting agenda | the meeting, e.g. a 30-minute design review; a 30-minute weekly meeting when left out | complete | haiku |
| `email-template` | 📧 | Email template | A business email: subject and body | the purpose, e.g. asking to extend a deadline; 3 common ones when left out | complete | haiku |

#### Conventions and checklists

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `commit-convention` | 📜 | Commit conventions | The Conventional Commits format (types, scope, body, footer, breaking changes), with examples | none | complete | haiku |
| `naming-conventions` | 🔤 | Naming conventions | The common naming conventions of a programming language | a language, e.g. typescript, python; typescript when left out | complete | haiku |
| `code-review-checklist` | ✅ | Code review checklist | A code review checklist: correctness, readability, tests, performance, security | a language or area, e.g. frontend; general when left out | complete | haiku |
| `security-checklist` | 🔒 | Web security checklist | A security checklist for web apps and APIs | the target, e.g. a GraphQL API; web apps and APIs in general when left out | complete | sonnet |
| `debug-checklist` | 🔦 | Debugging checklist | A checklist for isolating a bug: reproduce, minimize, hypothesize, bisect, read the logs | the symptom, e.g. slow only in production; general steps when left out | complete | sonnet |
| `release-checklist` | 🚢 | Release checklist | A checklist of what to confirm before a release | what is released, e.g. an npm package; general when left out | complete | haiku |
| `cheatsheet` | 📋 | Cheat sheet | A cheat sheet of a tool's or language's most used commands or syntax | a tool or language, e.g. git, vim, docker, jq; git when left out | complete | haiku |

#### Learning and knowledge

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `quick-answer` | ❓ | Quick question | Answers a quick question in 5 to 10 lines (with none, a bit of trivia) | a question, e.g. how HTTP/2 and HTTP/3 differ; a bit of trivia when left out | complete | sonnet |
| `compare-tech` | 🆚 | Compare technologies | Compares technologies or tools | what to compare, e.g. REST GraphQL; a classic comparison when left out | complete | sonnet |
| `learning-path` | 🪜 | Learning path | The order in which to learn a subject, in stages | a subject, e.g. Kubernetes; the basics of software development when left out | complete | sonnet |
| `quiz` | 🎯 | Quiz me | A five-question quiz on a subject, the answers at the end | a subject, e.g. HTTP; programming in general when left out | complete | haiku |
| `algorithm` | 🧠 | Explain an algorithm | Explains an algorithm or data structure | an algorithm or data structure, e.g. Dijkstra's algorithm; a well-known one when left out | complete | sonnet |
| `design-patterns` | 🧱 | Design patterns | Explains a design pattern (with none, the main ones) | a design pattern, e.g. Strategy; a list of the main ones when left out | complete | sonnet |
| `english-phrase` | 💬 | English phrases | Five English phrases for a situation | the situation, e.g. asking for a fix in a review; common phrases at work in development when left out | complete | haiku |
| `keigo-phrases` | 🙇 | Polite Japanese phrases | Polite Japanese set phrases (keigo) for a situation | the situation, e.g. turning down a request; common set phrases when left out | complete | haiku |
| `prompt-ideas` | 🪄 | Prompt ideas | Three to five example prompts for asking Claude | the goal, e.g. getting tests written; common requests in development when left out | complete | haiku |

#### Team communication

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `interview-questions` | 🎤 | Interview questions | Ten questions for a job interview | a role or technology, e.g. a backend engineer; software engineers in general when left out | complete | haiku |
| `icebreaker` | 🧊 | Icebreakers | Five short icebreaker questions to open a meeting | none | complete | haiku |
| `one-on-one` | 👥 | 1:1 questions | Ten questions for a one-on-one, grouped by theme | none | complete | haiku |
| `retro-prompts` | 🔄 | Retro prompts | A plan and questions for a team retrospective | a format, e.g. KPT; one is picked when left out | complete | haiku |

#### A break

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `joke` | 🤣 | Joke | One short joke for programmers | a theme, e.g. bugs; any when left out | complete | haiku |
| `senryu` | 🎋 | Senryu | Three senryu (5-7-5 verses, in Japanese) on a developer's day | a theme, e.g. deploying; any when left out | complete | haiku |
| `puzzle` | 🧸 | Puzzle | One logic puzzle or riddle (the answer after a separator) | easy or hard; easy when left out | complete | haiku |
| `pep-talk` | 📣 | Pep talk | A short word of encouragement for a developer at work | none | complete | haiku |

#### Repository surveys

| ID | Icon | Label | What it does | Argument (how to write it, default) | Kind | Model |
| --- | --- | --- | --- | --- | --- | --- |
| `repo-overview` | 🏠 | Repository overview | Sums up the repository in the working directory: purpose, main directories, technologies, entry points | a directory or concern, e.g. src/api; the whole repository when left out | subagent | sonnet |
| `repo-todos` | 📌 | TODO comments | Lists the TODO, FIXME, HACK and XXX comments in the repository by kind | a directory, e.g. src; the whole repository when left out | subagent | sonnet |
| `repo-scripts` | 🏁 | Runnable tasks | Lists the tasks the repository defines (package.json scripts, a Makefile and the like) | none | subagent | sonnet |
| `repo-deps` | 📦 | Repository dependencies | Lists the direct dependencies, for production and for development | none | subagent | sonnet |
| `repo-config` | 🔩 | Config files | Sums up the config files (tsconfig, linters, CI, Docker…): what each is for and its main settings | none | subagent | sonnet |
| `repo-tests` | 🧫 | Test layout | Sums up the tests: where and how they are laid out, the framework, the command, thin spots | a directory, e.g. packages/core; the whole repository when left out | subagent | sonnet |
| `repo-onboarding` | 🎒 | Getting started | Works out from the README and config how to start developing in the repository | none | subagent | sonnet |

## Adding an action

The [`customActions`](#customactions) setting adds actions with no change to the plugin. The hint line, the ⋯ dialog, the pane and the command treat them like the built-ins: one joins the hint line (in the order of use) and can be picked from the ⋯ dialog (a newly added one comes after the built-ins, so while it is past those that fit in the list, type its ID or label in the filter), and putting its ID in `pinActions` pins it to the front.

### From the settings (customActions)

Write the definitions as a JSON array in the [`customActions`](#customactions) setting. The examples below are spread over several lines to read; in `/config`, enter the array on one line.

| Field | Required | Kinds | Meaning |
| --- | --- | --- | --- |
| `id` | yes | all | The ID written in `pinActions` and the command: lowercase letters and digits, joined by single hyphens (`review-pr`). Not a built-in's ID, not `close` (the ✕ button) or `hint` (the command's argument), and not one an earlier custom definition already took |
| `icon` | yes | all | The icon on the hint line (one emoji). A symbol that is text by default (☀, ✂, 🗂 and the like) is drawn as an emoji, with VS16 (U+FE0F) added after it, so that it takes the two columns the terminal draws it in; one already followed by VS16 or VS15 is left as written, and so are ©, ® and ™, drawn as the one-column marks they are |
| `label` | yes | all | The name shown on hover and as the pane heading: one string for both languages, or `{ "ja": "…", "en": "…" }` |
| `kind` | yes | all | How it runs: `complete` / `fork` / `subagent` (as for the built-ins, see [Action list](#action-list); a custom action cannot be local) |
| `target` | no | all | What it works on: `selection` (the default, also when empty), `context` (the conversation, with no selected text; `kind` must then be `fork`) or `none` (a standalone action, on neither the selection nor the conversation; `kind` must then be `complete` or `subagent`). It is shown as `[icon]`, `<icon>` or `{icon}` accordingly |
| `prompt` | yes | all | complete: the system prompt; fork: the instruction that follows the selection (with `target` `context`, the instruction alone); subagent: its system prompt |
| `runningText` | no | all | What the pane shows while it runs, as `label` is written (default "Thinking…" / "考え中…") |
| `model` | complete and subagent | complete, subagent | `haiku`, `sonnet` or `opus` only, lowercase. A fork uses the conversation's model and ignores it |
| `maxTokens` | no | complete | The longest answer, a whole number from 1 to 32000 (default 1500) |
| `task` | subagent | subagent | What opens the request the subagent is spawned with; the selection follows it (with `target` `none`, the argument, or nothing when there is none) |
| `description` | no | subagent | What the subagent type says it is for, as `label` is written (default: built from the label) |
| `tools` | no | subagent | Picked from `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch` (names as written here). Default: `["Read", "Grep", "Glob"]`. A definition naming any other tool is ignored as a whole |

Fields the kind does not use (`tools` on a complete action, for example) and unknown fields are ignored.

**The argument of an action with `target` `none`**: a custom standalone action takes one optional free-text argument of up to 500 characters (its type and default cannot be defined). The argument written in `/quick-actions <id> <argument>` is passed in `<input>…</input>`: as the user's input for complete, after `task` for subagent. Pressed on the hint line or in the ⋯ dialog, it asks for the argument on the [argument screen](#the-argument-screen) (with no default, an empty Enter says it runs with no argument, and the field shows "text"), and what is typed there is passed the same way. With none (an empty field, or a press in the mobile app too), complete is given only a set line saying there is no input, and subagent `task` alone.

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

A standalone action (a complete with `target` `none`: neither the selection nor the conversation, shown as `{🍳}`, and taking an argument as in `/quick-actions recipe chicken onion`):

```json
{
  "id": "recipe",
  "icon": "🍳",
  "label": { "ja": "献立の案", "en": "Recipe ideas" },
  "kind": "complete",
  "target": "none",
  "model": "haiku",
  "prompt": "Suggest three simple dinner recipes. If <input> is given, it lists ingredients to use."
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

The setting holds the array of them: `[{ …pirate… }, { …cause… }, { …standup… }, { …recipe… }, { …review-pr… }]`.

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
- `target` is not `selection` / `context` / `none` (lowercase), is `context` with a `kind` other than `fork`, or is `none` with the `kind` `fork`, such as `target must be one of selection, context, none (given: foo)`, `a definition with target context must have kind fork (given: complete)` or `an action with target none must be complete or subagent (given: fork)`
- `tools` names a tool outside the five above: the whole definition is ignored rather than run without it, since that would run something other than what you wrote

When the setting is not valid JSON, or not an array, every custom definition is ignored. In settings.json the value must be a string (the array in quotes, its quotes escaped): Claude Code does not load the plugin with an unquoted array there. The built-ins work as before in every case. To see what was ignored and why:

- **Run `/quick-actions`** (with or without an ID; nothing need be selected; without an ID it also opens the ⋯ dialog): the result ends with every problem, one per line, such as `#3 (review-pr): tools a subagent cannot have: Bash (…)`. The number is the definition's place in the array, from 1. This always works
- A toast at the start of a session gives the count and the first problem. A change made in `/config` during a session may not show the toast again until the next one: run `/quick-actions` to check
- While the pane is open, the list also shows at its top, in the error colour

#### A word on the tools

- With `WebFetch` / `WebSearch` allowed, the subagent can send the selected text or its argument, and whatever it read with `Read` / `Grep` / `Glob` (any file Claude Code's permissions let it read, not only the repository's), to outside sites: on its own, or steered by instructions written in the selection (prompt injection; the selection is wrapped in `<selected>…</selected>` with any such tag inside it made harmless, and the prompt says it is data, not instructions, as for every action on the selection, but that is no complete defense). Allow them only for actions you will run on text you trust, and keep the default read-only tools otherwise
- Tools that run commands or change files (`Bash`, `Write`, `Edit` and the like) are not accepted in `customActions`

### Built-in actions and the catalog page

The [action catalog](https://imahiro-t.github.io/quick-actions/) (`docs/index.html`) is a static page with no build step; its data, `docs/actions-data.js`, is generated from the definitions in `hooks/actions.ts`, never written by hand.

- When adding or changing a built-in action in `ACTIONS`, give it a `category` (the ID of one of `CATEGORIES` in `hooks/catalog.ts`, of the same kind as the action) and a `summary` (its one-line description, `{ ja, en }`, as in the tables above)
- Then regenerate the data with `node scripts/gen-catalog.mjs` at the root of the repository and commit `docs/actions-data.js`. The script needs Node 24 or later (it imports the TypeScript sources as they are); with asdf, for one: `ASDF_NODEJS_VERSION=24.21.0 node scripts/gen-catalog.mjs`
- `tests/catalog.test.ts` (run by `claude plugin test .`) fails when the data was not regenerated, and when a built-in has no category or summary, or one of another kind

## Roadmap

- Reading custom actions from a file of their own (such as `~/.claude/quick-actions.json`) rather than one setting
- Letting custom subagents use tools that run commands or change files, once their exposure to prompt injection and the permission prompts are worked out

## License

MIT
