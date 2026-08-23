# Fresh Windows setup

Two options:

- **Option A — Node.js** (best for development / updating code)
- **Option B — Standalone `.exe` package** (no Node on the target PC)

---

## Option A — Node.js setup

### 1. Install system dependencies

| Dependency | Version | Download |
|---|---|---|
| **Node.js** | **20 LTS** (or 18+) | https://nodejs.org |
| **Git** (optional) | latest | https://git-scm.com |

During Node install, leave **Add to PATH** checked.

Verify in Command Prompt or PowerShell:

```bat
node -v
npm -v
```

### 2. Get the project

```bat
cd C:\Projects
git clone <your-repo-url> linkedin-fetch-v1
cd linkedin-fetch-v1
```

Or copy the project folder (including `package.json` and `package-lock.json`).

Do **not** copy `node_modules` from a Mac/Linux machine — install fresh on Windows.

### 3. Install npm packages

```bat
cd C:\Projects\linkedin-fetch-v1
npm install
```

### 4. Install Playwright Chromium (required)

```bat
npx playwright install chromium
```

This downloads Chromium into `%LOCALAPPDATA%\ms-playwright\`.

### 5. Ensure folders exist

```bat
mkdir session
mkdir input
mkdir output
```

### 6. Login once (saves session)

```bat
login.bat
```

Or:

```bat
node app.js --login
```

1. Browser opens LinkedIn login.
2. Sign in manually (complete 2FA if asked).
3. Wait until you land on the feed.
4. Terminal shows session saved to `session\linkedin.json`.

### 7. Prepare input file

Put a `.csv` or `.xlsx` in `input\` with a column named exactly:

```text
originalQuery/query
```

One LinkedIn profile URL per row.

### 8. Run the scraper

```bat
run-app.bat input\your-file.csv
```

Or with Node directly:

```bat
node app.js input\your-file.csv
node app.js input\your-file.xlsx
node app.js input\your-file.csv --concurrency=3
```

### 9. Output

A timestamped results file is written next to the input file.

---

## Option B — Standalone package (no Node on target PC)

Build on a machine that already has the project working, then copy the folder to the fresh Windows PC.

### On the build machine

```bat
npm install
npx playwright install chromium
npm run build:exe
```

Assemble:

```text
linkedin-scraper-package\
  app.exe
  browsers\          ← chromium-* and winldd-* from %LOCALAPPDATA%\ms-playwright
  session\           ← empty on first copy
  input\
  output\
  login.bat
  run-app.bat
  WINDOWS-SETUP.md
```

Copy Chromium (revision numbers change with Playwright upgrades):

```powershell
Copy-Item "$env:LOCALAPPDATA\ms-playwright\chromium-*" `
  "linkedin-scraper-package\browsers\" -Recurse
Copy-Item "$env:LOCALAPPDATA\ms-playwright\winldd-*" `
  "linkedin-scraper-package\browsers\" -Recurse
```

For the packaged folder, `login.bat` / `run-app.bat` must set:

```bat
set PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers
```

and call `app.exe` instead of `node app.js`. See `PACKAGING.md` for full packaging notes.

### On the fresh Windows PC

1. Unzip anywhere (e.g. `C:\linkedin-scraper-package`).
2. Run `login.bat` and sign into LinkedIn.
3. Put CSV/XLSX in `input\`.
4. Run:

```bat
run-app.bat input\your-file.csv
```

---

## Quick checklist

1. Node 20 LTS installed (Option A) **or** packaged folder ready (Option B)
2. `npm install` + `npx playwright install chromium` (Option A only)
3. Login once (`login.bat` / `node app.js --login`)
4. Input has column `originalQuery/query`
5. Run (`run-app.bat input\file.csv` or `node app.js input\file.csv --concurrency=3`)

---

## Common Windows issues

| Problem | Fix |
|---|---|
| Playwright / Chromium missing | `npx playwright install chromium` |
| Session expired / authwall | Re-run `login.bat` |
| Copied `node_modules` from Mac | Delete `node_modules`, then `npm install` on Windows |
| Antivirus blocks Chromium / exe | Allow the project folder and `%LOCALAPPDATA%\ms-playwright` |
| Permission denied on `.bin` scripts | Re-run `npm install` on Windows |

---

## Useful commands

```bat
node app.js --login
node app.js input\sample.csv
node app.js input\sample.csv --concurrency=3
MAX_CONCURRENT_TABS=3 node app.js input\sample.csv
```
