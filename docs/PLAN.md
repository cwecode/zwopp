# Screenbook – Projektplan

> Arbeitstitel: **Screenbook** – ein schlanker, quelloffener Screenshot‑ und Annotations‑Editor
> für Windows, macOS und Linux.
>
> Stand: 2026‑10‑27 · Status: Phase 1.5 abgeschlossen, Phase 2 als Nächstes

---

## 1. Umfeld: bestehende Open‑Source‑Projekte

| Projekt | Stack | Plattformen | Was fehlt uns |
|---|---|---|---|
| **ksnip** | Qt/C++ | Win/Mac/Linux | Annotationen sehr gut; keine echte Bibliothek, UI altbacken |
| **Flameshot** | Qt/C++ | Win/Mac/Linux | Schnelles Markieren + Zeichnen, aber kein Editor/Bibliothek nachträglich |
| **ShareX** | C#/.NET WinForms | nur Windows | Riesiger Funktionsumfang, nicht cross‑platform, überladen |
| **Greenshot** | C#/.NET | Windows (Mac kostenpflichtig) | Kaum Weiterentwicklung |

➡ Die Lücke: **Bibliothek + nicht‑destruktiver Editor + moderne UI + API, cross‑platform.**
Das rechtfertigt einen Neubau. Ideen/Algorithmen (z. B. Wayland‑Handling) dürfen wir uns dort
anschauen – bei GPL‑Code aber nicht kopieren, wenn wir MIT/Apache lizenzieren.

---

## 2. Ziele & Nicht‑Ziele

**v1 – Ziele**
1. Globaler Hotkey → Bereich markieren (auch Fenster/Vollbild) → Screenshot.
2. Screenshot landet automatisch in einer **Bibliothek** (Thumbnails, Datum, Tags, Suche).
3. **Editor** mit: Pfeil, Linie, Rechteck/Ellipse, Text, Sprechblase/Callout, Marker/Highlighter,
   nummerierte Schritte, Emojis/Sticker, Weichzeichnen/Pixelieren, Zuschneiden, Lupe.
4. Nicht‑destruktiv: Annotationen bleiben jederzeit editierbar.
5. Export: PNG/JPG/WebP, Zwischenablage, Drag‑and‑Drop.
6. Open Source auf GitHub, **kostenlos verteilt** (siehe Abschnitt 4):
   - Start aus dem Quellcode per Terminal (`npm run dev`) für Entwickler.
   - **Unsignierte fertige Downloads** (Windows `.exe`/`.msi`, macOS `.dmg`, Linux AppImage/`.deb`)
     automatisch per GitHub Actions bei jedem Release – kein Code‑Signing, keine Gebühren.

**v2 – Ziele**
- CLI + lokale HTTP‑API + **MCP‑Server** (Screenshots per Skript / KI‑Agent).
- Scrolling‑Capture, OCR (Text aus Screenshot), Bildschirmvideo/GIF, Vorlagen/Themes.

**Nicht‑Ziele (vorerst)**
- Cloud‑Hosting/Sharing‑Server, Teamfunktionen, Videobearbeitung.
- Code‑Signing, Apple‑Notarisierung, Auto‑Updater, Paketmanager (winget, Flathub …).
  Die Architektur (Tauri) lässt das später jederzeit zu, ohne Umbau.

---

## 3. Architektur‑Empfehlung

### 3.1 Stack‑Entscheidung

| Option | Binärgröße | Cross‑Platform | Bewertung |
|---|---|---|---|
| **Tauri 2 (Rust + Web‑UI)** ✅ | ~5–15 MB | Win/Mac/Linux (+ künftig Mobile) | Klein, schnell, sicher, Rust‑Core für Capture, Web‑Tech für Editor. Eingebaute Installer‑, Updater‑, Hotkey‑, Tray‑Plugins. |
| Electron | 100 MB+ | ✅ | Bewährt, aber schwer und RAM‑hungrig – schlecht für ein Tool, das immer im Tray läuft. |
| Qt (C++/Python) | mittel | ✅ | Wie ksnip/Flameshot; mächtig, aber langsamere Entwicklung, UI weniger modern. |
| .NET Avalonia | mittel | ✅ | Gute Option für C#‑Teams; kleineres Ökosystem für Canvas‑Editoren. |

