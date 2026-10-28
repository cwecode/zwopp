# ADR 0005: UI language (German and English)

- Status: accepted
- Date: 2026-10-27

## Context

Until Phase 1.5 all UI texts were German string literals in the components. Phase 2 adds
many new tools and dialogs and asks for German and English (`docs/PLAN.md`). Switching
before Phase 2 touches ~90 texts; switching after it would touch twice as many.

## Decisions

1. **No i18n library.** The texts are typed objects: `src/i18n/de.tsx` is the reference,
   `en.tsx` is declared as `Messages = typeof de`, so a missing or extra key is a type
   error. Texts with parameters are functions (`count: (n) => …`), which also handles
   plurals and number formats without a message syntax. Two languages and ~100 texts do
   not justify i18next (~40 kB) or ICU message parsing.
2. **Language from the system**, the first supported one among `navigator.languages`,
   else English, unless the settings name a language (see ADR 0006). `setLanguage`
   switches at runtime; components read texts with `useT()`.
3. **Key names are translated in one place**: `keys(t, ["mod", "Z"])` gives "Strg+Z",
   "Ctrl+Z" or "⌘Z" on macOS. Tooltips no longer hard-code "Strg".
4. **The web UI owns the language.** The tray menu (Rust) starts in English and is
   translated when the main window reports its language (`set_language`), so there is one
   source of truth, also once the language becomes a setting.
5. **Stored data is not translated.** New layers are named in the UI language when they
   are created ("Ebene 2" / "Layer 2"); the base layer is "Original" in both languages.

## Consequences

- New UI texts go into both files; `i18n.test.ts` checks both have the same keys.
- Error messages from the backend stay English: they are for bug reports, not for users.
- A third language needs a new file and an entry in `MESSAGES`; more than a handful would
  call for a translation workflow (and maybe a library) instead.
