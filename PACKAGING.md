# Building a standalone Windows package

Produces a folder that runs on another Windows machine with nothing installed
— no Node.js, no Playwright browser download. Everything is bundled.

## Rebuild after a code change

```bash
npm run build:exe
```

Produces `dist/app.exe`. This single exe handles both scraping and login
(`app.exe --login` vs `app.exe <file>`) — see `app.js`'s CLI dispatch at the
bottom of the file.

**Gotchas already solved, don't re-discover them:**

- `--public` is required. Without it, Playwright's `page.evaluate(fn)` calls
  throw `"Passed function is not well-serializable!"` — pkg's default V8
  bytecode compilation strips the function source text that Playwright needs
  to serialize callbacks into the browser context. `--no-bytecode` also fixes
  this but cascades into "no source" build failures on unrelated transitive
  dependencies deep in `node_modules` — not worth it. `--public` alone is
  sufficient and only affects our own project source.
- `pkg.assets` in `package.json` (`node_modules/playwright-core/**/*`) is
  required. Without it, the exe crashes at runtime with `Cannot find module
  '...\playwright-core\browsers.json'` — pkg's static analysis doesn't
  discover this non-JS data file on its own.
- Building from an entry file in a subdirectory (tried `scripts/save-session.js`
  as its own exe) hit the browsers.json error again even with the same
  `pkg.assets` config that worked fine for `app.js` at the project root —
  never fully root-caused, just avoided by keeping ONE entry point (`app.js`)
  with login as a `--login` flag instead of a second exe.

## Assemble the full package (first time, or after a Playwright/Chromium version bump)

1. `npm run build:exe`
2. Create the package folder structure:
   ```
   linkedin-scraper-package/
     app.exe
     browsers/
     session/        (empty — user logs in fresh on the target machine)
     input/
     output/
     run-app.bat
     login.bat
     README.txt
   ```
3. Copy the Chromium browser binaries into `browsers/`. Only `chromium-*`
   and `winldd-*` are needed (not firefox/webkit/chromium_headless_shell —
   `browser/browser.js` only launches `chromium`):
   ```powershell
   Copy-Item "$env:LOCALAPPDATA\ms-playwright\chromium-XXXX" `
     "linkedin-scraper-package\browsers\chromium-XXXX" -Recurse
   Copy-Item "$env:LOCALAPPDATA\ms-playwright\winldd-XXXX" `
     "linkedin-scraper-package\browsers\winldd-XXXX" -Recurse
   ```
   (Check the exact folder names under `%LOCALAPPDATA%\ms-playwright` — the
   revision numbers change when Playwright's package.json version bumps.)
4. `run-app.bat` and `login.bat` set `PLAYWRIGHT_BROWSERS_PATH` to the
   bundled `browsers` folder before invoking `app.exe`, so nothing needs to
   be downloaded on the target machine.
5. Zip the whole `linkedin-scraper-package` folder for transfer. Expect
   several hundred MB — Chromium itself is ~400MB and that's unavoidable if
   the target machine should need zero internet access on first run.

## Why not a single all-in-one .exe with Chromium embedded?

Chromium is a full browser install (400MB+, many files, native binaries) —
it isn't something a Node bundler can fold into one executable alongside
our JS. The realistic "standalone" deliverable is a folder: one exe (no
Node install needed) + a bundled browser directory next to it. That's what
this produces.

## Path handling

`utils/app-root.js` resolves the app's own folder (via `process.execPath`
when running as a packaged exe, `__dirname` in dev) so `session/linkedin.json`
and the CLI's default `output/` folder are found correctly regardless of the
directory the exe is launched from. Verified by running the built exe with a
working directory and input file completely unrelated to the package folder.