**Empfehlung: Tauri 2** mit
- **Core:** Rust (Capture, Bibliothek, Export, API)
- **UI:** TypeScript + React + Vite
- **Editor‑Canvas:** Konva.js (`react-konva`) – Objekte, Transformer, Hit‑Testing, Export
- **Styling:** Tailwind + shadcn/ui (oder Radix)
- **State:** Zustand, Undo/Redo per Command‑Pattern
- **DB:** SQLite (via `sqlx` oder `rusqlite`)

### 3.2 Schichtenmodell

```
┌─────────────────────────────────────────────────────────────┐
│ Frontends                                                   │
│  ┌──────────────┐  ┌──────────┐  ┌───────────┐  ┌────────┐  │
│  │ Desktop‑UI   │  │ CLI      │  │ HTTP‑API  │  │ MCP    │  │
│  │ (Tauri/React)│  │ (v2)     │  │ (v2)      │  │ (v2)   │  │
│  └──────┬───────┘  └────┬─────┘  └─────┬─────┘  └───┬────┘  │
├─────────┴───────────────┴──────────────┴────────────┴───────┤
│ Application‑Layer: Commands / Use‑Cases  (ein Code‑Pfad!)   │
│  capture_region · capture_window · list_library · tag ·     │
│  render_annotations · export · delete …                     │
├─────────────────────────────────────────────────────────────┤
│ Domain (crate `screenbook-core`)                            │
│  Capture‑Trait · Library‑Repository · Annotation‑Dokument   │
│  · Renderer · Export                                        │
├─────────────────────────────────────────────────────────────┤
│ Plattform‑Adapter                                           │
│  Windows (Graphics Capture / DXGI) · macOS (ScreenCapture   │
│  Kit) · Linux X11 · Linux Wayland (xdg‑desktop‑portal)      │
└─────────────────────────────────────────────────────────────┘
```

**Wichtigster Architekturpunkt:** Alle Funktionen laufen über *eine* Command‑Schicht im Rust‑Core.
Die GUI ruft diese Commands per Tauri‑IPC auf; in v2 rufen CLI, HTTP‑API und MCP **dieselben**
Commands auf. So ist die API in v1 schon „eingebaut“ und muss in v2 nur freigeschaltet werden.

### 3.3 Capture‑Ablauf (so machen es auch andere Tools, z. B. Flameshot)

1. Hotkey gedrückt → **alle Monitore sofort komplett erfassen** (eingefrorenes Bild).
2. Pro Monitor ein randloses, rahmenloses Vollbild‑Overlay‑Fenster mit dem eingefrorenen Bild anzeigen.
3. Nutzer zieht Rechteck / klickt Fenster (Fenster‑Rects vorher vom OS geholt) → Lupe + Pixelmaße.
4. Zuschneiden aus dem Originalbild → speichern in Bibliothek → optional Editor öffnen / Zwischenablage.

Vorteile: kein „Flackern“, Tooltips/Menüs bleiben sichtbar, funktioniert auch unter Wayland
(Vollbild kommt dort über das Portal, das Markieren machen wir selbst).

**Bekannte Stolperfallen**
- **HiDPI / gemischte Skalierung** über mehrere Monitore (Windows 125 % + 100 % etc.) – früh testen.
- **Wayland:** Kein freier Bildschirmzugriff; nur via `xdg-desktop-portal` (Nutzer bestätigt beim
  ersten Mal). Globale Hotkeys unter Wayland über das GlobalShortcuts‑Portal bzw. DE‑Einstellungen.
- **macOS:** Berechtigung „Bildschirmaufnahme“ nötig. Beim Start per Terminal (`npm run dev`) fragt
  macOS die Berechtigung für das **Terminal** ab (einmalig in Systemeinstellungen → Datenschutz →
  Bildschirmaufnahme erlauben). Signierung/Notarisierung ist dafür **nicht** nötig.
  Bei der unsignierten `.dmg` gilt die Berechtigung für die App selbst; einmal Rechtsklick → „Öffnen“
  bzw. Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“.
