# LinkedIn-Discovery

Independent app that **searches LinkedIn for profiles** matching criteria (People Search or **Sales Navigator**), scrapes the **same fields** as the parent enrichment app (`linkedin-fetch-v1`), and **never returns a profile that already exists** in a supplied existing sheet.

## What it does

1. Accepts search criteria via CLI flags, a **Sales Navigator URL**, or an **Excel/CSV batch file**
2. Paginates LinkedIn **People Search** or **Sales Navigator** results
3. Normalizes each profile URL and skips:
   - Profiles already in `--existing` sheet
   - Duplicates within the current run
4. Continues searching until **`--count` NEW unique profiles** are queued (not merely N search results)
5. Scrapes each new profile with the parent `scrapeProfile()` pipeline
6. Exports the **same columns** as the enrichment app, plus `searchQuery`

## Requirements

- Same as parent app: Node 18+, Playwright Chromium, logged-in LinkedIn session
- **Sales Navigator URL mode** requires a Sales Navigator license on the logged-in account
- Run from this folder **or** the parent folder; Discovery requires the parent project (shared extractors / browser / session)

```bat
cd linkedin-fetch-v1
npm install
npx playwright install chromium
```

## Login (shared session)

Discovery reuses the parent app’s `session/linkedin.json`:

```bat
cd LinkedIn-Discovery
node discovery-app.js --login
```

Or from the parent:

```bat
node app.js --login
```

## Multi-filter search (premium / Sales Navigator)

Log in with a **Sales Navigator** account (`node discovery-app.js --login`). Discovery then opens Lead search (`/sales/search/people`) and applies Excel/CLI filters as **sidebar chips** — same categories as the SN UI:

- Company headcount (e.g. `51-200`, `201-500`)
- Function (e.g. `Sales`, `Marketing`, `Information Technology`)
- Current job title
- Seniority level (e.g. `CXO`, `Director`)
- Geography (e.g. `India`)
- Industry (e.g. `Retail`)

| Approach | Accuracy | How |
|----------|----------|-----|
| **Excel / CLI filters + SN login** | High | Builds a real SN search URL (same chips as the UI) |
| **Sales Navigator URL** | Highest | Paste the URL after you set filters yourself |
| **No SN / unmapped value** | Fallback | People Search keywords |

### Excel / CLI (recommended with premium)

```bat
node discovery-app.js --count 50 --concurrency 2 ^
  --geography India --industry Retail ^
  --seniority "CXO,Director" ^
  --function "Sales,Marketing,Information Technology" ^
  --job-title "Sales,Marketing" ^
  --company-headcount "51-200,201-500"
```

Or `--input` an `.xlsx` with those columns. No `salesNavigatorUrl` needed when the session has SN.

### Sales Navigator URL (optional)

1. Open Lead search, apply filters, copy the address bar
2. Run `--sales-navigator-url "https://www.linkedin.com/sales/search/people?query=..."`

### CLI filter flags (People Search fallback)

Without SN, or with `--people-search`, filter values are combined into People Search keywords:

```bat
node discovery-app.js --query "CMO" --count 50 ^
  --geography India ^
  --industry Retail ^
  --seniority "CXO,Director" ^
  --function "Sales,Marketing,Information Technology" ^
  --company-headcount "51-200,201-500" ^
  --existing input\existing.csv
```

Multiple values in one filter: comma-separated (`"CXO,Director"`).

## Batch runs from Excel / CSV

One row = one discovery job. Copy `input/search-jobs.sample.csv` as a template.

| Column | Required | Example |
|--------|----------|---------|
| `searchName` | No | India Retail CXO |
| `count` | Yes | 100 |
| `keywords` | No* | CMO |
| `salesNavigatorUrl` | No* | Full SN URL after applying filters |
| `companyHeadcount` | No | 51-200, 201-500 |
| `function` | No | Sales, Marketing, Information Technology |
| `jobTitle` | No | Sales, Marketing |
| `seniority` | No | CXO, Director |
| `geography` | No | India |
| `industry` | No | Retail |
| `existingSheet` | No | Per-job dedupe sheet path |
| `maxPages` | No | 30 |

\* Each row needs either `salesNavigatorUrl` OR at least one of `keywords` / filter columns.

```bat
node discovery-app.js --input input\search-jobs.xlsx --existing input\existing.csv
```

Batch output: `output/discovery-results-batch-<timestamp>.csv` (all jobs combined).

## Usage examples

```bat
cd LinkedIn-Discovery

# Simple keyword search
node discovery-app.js --query "Software Engineers in San Francisco" --count 100

# Multi-filter via CLI
node discovery-app.js --count 50 --geography India --industry Retail --seniority "CXO,Director"

# Sales Navigator URL (best multi-filter)
node discovery-app.js --sales-navigator-url "https://www.linkedin.com/sales/search/people?query=..." --count 100

# With existing sheet dedupe
node discovery-app.js --query "Marketing Managers in New York" --count 50 --existing input\existing.csv

node discovery-app.js --query "Software Engineers in San Francisco" --count 3 --existing "/Users/you/Downloads/demo-results.xlsx"

# Batch from Excel
node discovery-app.js --input input\search-jobs.sample.csv --existing input\existing.csv

# XLSX output
node discovery-app.js --query "CTOs in California" --count 25 --output output\ctos.xlsx --format xlsx
```

`--existing` accepts **`.csv`**, **`.xlsx`**, and **`.xls`**. You can also pass the sheet path as the last argument (no flag).

### Arguments

