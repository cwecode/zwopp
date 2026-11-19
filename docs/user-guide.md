# Zwopp user guide

Zwopp takes screenshots, keeps them in a library and lets you annotate them. This
guide covers everything in version 1.2. The keyboard shortcuts name Windows/Linux keys;
on macOS use ⌘ for Ctrl and ⌥ for Alt.

## Install and first start

Download the file for your system from the
[Releases](https://github.com/cwecode/zwopp/releases) page:

| System | File |
|---|---|
| Windows 10/11 | `Zwopp-windows-x64-setup.exe` (or the `.msi`) |
| macOS, Apple silicon | `Zwopp-macos-apple-silicon.dmg` |
| macOS, Intel | `Zwopp-macos-intel.dmg` |
| Linux | `Zwopp-linux-x86_64.AppImage` (any distribution), `Zwopp-linux-amd64.deb` (Debian/Ubuntu) or `Zwopp-linux-x86_64.rpm` (Fedora) – Ubuntu 24.04, Debian 13 or similarly recent |

The downloads are not signed, so your system asks once before the first start:

- **Windows:** "Windows protected your PC" → *More info* → *Run anyway*.
- **macOS:** open the `.dmg`, drag Zwopp into *Applications*, then right-click it →
  *Open* (or *System Settings → Privacy & Security → Open Anyway*). On the first capture,
  allow *Screen Recording* for Zwopp and start it again.
- **Linux:** make the AppImage executable (`chmod +x Zwopp*.AppImage`) and start it.
  On Wayland the desktop asks for permission on the first capture.

To check a download, compare it with `SHA256SUMS.txt` from the same release.

**Updates:** Zwopp looks for a new version now and then. When there is one, a small card in
the bottom right corner of the library offers it with **Install and restart**, a dot marks
the settings button, and the tray menu has an entry for it. Nothing is installed until you
click; then the update is downloaded, checked against the project's signature and
installed, and Zwopp starts again. ✕ hides the card until the next start. In *Settings ›
General › Updates*, **Check for updates** becomes **Install Zwopp x.y** when it finds one.

Zwopp runs in the system tray (menu bar on macOS). Closing the window keeps it
running; quit from the tray menu. To have it ready after every login, turn on
**Settings › General › Start at login**: Zwopp then starts in the tray, without a window.
While it waits it uses no CPU; a closed window gives back its memory after two minutes.
Starting Zwopp a second time brings the running one to the front.

On the first start a short setup asks for the language and the capture hotkey and offers
*Start at login*. **Skip** keeps the defaults; everything can be changed later in the
settings.

## Taking a screenshot

Start a capture with the hotkey (**Ctrl+Shift+X** by default; the library toolbar shows the
active one), the tray menu or **Screenshot** at the top of the window.

The screen freezes, so menus and tooltips stay as they were. Then:

| Action | Captures |
|---|---|
| Drag | the region, also across monitors |
| Click | the window under the mouse |
| Shift+click | the whole monitor |
| Esc or right-click | nothing (cancel) |

The bar at the bottom of the screen switches the **mode** (also with ← / → or Tab):

- **Screenshot:** as described here.
- **Panorama:** for content longer than the screen, e.g. a web page or a chat. Select the
  area that scrolls, then scroll down in it with the mouse wheel; Zwopp joins everything
  into one tall image. If the bar next to the area says you scrolled too far, scroll back
  a little. **Done** (or the hotkey again) ends it.
- **GIF:** for short click sequences. Select the area, then click through what you want
  to show; the mouse pointer and clicks are recorded. **Done** (or the hotkey) saves the
  GIF, at most 60 seconds. Copy it (Windows), drag it or export it to send it; it stays
  animated. GIFs cannot be edited yet.

The mode stays for the next capture. On the right of the bar, **Library** and **Editor**
(the newest screenshot) leave the capture for the app: one hotkey gets you everywhere.

A magnifier at the cursor helps to hit the exact pixel. For menus that close when you
press a key, use a delay: **Take screenshot with delay** in the tray menu or the menu
▾ next to **Screenshot**.

Every screenshot is saved to the library, copied to the clipboard and opened in the
editor. The settings turn copying and opening off.

## The library

The bar at the top of the window has **Library**, **Editor** and **Screenshot** (a new
capture) in every view – the library, the editor, the settings and *Report a problem* –
always at the same place. **Editor** opens the screenshot you edited last, or the
newest one.

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

The tools are down the left edge, in eight families: **Select, Arrow, Shape, Text,
Callout, Steps, Emphasize, Hide**. A family shows the tool you used last; the small triangle in its
corner (or a right-click) opens its other tools. Every tool also has a key (below), which
works whatever the family shows. If you'd rather see every tool on its own, turn on
**Settings › Editor › Show every tool on its own**.

The bar at the top shows colour and size; everything else a tool can do is under
**More**. With shapes selected, the bar changes them. A right-click on the screenshot
offers copy, paste, delete, blocks and the stacking order; **Share** copies, exports or
drags the image. Now and then a tip at the bottom explains something useful, once;
**Settings › Editor › Show tips again** brings them back.

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
| P | Pen | Draw freehand |
| F | Fill | Click fills an area of similar colour; **Tolerance** sets how similar |
| W | Magic wand | Click picks an area of similar colour, Shift+click adds more. **Delete selection** makes it transparent; **Keep only the selection** removes everything else and trims the image — to cut out an icon or a button with a transparent background |
| S | Emoji sticker | Pick one of 40 emojis |
| M | Magnifier | Drag over a detail: an enlarged copy appears next to it |
| H | Highlighter | |
| B | Pixelate | Hides what is underneath, also in copies and exports |

Drawing outside the screenshot grows the canvas (with a transparent background). Mark an
area with the select tool and press **Del** to delete what is in it.

### Quick styles

A quick style stores a tool's colour, size and shape under a name. Set up a style, then
choose **More › Save as quick style**. A click on a quick style — or the keys
**1** to **9** — applies it to the tool and to selected shapes. Rename, delete, export
and import quick styles in the settings, e.g. to share a team style as a file.

Independently of quick styles, every tool starts with the style you used last.

### Layers and blocks

The layers panel (**Layers**, closed at first) lists every element. Add layers, hide or lock them, move
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
- **Appearance:** light, dark or like the system.
- **Start at login:** Zwopp starts in the tray when you log in.
- **Hotkey:** click **Change** and press the new combination. It needs Ctrl/⌘ or Alt,
  except for function keys and Print. Combinations you need elsewhere are refused, with
  the reason: plain keys while typing, app shortcuts like Ctrl+C or Ctrl+S, and system
  keys like Alt+Tab or the Windows key. If another app already uses it, the old hotkey
  stays. On Windows, **Use the Print key for Zwopp** takes it over from the Snipping Tool
  (**Give it back to the Snipping Tool** returns it); Windows may need a new sign-in.
  Win+Shift+S stays with Windows. **Default** takes the first free one of Ctrl+Shift+X, Ctrl+Alt+X and
  Ctrl+Shift+2.
- **After a capture:** copy to the clipboard, open in the editor.
- **Library folder:** applies after a restart (**Restart now**). Existing screenshots stay
  in the old folder; move them yourself if you want them in the new one.
- **Tool styles:** reset every tool to its default style.
- **Quick styles:** rename, delete, export, import.

## Command line and AI agents

The Zwopp executable also takes commands, on Windows, macOS and Linux. To type `zwopp` in
a terminal, run the command *Settings › AI agents and command line › Terminal* shows for
your system once (Windows: adds Zwopp's folder to your PATH; macOS: a link in
`/usr/local/bin`; Linux: a link in `~/.local/bin`, not needed for the .deb and .rpm).

| Command | Does |
|---|---|
| `zwopp capture` | Takes a screenshot without the overlay and saves it to the library. `--screen N` a monitor (default: the primary one), `--window TEXT` the topmost window whose title or application contains TEXT, `--focused` the active window, `--region X,Y,W,H` a rectangle; `--title`, `--tag` (repeatable), `--out file.png` also saves a copy |
| `zwopp list` | The newest screenshots; `--search`, `--app`, `--favorites`, `-n 50` |
| `zwopp show ID` | One screenshot's details |
| `zwopp export ID file.png` | Saves it as PNG, JPG, WebP or GIF (by the extension) |
| `zwopp export-library FOLDER` | Exports the whole library (see *Where Zwopp keeps its files*) |
| `zwopp windows`, `zwopp monitors` | What `capture` can take |
| `zwopp open ID` | Opens it in the editor |

`--json` gives output for scripts; `zwopp --help` and `zwopp capture --help` explain more.

**AI agents** use the same commands; they need an agent that can run terminal commands.

- **Claude Code: Install skill** in *Settings › AI agents and command line*. Puts a short
  guide into `~/.claude/skills/zwopp` that tells Claude Code when and how to run Zwopp,
  with the path of your installation. It takes context only when a task needs
  screenshots. **Update** after moving Zwopp, **Remove** takes it out again.
- **Other agents with a terminal:** make `zwopp` a terminal command (above); agents that
  read Agent Skills can use [`skills/zwopp`](../skills/zwopp) too.

The agent can then take screenshots of the screen, a window or a region, search your
library, look at a screenshot, export it, and open one in the editor for you to
annotate. Zwopp itself sends nothing anywhere; what a connected agent does with a
screenshot it looks at is up to that agent. Your agent asks before it runs Zwopp; every screenshot it takes lands in your
library like your own, where you can delete it.

## Where Zwopp keeps its files

| | Windows | macOS | Linux |
|---|---|---|---|
| Library (default) | `%APPDATA%\digital.weier.zwopp\library` | `~/Library/Application Support/digital.weier.zwopp/library` | `~/.local/share/digital.weier.zwopp/library` |
| Settings | `%APPDATA%\digital.weier.zwopp\settings.json` | `~/Library/Application Support/digital.weier.zwopp/settings.json` | `~/.config/digital.weier.zwopp/settings.json` |

**Export everything:** *Settings › Library › Export library …* writes a folder any
software understands: every screenshot with a readable name (`2026-11-03 18-10-35
Login error.png`), title, tags, date and favorite (as 5 stars) stored in the images as
XMP metadata, plus `screenshots.json`, `screenshots.csv` and a README. Use it for backups
or to move to other software. From a terminal: `zwopp export-library <folder>`.

Back up the library folder to keep your screenshots. Uninstalling Zwopp keeps it,
unless you tell the Windows uninstaller to delete the app data.

## Problems

- **The hotkey does nothing:** another app may use it. Pick another one in the settings.
- **macOS shows only the desktop background:** allow *Screen Recording* for Zwopp in
  *System Settings → Privacy & Security*, then restart Zwopp.
- **Something else:** choose **Report a problem …** in the tray menu or the settings. Zwopp
  shows what it would add (version, system, the last lines of its log without your user
  name) and opens a filled-in form on [GitHub](https://github.com/cwecode/zwopp/issues);
  you check it there and submit it, nothing is sent before. Ideas go the same way with
  **Suggest an idea**. Without a GitHub account, **Copy details** puts the same text on the
  clipboard.