- **Windows:** Lokal gebaute Programme haben keine „aus dem Internet“‑Markierung → keine
  SmartScreen‑Warnung. Beim unsignierten Download erscheint einmalig „Der Computer wurde durch
  Windows geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“.

Rust‑Bausteine: `xcap` (Screen/Window‑Capture, alle Plattformen inkl. Wayland), `image`,
`tauri-plugin-global-shortcut`, `tauri-plugin-clipboard-manager`, Tray‑API, `tauri-plugin-updater`.

### 3.4 Bibliothek & Datenmodell

```
<AppData>/screenbook/
  library.db                 # SQLite: Metadaten, Tags, Volltextsuche (FTS5)
  items/2026/10/<uuid>/
     original.png            # unverändertes Original (nie überschrieben)
     document.json           # Annotationen (Vektor, versioniert)
     render.png              # gerendertes Ergebnis (Cache)
     thumb.webp              # Thumbnail
```

- **Nicht‑destruktiv:** Original + `document.json` sind die Wahrheit; `render.png` ist nur Cache.
- `document.json` hat ein **versioniertes Schema** (`"schemaVersion": 1`) – offen dokumentiert, damit
  Dritte das Format lesen können (und als Basis für die API).
- Optional später: Export als ein Paket `.sbk` (ZIP mit Original + JSON).

Beispiel `document.json`:
```json
{
  "schemaVersion": 1,
  "canvas": { "width": 1920, "height": 1080 },
  "objects": [
    { "id": "a1", "type": "arrow", "points": [100,100,300,240], "stroke": "#E5322D", "width": 6 },
    { "id": "c1", "type": "callout", "x": 320, "y": 220, "text": "Hier klicken", "tail": [300,240] },
    { "id": "s1", "type": "step", "x": 80, "y": 80, "number": 1 },
    { "id": "e1", "type": "emoji", "x": 500, "y": 400, "char": "👍", "size": 64 },
    { "id": "b1", "type": "blur", "rect": [600,50,200,40], "mode": "pixelate" }
  ]
}
```

### 3.5 Editor

- Werkzeugleiste: Auswahl, Pfeil, Linie, Rechteck, Ellipse, Text, Callout/Sprechblase, Marker,
  Schritt‑Nummer, Emoji/Sticker, Blur/Pixelate, Zuschneiden, Lupe, Stift (Freihand).
- Stile/Presets („Quick Styles“) speicher‑ und teilbar.
- Undo/Redo, Ebenenreihenfolge, Snapping, Tastenkürzel (an verbreitete Gewohnheiten angelehnt, eigene Belegung).
- **Ein Renderer für alles:** Das Rendern von `document.json` → PNG sollte auch im Rust‑Core
  möglich sein (z. B. `tiny-skia`), damit CLI/API ohne GUI exportieren können (v2). In v1 reicht
  der Export aus Konva im Frontend.

### 3.6 API (v2) – ja, macht Sinn

| Schnittstelle | Zweck |
|---|---|
| **CLI** `screenbook capture --region 0,0,800,600 --out shot.png` | Skripte, CI, Doku‑Automatisierung |
| **Lokale HTTP‑API** (nur `127.0.0.1`, Token‑Auth, OpenAPI‑Spec) | Integration in andere Tools |
| **MCP‑Server** | KI‑Agenten (Claude, Cursor …) können Screenshots machen, annotieren, aus der Bibliothek lesen |

Sicherheit: API standardmäßig **aus**, Opt‑in in den Einstellungen, zufälliges Token, nur Loopback.

---

## 4. Repository, Qualität & Releases

**Struktur (Monorepo)**
```
screenbook/
  apps/desktop/          # Tauri‑App (src-tauri/ + React‑UI)
  crates/core/           # screenbook-core: Domain, Capture, Library, Render
  crates/cli/            # v2
  docs/                  # PLAN, ADRs, Spezifikation, Nutzer‑Doku
    adr/                 # Architecture Decision Records
    spec/                # Feature‑Spezifikation
  .github/workflows/     # CI + Release
```