| Flag | Required | Meaning |
|------|----------|---------|
| `--query` / `-q` | Single search* | Free-text keywords |
| `--count` / `-n` | Single search | Number of **new unique** profiles to capture |
| `--input` / `-i` | Batch | Excel/CSV with one search job per row |
| `--sales-navigator-url` | No | Full SN URL (best for multi-filter) |
| `--company-headcount` | No | e.g. `51-200,201-500` |
| `--function` | No | Role function filter(s) |
| `--job-title` | No | Job title filter(s) |
| `--seniority` | No | e.g. `CXO,Director` |
| `--geography` / `--geo` | No | e.g. `India` |
| `--industry` | No | e.g. `Retail` |
| `--existing` / `-e` | No | CSV / XLSX / XLS suppression/dedupe list |
| `--output` / `-o` | No | Output path (default: `output/discovery-results-<timestamp>.csv`) |
| `--format` / `-f` | No | `csv` (default) or `xlsx` |
| `--max-pages` | No | Max search result pages per job (default: 40) |
| `--concurrency` / `-c` | No | Parallel scrape tabs (default: 2, stay in 1–3) |
| `--people-search` | No | Skip SN sidebar; keyword People Search only |
| `--login` | — | Save LinkedIn session |
| `--help` | — | Show help |

\* Single search requires `--query`, filter flags, or `--sales-navigator-url`.

## Speeding up discovery

The slow part is **profile scrape** (4 pages per person), not the search list.

| Idea | Use? | Why |
|------|------|-----|
| **Concurrent tabs** (`--concurrency 2` or `3`) | Yes | Same login, N scrapes at once. Default is 2. |
| Extra browser windows / same account | No | Same cookies → same LinkedIn rate limit, higher checkpoint risk |
| Extra accounts | Out of scope | Only helps with separate logins; this app uses one session |
| Skip SN lead → profile hop | Built-in | `/sales/lead/ACw…` maps straight to `/in/ACw…` |
| Faster search paging | Built-in | One scroll per page; page 1 not reloaded after filters |

```bat
node discovery-app.js --input input\search-jobs.xlsx --count 50 --concurrency 2
```

Stay at **1–3** tabs. Higher values usually get throttled or checkpointed, not faster.

## Duplicate prevention

Primary key: **normalized LinkedIn profile URL**

These are treated as the same profile:

```text
https://www.linkedin.com/in/john-doe
https://www.linkedin.com/in/john-doe/
https://linkedin.com/in/john-doe
http://www.linkedin.com/in/john-doe?trk=...
```

Flow:

```text
Normalize LinkedIn URL
        ↓
In existing sheet?
   ├── YES → Skip (do not capture / do not add to output)
   └── NO
        ↓
Already accepted this run?
   ├── YES → Skip
   └── NO  → Queue → scrape → add to output
```

`--count` means **new unique profiles**, not total search hits processed.

## Existing sheet

Any CSV/XLSX. Preferred URL columns (if present):

- `originalQuery/query`
- `Original LinkedIn URL`
- `profileUrl` / `linkedinUrl` / `LinkedIn URL` / `url`

If none of those exist, every cell is scanned for `/in/` URLs.

## Output columns

Same as parent enrichment app, plus `searchQuery` at the front:

1. `searchQuery`
2. `originalQuery/query` (discovered profile URL)
3. `Original LinkedIn URL`
4. `firstName` … through … `Disease Keyword`  
   (identical to parent `utils/schema-mapper.js` `OUTPUT_COLUMNS`)

Only **newly discovered, unique** profiles are written.

## Stats example

```text
Search criteria:              India | geography=India; industry=Retail; seniority=CXO,Director
Search mode:                  people_search
Requested (new unique):       100
Search pages visited:         12
Profiles found in search:     350
Profiles searched (checked):  350
Existing profiles skipped:    75
Duplicate profiles skipped:   12
New URLs queued:              100
New profiles captured:        100
Scrape failures:              0
```

If the target cannot be reached:

```text
Requested: 100 — New profiles found: 87 — Existing/duplicate skipped: 213
No additional matching profiles available (or max pages reached).
```

## Windows helpers

```bat
login.bat
run-discovery.bat --query "Software Engineers in San Francisco" --count 50 --existing input\existing.csv
run-discovery.bat --input input\search-jobs.sample.csv --existing input\existing.csv
```

## Folder layout

```text
LinkedIn-Discovery/
  discovery-app.js     ← CLI entry
  lib/
    discover.js        ← orchestration
    search.js          ← people search + Sales Navigator + pagination
    search-filters.js  ← filter parsing, SN URL, keyword composition
    sn-filters.js      ← detect SN + apply sidebar filters
    read-search-jobs.js← Excel/CSV batch loader
    dedupe.js          ← existing sheet + in-run dedupe
    normalize-url.js   ← URL normalization
    read-sheet.js      ← CSV/XLSX reader
    app-root.js
  input/
    search-jobs.sample.csv  ← batch template
    existing.sample.csv
  output/              ← discovery results
  session/             ← optional local notes (login uses parent session)
  README.md
  login.bat
  run-discovery.bat
```

## Important

- Does **not** modify the parent enrichment app (`app.js` / `index.js`).
- Does **not** invent profiles to hit `--count`.
- A single scrape failure is logged and skipped; the run continues.
- Session/auth failures stop the run (re-login required).
- Sales Navigator `/sales/lead/` URLs are resolved to `/in/` profile URLs before scraping.

## Quick test (no LinkedIn)

```bat
node scripts\test-dedupe.js
node scripts\test-search-filters.js
```
