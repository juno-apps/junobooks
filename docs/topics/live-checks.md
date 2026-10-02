# Live checks

Clicking through the running app to confirm a change really works, instead of relying on tests alone.

## Standing permission
The owner has given full access to whatever is needed to control for live checks, in every session, until they say to put access permission back the way it was (then delete this section and `CLAUDE.md` §9). The tool still shows its own approval pop-up each session; call it and carry on. This does not change `CLAUDE.md` §8 (test data only, nothing destructive without asking).

## Steps that work (Windows, dev build)
1. Run `npm run typecheck` and `npm test` first.
2. Start the app in the background: `npm start`. It opens a window titled "JunoBooks" owned by the project's own `node_modules\electron\dist\electron.exe`.
3. Ask for access to **`JunoBooks`** and **`electron.exe`** (the installed packaged JunoBooks and the dev copy are different programs; the dev copy is the one under test).
4. The window can start behind others or off to the side. Bring it forward from PowerShell (`ShowWindow` / `SetForegroundWindow` on the `electron` process whose `MainWindowTitle` is "JunoBooks"). Maximize it by double-clicking the title bar.
5. Use a **new test company** (name it "Live check"), never an existing test company. Companies are created through the app's New company form; this adds a folder under `test-data\Companies`.
6. Check the happy path, the refusals (wrong input gives a plain-English message), and the resulting balances on the Chart of accounts tab.
7. Tidy up: stop the `electron.exe` processes and the `node.exe` running `electron-vite` that you started, and set `lastCompany` in `test-data\app-settings.json` back to the company the owner had open.

## Traps
- **Don't use `open_application` on "Electron".** It starts a blank Electron welcome window, not JunoBooks.
- Clicking the Windows taskbar needs a separate "File Explorer" access grant; skip it and use the PowerShell step above.
- In date boxes, arrow keys change the day. Type the whole date (e.g. `01012026`) instead.
- A message that disappears (e.g. "Entry posted") moves the buttons below it up; re-check coordinates with a fresh screenshot before clicking.
- Screenshots may show the owner's personal desktop behind the app. Only act inside the JunoBooks window.
