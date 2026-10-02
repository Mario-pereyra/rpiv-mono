# Keyboard and dialog layout

Every key the questionnaire dialog reacts to, the rows it appends for you, and how it
adapts to the size of your terminal.

## Keys

| Key | What it does | Where it applies |
| --- | --- | --- |
| `↑` / `↓` | Move between rows. Wraps at both ends. | Option list, Submit picker |
| `Enter` | Confirm the focused option, commit typed text, close notes, or activate the focused Submit-picker row. | Everywhere |
| `Shift+Enter` | Insert a newline. | Custom input, notes, discussion |
| `1`–`5` | Activate the matching numbered row; checkbox rows toggle. | Options and Submit picker, never inside text editors |
| `c` | Discuss before answering. | Question tabs and Submit tab, outside text editors |
| `PgUp` / `PgDn` | Page the displayed preview, or the dialog body when there is no scrollable preview. | Outside text editors |
| `Esc` | Cancel the questionnaire; close notes; or return from discussion to questions. | Context-dependent |
| `Tab` / `Shift+Tab` | Next / previous tab, wrapping. `→` / `←` do the same. | Multi-question dialogs only |
| `Space` | Toggle the focused checkbox. | Multi-select questions |
| `n` | Open the notes editor for the focused question — or, on the Submit tab, the global note for the whole questionnaire. | Every question tab; the Submit tab in multi-question dialogs |
| `Ctrl+G` | Open Pi's configured external editor with the current custom-answer draft. | `Type something.` input |
| `Ctrl+U` | Clear the current custom-answer draft. | `Type something.` input |
| `Ctrl+]` | Collapse or expand the dialog. Configurable via `collapseKey`. | Everywhere, including while collapsed |

Navigation, confirmation, cancellation, and text editing follow your Pi keybindings.
Numbers, `n`, `c`, and preview paging are local questionnaire shortcuts.
Confirm listens to both `tui.select.confirm` and `tui.input.submit`, and a key bound to
`tui.input.newLine` always inserts a newline even if it also matches confirm. So a
Slack-style configuration — `enter` folded into `tui.input.newLine`, submit moved to
`ctrl+enter` — keeps working: `enter` breaks lines, and your submit key confirms
everywhere `Enter` does.

In a multi-select question, `Enter` on a regular row toggles its checkbox exactly like
`Space` — it does not submit. Committing the question means focusing the `Next` row and
pressing `Enter`. That is deliberate: it makes `Enter` a zero-cost way to flip boxes
without leaving the home row.

`Space` is suppressed on two rows: `Next` (it is a command, not a choice) and
`Type something.` (it is an inline text input, so the space character belongs to your
answer).

## Mouse

In Pi 1.0 or newer, fullscreen mode also accepts pointer input when your terminal
reports it. Older Pi versions and regular mode keep the keyboard controls above.

| Gesture | What it does |
| --- | --- |
| Hover an option | Highlight it and show its preview without answering or changing keyboard focus |
| Left-click a single-select option | Confirm that option, including clicks on its wrapped description |
| Left-click a multi-select option | Toggle its checkbox without submitting |
| Left-click `Type something.` | Focus the inline editor; never submit an empty answer |
| Left-click `Next` / `Submit` | Commit the multi-select question |
| Left-click `Submit answers` / `Cancel` | Activate that row on the Submit tab |
| Left-click a visible tab | Switch to that question or to review, without submitting |
| Left-click the notes hint | Open the question or global note editor |
| Left-click `c to discuss` | Open the general discussion editor |
| Wheel over the preview | Scroll that preview without moving focus or answering |
| Wheel over the dialog body | Scroll long option descriptions or review content |

The preview column, column gap, borders, and overflow arrows are not option targets.
Hover leaves text editors alone while you type. Notes, discussion, and external-editor
input remain keyboard-driven once open; wheel events are ignored while an editor owns
focus. Keyboard navigation clears hover and recenters the body on its new focus.
Preview scrolling keeps the hover highlight and the keyboard focus separate.

The host recognizes clicks on release, so pressing or dragging cannot confirm an
option. Repeated clicks in the same double-click gesture cannot answer the next
question accidentally. Wheel events outside a scrollable region and modified pointer
events remain available to Pi; the extension does not enable or disable terminal mouse reporting. In terminals
that reserve Shift+drag for native text selection, that escape hatch stays available.
Multiplexers or terminals that do not report unpressed pointer motion can still
support clicks without hover.

## The rows the dialog adds

| Row | Label | Appended to |
| --- | --- | --- |
| Custom answer | `Type something.` | Every question — single-select and multi-select, with or without previews |
| Commit | `Next` | Multi-select questions only |

