# Live checks

Clicking through the running app to confirm a change really works, instead of relying on tests alone.

## Standing permission
The owner has given full access to whatever is needed to control for live checks, in every session, until they say to put access permission back the way it was (then delete this section and `CLAUDE.md` §9). The tool still shows its own approval pop-up each session; call it and carry on. This does not change `CLAUDE.md` §8 (test data only, nothing destructive without asking).

## Main method: Playwright (dev-only tool, never shipped)
- `playwright` is a dev dependency. It launches the built app (`out/`) through Electron and drives the real window: clicks, typing, reading text, screenshots.
- The `JUNOBOOKS_DATA_ROOT` environment variable replaces the development copy's whole test-data area with **`test-data\live`** (`src/main/paths.ts`, development copy only): companies, app settings and the Settings folder pointer all live there. The owner's normal test companies in `test-data\Companies` and their last-opened company are never touched.
- Helpers in `scripts/live/lib.mjs`: `launch({ fresh })` (fresh wipes `test-data\live` first), `createCompany(page)` (makes the **"Live check"** company through the New company form: single-member LLC, Product template, books start 2026-01-01), `shot(page, name)` (full-page screenshot into `test-data\live-shots\`), `check(cond, label)`, `done(errors)` (also fails on any page error).
- One script per unit in `scripts/live/checks/` (e.g. `smoke.mjs`). Each prints `ok` / `FAIL` lines and "Live check passed".

- File pickers and "open in Windows" are stubbed from the script with `app.evaluate(({ dialog, shell }) => ...)` (see `receipts.mjs`, `settings.mjs`).

### Steps
1. `npm run typecheck` and `npm test`.
2. `npm run live` builds and runs every check (`scripts/live/all.mjs`); or `npm run build` then `node scripts/live/checks/<name>.mjs` for one.
4. Open the screenshots in `test-data\live-shots\` and look at them (layout, wording, wrapping).
5. Check the happy path, the refusals (wrong input gives a plain-English message), and the resulting balances.

### Traps
- Date inputs: `fill('2026-03-15')` works (Playwright sets the value directly).
- The account boxes (`AccountCombobox`) need a click, typing, then a click on the option (or Enter); `fill` alone leaves the text unmatched.
- A Playwright run opens a real window briefly; it closes itself at the end of the script.

## Backup method: real screen control
Only when Playwright can't do something. Start the app with `npm start`, ask computer-use for access to **`JunoBooks`** (and the dev `electron.exe` window if offered), bring the window forward from PowerShell (`SetForegroundWindow` on the `electron` process titled "JunoBooks"), use a "Live check" company, and stop the processes afterwards. Don't use `open_application` on "Electron" (opens a blank welcome window). In date boxes type the whole date (`01012026`). The installed JunoBooks is a different program from the dev copy. Screenshots may show the owner's desktop; act only inside the JunoBooks window.