**Verteilung – zwei Wege, beide kostenlos**

So machen es die meisten Open‑Source‑Desktop‑Apps (ksnip, Flameshot, ShareX, OBS …):
Quellcode im Repo **plus** automatisch gebaute Downloads unter GitHub *Releases*.

*Weg A – Fertiger Download (für alle Nutzer)*

Bei jedem Versions‑Tag (`v1.2.0`) baut GitHub Actions mit `tauri-action` auf Windows‑, macOS‑ und
Linux‑Runnern (für öffentliche Repos kostenlos) und hängt die Dateien an das Release:

| OS | Dateien | Erster Start |
|---|---|---|
| Windows | NSIS‑`.exe`, `.msi` | SmartScreen: „Weitere Informationen“ → „Trotzdem ausführen“ |
| macOS | `.dmg` (Apple Silicon + Intel) | Rechtsklick → „Öffnen“ bzw. „Dennoch öffnen“ in Datenschutz & Sicherheit |
| Linux | AppImage, `.deb` | keine Warnung |

Die Builds sind **unsigniert**; das README erklärt den ersten Start mit Screenshots.
Zusätzlich werden SHA‑256‑Prüfsummen veröffentlicht.

*Weg B – Aus dem Quellcode (für Entwickler / Mitwirkende)*

Voraussetzungen (alles kostenlos):
- Git, **Rust** (via `rustup`), **Node.js LTS**
- Windows: WebView2 (in Windows 11 vorinstalliert) + „Visual Studio Build Tools“ (C++‑Workload)
- macOS: Xcode Command Line Tools (`xcode-select --install`) – **kein** Apple‑Developer‑Account
- Linux: `webkit2gtk`‑ und Build‑Pakete (Liste im README pro Distribution)

Starten:
```bash
git clone https://github.com/<org>/screenbook.git
cd screenbook
npm install
npm run dev        # startet die App (Entwicklungsmodus, Hot‑Reload)
```
Optional schneller/schlanker: `npm run build:app` baut eine optimierte, **unsignierte** lokale
Programmdatei (`target/release/screenbook[.exe]`), die man direkt starten kann. Weil sie auf dem
eigenen Rechner gebaut wurde, gibt es weder unter Windows (SmartScreen) noch unter macOS
(Gatekeeper) eine Warnung.

> **Warum keine Gebühren?** Signing/Notarisierung ist für das Verteilen von Binärdateien nicht
> Pflicht – es entfernt nur die Warnung beim ersten Start. Wer selbst baut, sieht gar keine Warnung.
> Signieren erst, wenn das Projekt Nutzer hat: Windows kostenlos über SignPath Foundation,
> macOS über Apple‑Developer‑Account (99 $/Jahr).

**Standards**
- Lizenz: **MIT OR Apache‑2.0** (Rust‑Standard, firmenfreundlich) – alternativ GPL‑3.0, wenn Forks
  offen bleiben sollen. *Entscheidung offen.*
- README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, Issue/PR‑Templates.
- ADRs für jede größere Entscheidung (erste: „Tauri statt Electron“).
- Conventional Commits + `release-please` → automatische Changelogs & Versionen.
- CI (GitHub Actions, Matrix Win/Mac/Linux): `cargo fmt/clippy/test`, `eslint`, `vitest`,
  Playwright‑E2E für den Editor.
- CI prüft bei jedem Pull Request, dass das Projekt auf allen drei OS baut.
- Release‑Workflow: Git‑Tag → `tauri-action` baut unsignierte Downloads → GitHub Release mit
  Changelog (aus `release-please`), Downloads und Prüfsummen.
- Doku‑Website später (z. B. Starlight/Docusaurus auf GitHub Pages).

---