Focusing `Type something.` switches the row into an inline multiline editor. In preview
mode it expands to the full pane width while you type, so a long custom answer is not
squeezed into the narrow options column. `Shift+Enter` inserts a line break; vertical
arrows move between lines and return to row navigation at the draft's top and bottom.
The draft replaces the static row label while you browse other options and is isolated
per question. `Ctrl+G` round-trips it through Pi's configured external editor; `Ctrl+U`
clears it, while `Esc` remains the explicit way to cancel the questionnaire. Confirming
it produces an answer of `kind: "custom"` by default. With the opt-in
`multiSelectCustom: "combine"` policy, Enter commits it as `customAnswer` alongside
checked labels; Next/Submit finishes the question. A checked custom row displays the
committed choice, not a newer unconfirmed draft; focus it to edit that draft.

Both labels are reserved — the model cannot author an option that collides with them.
Both localize with the rest of the UI chrome; the reserved-label check always compares
against the canonical English strings.

## Notes

`n` opens a notes editor on any question tab, whether the question is single- or
multi-select and whether or not its options carry previews. Notes are stored in a
side-band keyed by tab index, not inside the answer, so writing a note does not mark a
question as answered — the Submit tab still lists it as outstanding. The note merges into
the answer when you confirm it, and reaches the model as `user notes: <text>`.

On the Submit tab, `n` opens the global note editor instead — one note covering the whole
questionnaire. It lives outside every answer, so it survives tab switches and never marks
a question as answered; it reaches the model as `global note: <text>`, and submitting with
nothing but a global note still returns an answered result rather than a decline.

Inside the editor, `Shift+Enter` inserts a newline, while `Esc` and `Enter` close it; other
keystrokes edit the buffer, so `n` types an `n`. Pasted line breaks are preserved.

## Discuss before answering

Press `c` or click its footer hint when no text editor is active. Write a general
message such as “Explain the trade-offs first” rather than an answer to one question.
Enter sends nonempty text as `response`, with the original questions and any partial
answers for context; it is not cancellation. Shift+Enter inserts a newline. Escape
returns to the questions without sending and preserves the discussion draft. This
editor is separate from question notes and from custom-answer drafts.

By default, multi-question answers still pass through review. `autoSubmit: true` can
skip it for fully answered single-select batches with no pending custom revisions;
multi-select and incomplete batches still review. See [configuration.md](./configuration.md).

## Collapse mode

`Ctrl+]` gets the dialog out of the way: the overlay is marked hidden in Pi's overlay
stack and shrinks to a single dim hint row, so the transcript it was covering becomes
readable and chat scrolling resumes. Press the same key to bring the questionnaire back
with your answers intact. The first time you collapse, Pi notifies you with the key to
press — that message names your configured key.

Because Pi routes no input to a hidden overlay, the collapse key is additionally captured
at the raw terminal level. It only acts when the questionnaire is hidden or focused, so a
different overlay on top of it (for example `/btw`) keeps its keystrokes.

While collapsed, every keystroke other than cancel is ignored, so you cannot mutate
answers you cannot see.

The default `ctrl+]` is free in Terminal.app, iTerm2, Warp, tmux, zellij and screen. On
keyboard layouts where `]` sits on the shifted layer — Latin American `es-AR` / `es-MX`,
among others — set a different `collapseKey`, or `"off"` to disable the shortcut.

## Layout

Options render in a vertical list. When any option in a single-select question carries a
`preview`, the dialog splits into a side-by-side layout with the option list on the left
and a bordered monospace preview box on the right — but only when both the terminal and
the dialog pane are at least 100 columns wide. Below that, the preview stacks underneath
the options instead.

When the dialog is taller than the terminal, the body scrolls between a sticky heading and
a sticky footer. Wheel over the body to scroll manually; row navigation and tab changes
restore follow-focus scrolling. Preview offsets are independent per question and option,
clamp on resize, and survive revisiting an option. A preview window uses at most 20 rows
side-by-side or 15 stacked; its paging indicator reports the displayed range and total.
An overflow indicator shows which direction is clipped: `↑` for
content above, `↓` for content below, `↕` for both.

The footer hint line adapts to context — it drops the notes hint and appends the
`Shift+Enter` newline hint whenever a text editor has the keyboard, with `Ctrl+U` still at
the far right for custom answers. It adds the tab hint only in multi-question dialogs. The
Submit tab follows the same idiom: its bottom hint row sits below the picker and carries
an `n to add a note` part that gives way to the `Shift+Enter` newline hint while the
global-note editor is open; a committed note shows as a `Note` entry in the review list.
`Ctrl+G` remains Pi's global external-editor shortcut and is not repeated there. On narrow
terminals the right edge clips with `…` so the core hints survive.
