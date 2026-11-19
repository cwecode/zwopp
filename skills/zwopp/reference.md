# Zwopp command reference

Every command prints human-readable text; add `--json` for structured output.
`zwopp <command> --help` lists the options.

## capture

Takes a screenshot without the overlay and saves it to the library.

| Option | |
|---|---|
| `--screen N` | Monitor `N` (index from `zwopp monitors`); default: the primary monitor |
| `--window TEXT` | The topmost window whose title or application contains `TEXT` (any case) |
| `--focused` | The window with the keyboard focus |
| `--region X,Y,W,H` | A rectangle in desktop pixels, also across monitors |
| `--title TEXT` | Title in the library |
| `--tag TEXT` | A tag; repeat for several |
| `--out FILE` | Also save a copy (format by extension) |

Only one of `--screen`, `--window`, `--focused`, `--region`.

JSON output: `{ "id", "title", "createdAt", "app", "width", "height", "tags",
"favorite", "annotated", "animated", "file" }`. `file` is the image in the library
(the annotated version once edited; the GIF for a recording).

## list

`zwopp list [--search WORDS] [--app NAME] [--favorites] [-n LIMIT] [--json]` – newest
first. The search matches title and tags, every word, also parts of words.

## show

`zwopp show ID [--json]` – one screenshot.

## export

`zwopp export ID FILE` – writes PNG, JPG, WebP or GIF by the extension (PNG if none).
A GIF recording exported as `.gif` stays animated; other formats get its first frame.

## windows, monitors

`zwopp windows [--json]` – visible windows, topmost first: `id`, `title`, `app`,
`rect` (`x`, `y`, `width`, `height`), `focused`.
`zwopp monitors [--json]` – monitors with `x`, `y`, `width`, `height`, `isPrimary`.

## open

`zwopp open ID` – shows the screenshot in the Zwopp editor (starts Zwopp if needed).

## mcp

`zwopp mcp` – the same as an MCP server over stdio, for agents without a terminal.

## Exit codes

`0` success, `1` failure (message on stderr), `2` wrong usage.