## 5. Roadmap

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0 – Setup & Spike** (≈1 Woche) | Repo, Lizenz, CI‑Gerüst; Tauri‑Skeleton; **Capture‑Spike auf allen 3 OS inkl. Wayland + Multi‑Monitor/HiDPI**; Feature‑Spec aus Nutzersicht | Technisches Risiko geklärt |
| **1 – MVP** ✅ | Tray + Hotkey, Overlay‑Bereichsauswahl, Bibliothek (Grid, Suche, Tags, Favoriten), Editor‑Basis (Pfeil, Rechteck, Textbox, Marker, Verpixeln, Bereich löschen, Zeichnen außerhalb), Undo/Redo, Mehrfachauswahl, Kopieren/Einfügen zwischen Screenshots, Filmstreifen, Zoom | Intern nutzbar |
| **1.5 – Performance & Skalierung** ✅ | Siehe Abschnitt 5.1 und ADR 0004; Budgets werden in CI geprüft | Bibliothek mit 100 000 Einträgen scrollt flüssig |
| **2 – Editor komplett** ✅ | Callouts/Sprechblasen, Schritt‑Nummern, Emojis/Sticker, Lupe, Quick Styles, Fenster‑Capture, Einstellungen, i18n (DE/EN) | Vollständiger Editor |
| **3 – v1.0 Release** (≈1–2 Wochen) | Release‑Workflow mit unsignierten Downloads, README (Download + erster Start + Build aus Quellcode), Nutzer‑Doku, Git‑Tag v1.0 | Öffentliches Release mit Downloads für alle OS |
| *später, optional* | Signing (Windows kostenlos über SignPath, Apple 99 $/Jahr), Auto‑Update, winget/Scoop/Flathub | Sobald es Nutzer gibt |
| **4 – v2** | CLI, HTTP‑API (OpenAPI), MCP‑Server, Rust‑Renderer, Scrolling‑Capture, OCR, GIF/Video | Automatisierbar |

### 5.1 Phase 1.5 – Performance & Skalierung

**Ziel:** Die Bibliothek öffnet sich sofort und scrollt bei 100 000 Screenshots so flüssig wie
eine Datenbank‑Tabelle; nichts blockiert die Oberfläche.

**Budgets (messbar, in CI geprüft):**

| Messpunkt | Ziel |
|---|---|
| Bibliothek öffnen (erste Thumbnails sichtbar) | < 200 ms |
| Scrollen im Grid | 60 fps, keine leeren Kacheln länger als 100 ms |
| Suche tippen → Ergebnis | < 50 ms bei 100 000 Einträgen |
| Screenshot → im Editor | < 500 ms |
| Speicher der Bibliothek‑Ansicht | unabhängig von der Anzahl Einträge |

**Maßnahmen:**

1. **Nur laden, was sichtbar ist.**
   - Grid und Filmstreifen *virtualisiert* (z. B. TanStack Virtual): es existieren nur die
     ~50 DOM‑Elemente im sichtbaren Bereich, egal wie groß die Bibliothek ist.
   - Daten seitenweise per *Keyset‑Pagination* (`WHERE (created_at, id) < (?, ?) ORDER BY … LIMIT 200`)
     statt alles auf einmal; `OFFSET` vermeiden, weil es mit der Tiefe langsamer wird.
   - Gesamtanzahl separat (`COUNT(*)` gecacht), damit die Scrollbar stimmt.
2. **Kleine, schnelle Thumbnails.**
   - Thumbnails als WebP (~10–20 KB statt PNG), in zwei Größen (Grid 320 px, Filmstreifen 160 px).
   - Ausgeliefert über ein eigenes URI‑Protokoll (`thumb://<id>`) mit Cache‑Headern, damit der
     Webview sie im Speicher‑/Disk‑Cache hält.
   - Erzeugung im Hintergrund‑Thread (Rayon‑Pool), fehlende Thumbnails als Platzhalter, nie blockierend.
3. **Datenbank richtig nutzen.**
   - Indizes für Sortierung und Filter (`created_at, id`, `favorite`, `tags.tag`).
   - Volltextsuche mit **SQLite FTS5** (Titel, Tags, später OCR‑Text) statt `LIKE '%…%'`.
   - WAL‑Modus, vorbereitete Statements, Lese‑Verbindungspool (`r2d2`) getrennt vom Schreiben.
