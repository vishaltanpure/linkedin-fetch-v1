# LinkedIn tools (this repo)

This repo contains **two separate apps**. They share one LinkedIn login session (`session/linkedin.json`) but are started with **different commands**.

| App | Folder | Purpose |
|-----|--------|---------|
| **linkedin-fetch-v1** | repo root | Enrich a list of **known** profile URLs (CSV/XLSX) |
| **LinkedIn-Discovery** | `LinkedIn-Discovery/` | **Search** LinkedIn by criteria, skip existing profiles, scrape **new** ones |

**Do not run both at the same time** on the same LinkedIn account (shared session / rate-limit risk). Run one, finish, then the other.

---

## One-time setup (both apps)

```bash
cd linkedin-fetch-v1
npm install
npx playwright install chromium
```

### Login once (shared session)

```bash
node app.js --login
```

Or from Discovery:

```bash
cd LinkedIn-Discovery
node discovery-app.js --login
```

Both write/read `session/linkedin.json` at the **repo root**.

---

## App 1 — linkedin-fetch-v1 (enrich known URLs)

Input file must have a column named `originalQuery/query` (one LinkedIn profile URL per row).

```bash
cd linkedin-fetch-v1

# Login (if needed)
node app.js --login

# Run
node app.js input/sample.csv
node app.js input/your-file.xlsx
node app.js input/your-file.csv --concurrency=3

# Windows
login.bat
run-app.bat input\your-file.csv --concurrency=3
```

More detail: `WINDOWS-SETUP.md`

---

## App 2 — LinkedIn-Discovery (search + new profiles only)

```bash
cd linkedin-fetch-v1/LinkedIn-Discovery

# Login (if needed) — same session as App 1
node discovery-app.js --login

# Search and capture N NEW unique profiles
node discovery-app.js --query "Software Engineers in San Francisco" --count 50

# Skip anyone already in an existing sheet (.csv / .xlsx / .xls)
node discovery-app.js --query "Software Engineers in San Francisco" --count 50 --existing "/path/to/existing-results.xlsx"

# Path as last argument also works
node discovery-app.js --query "CTOs in California" --count 25 "/path/to/existing-results.xlsx"

# Multi-filter (Sales Navigator URL — most accurate)
node discovery-app.js --sales-navigator-url "https://www.linkedin.com/sales/search/people?query=..." --count 100

# Multi-filter via CLI flags (People Search)
node discovery-app.js --count 50 --geography India --industry Retail --seniority "CXO,Director" --function "Sales,Marketing"

# Batch from Excel/CSV (one row = one search job)
node discovery-app.js --input input/search-jobs.sample.csv --existing "/path/to/existing.xlsx"

# Windows
login.bat
run-discovery.bat --query "Software Engineers in San Francisco" --count 50 --existing input\existing.sample.csv
```

More detail: `LinkedIn-Discovery/README.md`

---

## Typical workflow (both apps, not parallel)

```text
1. Login once
       ↓
2. LinkedIn-Discovery  → find NEW people → output CSV/XLSX
       ↓
3. (optional) Use that output / your master sheet later
       ↓
4. linkedin-fetch-v1   → refresh/enrich a known URL list
```

Example sequence:

```bash
# From repo root
node app.js --login

# Discovery
cd LinkedIn-Discovery
node discovery-app.js --query "Marketing Managers in New York" --count 100 --existing "../input/sample-results-2026-08-22T05-32-41-753Z.csv"

# Later: enrichment on a URL list
cd ..
node app.js input/your-url-list.csv --concurrency=3
```

---

## Quick command cheat sheet

| Task | Command |
|------|---------|
| Login | `node app.js --login` |
| Enrich CSV | `node app.js input/file.csv` |
| Enrich with tabs | `node app.js input/file.csv --concurrency=3` |
| Discover | `cd LinkedIn-Discovery && node discovery-app.js --query "..." --count 50` |
| Discover + dedupe sheet | `... --existing "/path/file.xlsx"` |

---

## Notes

- **PowerShell `npm -v` blocked?** Use **Command Prompt**, or `npm.cmd -v`, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- Session expired / authwall → run login again.
- Discovery reuses the same scrape fields/columns as fetch-v1 (plus `searchQuery`).
