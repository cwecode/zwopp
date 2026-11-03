# ADR 0007: A guided editor UI

- Status: accepted
- Date: 2026-11-03

## Context

By version 1.1 the editor had 16 tools side by side in the toolbar, followed by every
option of the current tool, blocks, clipboard, zoom, layers and export. New users were
overwhelmed; the toolbar wrapped on smaller screens. The goal: what matters most is usable
from the first minute, and the rest comes into view over time, without ever being locked
away.

## Decision

1. **Tool families in a rail on the left.** Seven families (Select, Arrow, Shape, Text,
   Steps, Emphasize, Hide; `FAMILIES` in `tools.ts`) take one slot each. A slot shows the
   family's tool used last; the corner triangle or a right-click opens the others. Every
   tool keeps its key. The rail leaves the top bar to the tool's options.
2. **Primary and secondary options.** The top bar shows colour and size, plus what a tool
   cannot work without (the emoji, the stamp, the wand's actions, the number while badges
   are selected). Everything else is behind **More**, captioned by group.
3. **Rare actions move out of the way.** Copy, paste, delete, blocks and the stacking
   order are in a right-click menu (their keys stay); export and dragging are under
   **Share**, next to the one primary button, **Copy image**. The layers panel starts
   closed and remembers its state.
4. **Visibility is guided, functionality never locked.** `guide.ts` keeps, in
   `settings.editor.guide`, how often each tool was picked, which tool each family shows,
   which tips were seen and which family menus were opened:
   - A family used often whose other tools were never used gets a dot on its triangle,
     until its menu is opened; unused tools are marked *New* in the menu.
   - Tips appear one at a time, each once, when they become useful (`nextTip`), e.g. the
     Shift+click repeat after a few step numbers.
   - **Show every tool on its own** brings back one slot per tool; **Show tips again**
     resets the tips and dots.

## Consequences

- The toolbar fits on small screens and changes little between tools.
- The guide state is per user and machine, stored like the quick styles; there is no
  account and nothing is sent anywhere.
- New tools join a family; a new family needs a strong reason, to keep the rail short.