4. **Rust‑Seite nie blockieren lassen.**
   - Teure Arbeit (PNG/WebP kodieren, Thumbnails, Reindex) in `spawn_blocking` / Hintergrund‑Queue.
   - Reindex beim Start inkrementell und im Hintergrund statt vor dem ersten Fenster.
   - Schnellere PNG‑Kodierung (`zlib-rs`/`fdeflate`) für Speichern und Zwischenablage.
5. **Editor.**
   - Bereits umgesetzt: hochwertige verkleinerte Kopien (Mipmaps) für die Anzeige, Original nur beim Export.
   - Bilder im Hintergrund dekodieren (`createImageBitmap`), Konva‑Ebenen cachen, Rendern
     für die Bibliothek (render.png/Thumbnail) im Worker statt im UI‑Thread.
6. **Messen statt raten.**
   - Benchmark‑Datensatz: Skript erzeugt 10 000 / 100 000 synthetische Einträge.
   - Rust‑Benchmarks mit `criterion` (Liste, Suche, Thumbnail), Frontend‑Profiling mit
     Playwright + Performance‑API; Budgets aus der Tabelle als CI‑Checks.

**Stand der Umsetzung** (Details und Messwerte in [ADR 0004](adr/0004-library-performance.md)):

| Maßnahme | Status |
|---|---|
| Virtualisiertes Grid und Filmstreifen (TanStack Virtual) | ✅ |
| Seitenweises Laden, Anzahl, Position | ✅ – per Offset statt Keyset, damit die Scrollbar beliebig springen kann (siehe ADR) |
| WebP‑Thumbnails (320 px, verlustbehaftet), im Hintergrund erzeugt, über `thumb://` mit Cache‑Headern | ✅ |
| Indizes, FTS5‑Trigramm‑Suche, WAL, Lese‑Verbindungspool | ✅ – eigener Pool (4 Leser) statt `r2d2` |
| Reindex im Hintergrund, Befehle im Blocking‑Pool | ✅ |
| Benchmarks und Testdaten‑Generator | ✅ |
| Budgets als CI‑Check (Core in Rust, UI mit Playwright) | ✅ – Messwerte in ADR 0004 |
| Zweite Thumbnail‑Größe (160 px) für den Filmstreifen | ⏸ später – die 320‑px‑WebP sind klein genug |
| Schnellere PNG‑Kodierung (`zlib-rs`/`fdeflate`) | ⏸ später – Screenshot hinzufügen dauert ~20–30 ms |
| Editor: Dekodieren im Hintergrund, Rendern im Worker | ⏸ später – in Phase 2 messen, falls der Editor bei großen Bildern hakt |

---

## 6. Entscheidungen

| Frage | Stand |
|---|---|
| **Name** – „Screenbook“ ok? | ⬜ Websuche (Okt. 2026) ohne gleichnamige Software; Prüfung der Markenregister (DPMA, EUIPO, USPTO) steht vor dem öffentlichen Release noch aus |
| **Lizenz** | ✅ MIT oder Apache‑2.0 nach Wahl |
| **Frontend** | ✅ React |
| **Neubau vs. Beitrag zu ksnip** | ✅ Neubau |
| **Signing** | ✅ entfällt vorerst: unsignierte Downloads + Start aus dem Quellcode |
| **Linux‑Mindestversion** | ✅ Ubuntu 24.04 / Debian 13: `xcap` braucht PipeWire ≥ 1.0, CI und Release bauen auf `ubuntu-24.04` |
| **Repository** | ✅ privat unter `cwecode/screenbook`; öffentlich spätestens mit v1.0 |

---

## 7. Nächste Schritte

1. Release‑Workflow mit einem Test‑Tag (`v1.0.0-rc.1`) ausprobieren, Downloads auf allen OS starten.
2. Markenregister prüfen, Repository öffentlich machen, Tag `v1.0.0` setzen, Entwurf veröffentlichen.
3. Die UI‑Budgets auf dem CI‑Runner im Blick behalten (ADR 0004).
