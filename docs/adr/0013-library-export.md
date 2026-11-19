# ADR 0013: Exporting the whole library

- Status: accepted
- Date: 2026-11-19

## Context

The library folder already uses common formats (PNG, GIF, JSON; the SQLite file is only an
index). But its layout is Zwopp's: folders named by id, titles and tags only in
`item.json`. Moving to other software, or handing everything to an agent, should not
depend on Zwopp or on reading its code.

## Decision

1. **One export of everything** (`archive::export_library` in `zwopp-core`), from
   *Settings › Library › Export library …*, `zwopp export-library <dir>` and the MCP tool
   `export_library`. It creates a new folder `Zwopp-Export <date>` (numbered if it exists).
2. **Layout** (`zwopp-export/1`):
   - `images/<date> <time> <title>.png|gif`: every screenshot as Zwopp shows it
     (annotated if edited), names sortable by date and unique.
   - `originals/`: the untouched captures of annotated screenshots;
     `annotations/<name>.json` (+ `.assets/`): the vector annotations.
   - `screenshots.json`: format, export time, and every field per screenshot, oldest
     first; `screenshots.csv`: the same as a table (RFC 4180, UTF-8 with byte order
     mark for Excel, tags joined with `; `); `README.md`: explains it all.
3. **Metadata travels with the images.** Each PNG carries XMP (an iTXt chunk after the
   header): `dc:title`, `dc:subject` (tags), `xmp:CreateDate`/`ModifyDate`, `dc:source`
   (the application), `xmp:Rating` 5 for favorites. Photo and asset managers (Lightroom,
   digiKam, Bridge, Eagle …) read these on import, so a folder of images alone keeps them.
   GIFs carry none; their metadata is in the listings.
4. Dates are ISO 8601 in UTC, to the second.

## Consequences

- Anything that reads images, JSON or CSV can take over a Zwopp library; agents read the
  README and `screenshots.json`.
- Annotations stay editable only in Zwopp; elsewhere they are part of the image.
- An import of such a folder (and of other tools' libraries) would be the counterpart.
