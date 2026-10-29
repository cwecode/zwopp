# Zwopp user guide

Zwopp takes screenshots, keeps them in a library and lets you annotate them. This
guide covers everything in version 1.0. The keyboard shortcuts name Windows/Linux keys;
on macOS use ⌘ for Ctrl and ⌥ for Alt.

## Install and first start

Download the file for your system from the
[Releases](https://github.com/cwecode/zwopp/releases) page:

| System | File |
|---|---|
| Windows 10/11 | `Zwopp_<version>_x64-setup.exe` (or the `.msi`) |
| macOS, Apple silicon | `Zwopp_<version>_aarch64.dmg` |
| macOS, Intel | `Zwopp_<version>_x64.dmg` |
| Linux | `.AppImage` (any distribution), `.deb` (Debian/Ubuntu) or `.rpm` (Fedora) – Ubuntu 24.04, Debian 13 or similarly recent |

The downloads are not signed, so your system asks once before the first start:

- **Windows:** "Windows protected your PC" → *More info* → *Run anyway*.
- **macOS:** open the `.dmg`, drag Zwopp into *Applications*, then right-click it →
  *Open* (or *System Settings → Privacy & Security → Open Anyway*). On the first capture,
  allow *Screen Recording* for Zwopp and start it again.
- **Linux:** make the AppImage executable (`chmod +x Zwopp*.AppImage`) and start it.
  On Wayland the desktop asks for permission on the first capture.

To check a download, compare it with `SHA256SUMS.txt` from the same release.

Zwopp runs in the system tray (menu bar on macOS). Closing the window keeps it
running; quit from the tray menu.

## Taking a screenshot

Start a capture with the hotkey (**Ctrl+Shift+X** by default; the library toolbar shows the
active one), the tray menu or **New screenshot** in the library.

The screen freezes, so menus and tooltips stay as they were. Then:

| Action | Captures |
|---|---|
| Drag | the region, also across monitors |
| Click | the window under the mouse |
| Shift+click | the whole monitor |
| Esc or right-click | nothing (cancel) |

A magnifier at the cursor helps to hit the exact pixel. For menus that close when you
press a key, use a delay: **Take screenshot with delay** in the tray menu or the delay
next to **New screenshot**.

Every screenshot is saved to the library, copied to the clipboard and opened in the
editor. The settings turn copying and opening off.

## The library

- The sidebar on the left shows all screenshots, the **favorites**, the **last 7 days**,
  each **year and month**, and the **applications** they were taken in, with counts. Click
  ▸ to open a year or the applications.
- **Search** above it finds titles and tags, within what the sidebar shows.
- Click a screenshot to see it larger and to set its title and tags (separate tags with
  commas). Double-click or **Edit** opens it in the editor.
- **Copy** puts it on the clipboard, **Export …** saves it as PNG, JPG or WebP.
- Drag a screenshot into another app (mail, chat, Word, Paint …) to hand it over as a
  PNG file.
- **Delete** removes it from the library and the disk.

The library lives in a folder of its own (see Settings); each screenshot is a subfolder
with the untouched original, the annotations and the finished image.

## The editor

Pick a tool in the toolbar or with its key, then draw on the screenshot. Colour, size and
the tool's other options follow the toolbar; with shapes selected, the toolbar changes
them.

| Key | Tool | |
|---|---|---|
| V | Select | Click to select, Shift+click to add, drag on an empty area to mark it |
| A | Arrow | Choose heads at one, both or no end, filled or open |
| L | Line | |
| R / E | Rectangle / Ellipse | Outlined or filled |
| T | Text | Three fonts, optionally on a coloured background; double-click to edit |
| C | Callout | A text bubble; drag its tip to point at something |
| N | Step number | Each click places the next number, Shift+click the last one again. **Fixed** stamps the same number every time; with badges selected, − / + renumbers them |
| K | Stamp | Mouse symbols for instructions: left, right, double and middle click, scroll, drag |
| S | Emoji sticker | Pick one of 40 emojis |
| M | Magnifier | Drag over a detail: an enlarged copy appears next to it |
| H | Highlighter | |
| B | Pixelate | Hides what is underneath, also in copies and exports |

Drawing outside the screenshot grows the canvas (with a transparent background). Mark an
area with the select tool and press **Del** to delete what is in it.

### Quick styles

A quick style stores a tool's colour, size and shape under a name. Set up a style, then
click **+** after the style controls to save it. A click on a quick style — or the keys
**1** to **9** — applies it to the tool and to selected shapes. Rename, delete, export
and import quick styles in the settings, e.g. to share a team style as a file.

Independently of quick styles, every tool starts with the style you used last.

### Layers and blocks

The layers panel (**Layers**) lists every element. Add layers, hide or lock them, move
elements between them. **Ctrl+G** joins the selection into a block that moves as one;
double-click a block to edit single elements, **Ctrl+Shift+G** dissolves it.

### Copy, paste and export

| Key | Action |
|---|---|
| Ctrl+C | Copy the selection – with nothing selected, the whole edit |
| Ctrl+V | Paste as a block, also into another screenshot (open it in the filmstrip below) |
| Ctrl+Shift+C | Copy the finished image to the clipboard |
| Ctrl+Shift+S | Export the finished image as PNG, JPG or WebP |
| ⠿ Drag | Drag the finished image into another app |

### Everything else

| Key | Action |
|---|---|
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+A | Select all |
| Ctrl+↑ / Ctrl+↓ | Bring forward / send backward (with Shift: to front / back) |
| Alt+← / Alt+→ | Previous / next screenshot |
| Ctrl+wheel, Ctrl++ / Ctrl+− | Zoom at the cursor |
| Ctrl+0 / Ctrl+1 | Fit / 100 % |
| Wheel, Space+drag, middle mouse | Pan |

Changes are saved automatically. The original screenshot is never changed, so every
annotation stays editable.

## Settings

Open them with ⚙ in the library or **Settings** in the tray menu.

- **Language:** like the system, German or English.
- **Hotkey:** click **Change** and press the new combination. It needs Ctrl/⌘ or Alt,
  except for function keys and Print. If another app already uses it, the old hotkey
  stays. **Default** takes the first free one of Ctrl+Shift+X, Ctrl+Alt+X and
  Ctrl+Shift+2.
- **After a capture:** copy to the clipboard, open in the editor.
- **Library folder:** applies after a restart (**Restart now**). Existing screenshots stay
  in the old folder; move them yourself if you want them in the new one.
- **Tool styles:** reset every tool to its default style.
- **Quick styles:** rename, delete, export, import.

## Where Zwopp keeps its files

| | Windows | macOS | Linux |
|---|---|---|---|
| Library (default) | `%APPDATA%\digital.weier.zwopp\library` | `~/Library/Application Support/digital.weier.zwopp/library` | `~/.local/share/digital.weier.zwopp/library` |
| Settings | `%APPDATA%\digital.weier.zwopp\settings.json` | `~/Library/Application Support/digital.weier.zwopp/settings.json` | `~/.config/digital.weier.zwopp/settings.json` |

Back up the library folder to keep your screenshots. Uninstalling Zwopp keeps it,
unless you tell the Windows uninstaller to delete the app data.

## Problems

- **The hotkey does nothing:** another app may use it. Pick another one in the settings.
- **macOS shows only the desktop background:** allow *Screen Recording* for Zwopp in
  *System Settings → Privacy & Security*, then restart Zwopp.
- **Something else:** open an issue on
  [GitHub](https://github.com/cwecode/zwopp/issues).
