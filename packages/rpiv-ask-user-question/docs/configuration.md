# Configuration

Every setting the package reads, where the file lives, and what happens when a value is
wrong.

## The config file

```
~/.config/rpiv-ask-user-question/config.json
```

The file is optional — with no config at all, every setting takes its default. This
package only ever *reads* the file; it never creates, writes or chmods it, so its
permissions are whatever you give it.

A complete example:

```json
{
  "collapseKey": "alt+o",
  "autoSubmit": false,
  "multiSelectCustom": "exclusive",
  "guidance": {
    "description": "Ask the user structured questions whenever requirements are ambiguous.",
    "promptSnippet": "Ask me before guessing on anything ambiguous",
    "promptGuidelines": [
      "Batch every clarifying question into one ask_user_question call.",
      "Put your recommended option first and suffix it with (Recommended)."
    ]
  }
}
```

### Where the file is looked up

1. `$XDG_CONFIG_HOME/rpiv-ask-user-question/config.json`, if `XDG_CONFIG_HOME` is set,
   non-empty and absolute. A leading `~` is expanded first; a relative value is ignored.
   Unset or ignored, the directory falls back to `~/.config`.
2. If that file does not exist, the legacy path `~/.config/rpiv-ask-user-question/config.json`
   is read. This path deliberately ignores `XDG_CONFIG_HOME`, so an existing config keeps
   working after you set the variable.
3. Neither present: all defaults.

If the XDG-path file exists, its result wins even when it is malformed — there is no
second chance at the legacy path.

### When the file is invalid

Malformed JSON is not fatal. The loader warns on stderr and continues with defaults:

```
rpiv-config: invalid JSON at <path>, using default ({}) — <parser message>
```

Valid JSON that is not an object (a string, number, `null`, or an array) is rejected too,
falling back to defaults — but silently, with no warning. Individual keys with the wrong
type are likewise dropped back to their default without a warning.

## Settings

| Setting | What it does | Default |
| --- | --- | --- |
| `collapseKey` | Key that collapses and expands the dialog overlay. | `"ctrl+]"` |
| `autoSubmit` | Submit a fully answered single-select batch without visiting the review tab. | `false` |
| `multiSelectCustom` | `"exclusive"` replaces checkboxes with custom text; `"combine"` permits both. | `"exclusive"` |
| `guidance.description` | Full text of the tool description the model sees. Replaces the built-in default entirely — no merging. | built-in description |
| `guidance.promptSnippet` | One-line snippet describing the tool in the system prompt. | built-in snippet |
| `guidance.promptGuidelines` | List of usage guidelines given to the model. | 4 built-in guidelines |

### `collapseKey`

The value uses Pi's keybinding id format: zero or more distinct modifiers from `ctrl`,
`shift`, `alt`, `super`, joined by `+`, followed by a base key. Values are trimmed and
lowercased before matching.

The base key is either a single printable character from
`a-z 0-9 _ - ! @ # $ % ^ & * ( ) | ~ \` ' " : ; , . / < > ? [ ] { } = \`, or one of the
named keys `escape`, `esc`, `enter`, `return`, `tab`, `space`, `backspace`, `delete`,
`insert`, `clear`, `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`,
`f1`–`f12`.

Examples that work: `"ctrl+]"`, `"alt+o"`, `"ctrl+shift+h"`, `"f9"`, `"ctrl+}"`.

Set `"off"` (any casing) to disable the collapse shortcut entirely — no raw terminal
listener is registered in that case.

A spec that does not match the grammar is rejected and the default is used. This is
strict on purpose: Pi's parser takes the last `+`-separated part as the key and ignores
unknown parts, so a typo like `"ctr+]"` would otherwise silently capture every bare `]`
keypress at the terminal level.

The footer hint inside the dialog names whatever key you configure (`Alt+O to collapse`
for `"alt+o"`), as do the collapsed one-line footer and the one-shot notification shown
when the dialog is first hidden. With `"off"` the collapse hint is dropped from the
footer entirely, since no shortcut can fire.

### `autoSubmit`

Only the boolean `true` opts in. A multi-question dialog skips review when confirming
its last single-select question if every question is answered, all questions are
single-select, and no other tab has an unconfirmed custom draft. Skipped questions,
multi-select questions, or pending revisions keep the review step. A single question
already submits immediately, as before. Notes that were written are included either
way. This option applies to the terminal questionnaire; RPC dialogs have no review tab.

### `multiSelectCustom`

`"exclusive"` preserves the original contract: confirming custom text replaces the
checkbox answer and clears the selected boxes. `"combine"` keeps boxes checked and
lets Enter commit a custom choice without leaving the question. The custom row shows
a checked box after committing. Use Next/Submit to finish the question; clear the text
with Ctrl+U and confirm again to remove only the custom choice. Unconfirmed drafts
remain editable but are never silently included in the result. The additive
`customAnswer` field carries confirmed text on a `kind: "multi"` answer.

RPC hosts use `1,3; custom text` to combine choices and text. Without a valid numeric
prefix, the entire input remains custom text. Invalid configuration values fall back
to `"exclusive"`. Interaction settings are read for each new questionnaire.

### `guidance.description`, `guidance.promptSnippet` and `guidance.promptGuidelines`

`guidance.description` replaces the entire built-in description Pi registers for the
`ask_user_question` tool — the text the model reads when deciding how to use it. There is
no merging: a valid value wins wholesale. It is used only when it is a non-empty string;
anything else falls back to the built-in default. Like the other guidance fields it is read
once, when the extension registers the tool, so changes take effect on the next Pi restart.

These replace the text Pi puts in the system prompt about when to reach for
`ask_user_question`. Use them to make the model ask more or less often, or to enforce a
house style for options.

`promptSnippet` is used only when it is a non-empty string. `promptGuidelines` is used
only when it is a non-empty array whose entries are all non-empty strings. Anything else
falls back to the built-in defaults. Both are read once, when the extension registers the
tool, so changes take effect on the next Pi restart.

## Environment variables

| Variable | Effect |
| --- | --- |
| `XDG_CONFIG_HOME` | Relocates the config directory, as described above. Must be absolute. |

`LANG` and `LC_ALL` influence the dialog language, but they are read by
[`@juicesharp/rpiv-i18n`](https://www.npmjs.com/package/@juicesharp/rpiv-i18n) rather than
by this package — see [localization.md](./localization.md).

No other environment variables are read. The package makes no model calls, so it needs no
API keys or model settings of its own.
