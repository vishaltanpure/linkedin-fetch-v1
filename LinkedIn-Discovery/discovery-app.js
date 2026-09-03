/**
 * LinkedIn-Discovery — CLI
 *
 * Single search (CLI flags):
 *   node discovery-app.js --query "..." --count 50 --geography India --seniority "CXO,Director"
 *
 * Sales Navigator URL (best multi-filter fidelity — copy from browser):
 *   node discovery-app.js --sales-navigator-url "https://www.linkedin.com/sales/search/people?query=..." --count 100
 *
 * Batch from Excel/CSV:
 *   node discovery-app.js --input input/search-jobs.xlsx --existing "/path/to/existing.xlsx"
 */

const path = require("path");
const fs = require("fs");

const log = require("../utils/logger");
const { runDiscovery, runDiscoveryBatch } = require("./lib/discover");
const { getAppRoot } = require("./lib/app-root");
const { looksLikeSheetPath } = require("./lib/read-sheet");
const { loadSearchJobs } = require("./lib/read-search-jobs");
const { parseCliFilters, validateSearchJob } = require("./lib/search-filters");
const PARENT_CONFIG = require("../config/concurrency");

function printHelp() {
    console.log(`
LinkedIn-Discovery — find NEW unique LinkedIn profiles from search criteria

Usage:
  node discovery-app.js --login
  node discovery-app.js --query "<text>" --count <N> [filters...] [options]
  node discovery-app.js --input <search-jobs.csv|xlsx|xls> [options]
  node discovery-app.js --sales-navigator-url "<url>" --count <N>

Required (single search):
  --query <text>       Free-text keywords (optional if filters / SN URL provided)
  --count <N>          Number of NEW unique profiles to capture

Required (batch):
  --input <path>       Excel/CSV with one search job per row (see input/search-jobs.sample.csv)

Filter flags (comma-separated for multiple values):
  --company-headcount  e.g. "51-200,201-500"
  --function           Role function: e.g. "Sales,Marketing,Information Technology"
  --job-title          e.g. "Sales,Marketing"
  --seniority          e.g. "CXO,Director"
  --geography          e.g. "India" or "San Francisco"
  --industry           e.g. "Retail"

Sales Navigator (premium account applies Excel/CLI filters in the SN sidebar):
  --sales-navigator-url  Paste full URL from Sales Navigator after applying filters
  --people-search        Force People Search even if the session has SN

Speed:
  --concurrency <N>    Scrape N profiles at once (tabs, same session). Default 2. Use 1–3.

Options:
  --existing <path>    CSV / XLSX / XLS dedupe list (global; per-row existingSheet in --input)
  --output <path>      Output file (.csv or .xlsx)
  --format <csv|xlsx>  Output format (default: csv)
  --max-pages <N>      Max search pages per job (default: 40)
  --login              Save LinkedIn session
  --help               Show help

Excel input columns (search-jobs sheet):
  searchName, count, keywords, salesNavigatorUrl,
  companyHeadcount, function, jobTitle, seniority,
  geography, industry, existingSheet, maxPages

Examples:
  node discovery-app.js --query "CMO" --count 50 --geography India --industry Retail --seniority "CXO,Director" --function "Sales,Marketing"

  node discovery-app.js --sales-navigator-url "https://www.linkedin.com/sales/search/people?query=..." --count 100 --existing "/path/existing.xlsx"

  node discovery-app.js --input input/search-jobs.sample.csv --existing "/path/existing.xlsx"
`);
}

function normalizeSheetPath(raw) {
    if (!raw) return "";
    let cleaned = String(raw).trim();
    while (/^--/.test(cleaned)) cleaned = cleaned.slice(1);
    if (cleaned.startsWith("-/")) cleaned = cleaned.slice(1);
    if (
        (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
        (cleaned.startsWith('"') && cleaned.endsWith('"'))
    ) {
        cleaned = cleaned.slice(1, -1);
    }
    return cleaned;
}

function readFlag(argv, i, names, { allowGluedNumber = false } = {}) {
    const arg = argv[i];
    for (const name of names) {
        if (arg === name) {
            if (argv[i + 1] === undefined) throw new Error(`Missing value after ${name}`);
            return { value: argv[i + 1], consumed: 2 };
        }
        if (arg.startsWith(`${name}=`)) {
            return { value: arg.slice(name.length + 1), consumed: 1 };
        }
        if (allowGluedNumber) {
            const m = arg.match(new RegExp(`^${name}(\\d+)$`));
            if (m) return { value: m[1], consumed: 1 };
        }
    }
    return null;
}

function parseArgs(argv) {
    const opts = {
        login: false,
        help: false,
        inputPath: "",
        query: "",
        count: 0,
        salesNavigatorUrl: "",
        companyHeadcount: "",
        function: "",
        jobTitle: "",
        seniority: "",
        geography: "",
        industry: "",
        existingPath: "",
        outputPath: "",
        format: "csv",
        maxPages: 40,
        concurrency: process.env.MAX_CONCURRENT_TABS
            ? PARENT_CONFIG.MAX_CONCURRENT_TABS
            : 2,
        forcePeopleSearch: false
    };

    for (let i = 0; i < argv.length; ) {
        const arg = argv[i];

        if (arg === "--login") { opts.login = true; i += 1; continue; }
        if (arg === "--help" || arg === "-h") { opts.help = true; i += 1; continue; }
        if (arg === "--people-search") { opts.forcePeopleSearch = true; i += 1; continue; }

        let hit =
            readFlag(argv, i, ["--input", "-i"]) ||
            readFlag(argv, i, ["--query", "-q"]) ||
            readFlag(argv, i, ["--count", "-n"], { allowGluedNumber: true }) ||
            readFlag(argv, i, ["--sales-navigator-url", "--sn-url"]) ||
            readFlag(argv, i, ["--company-headcount", "--headcount"]) ||
            readFlag(argv, i, ["--function", "--role-function"]) ||
            readFlag(argv, i, ["--job-title", "--title"]) ||
            readFlag(argv, i, ["--seniority"]) ||
            readFlag(argv, i, ["--geography", "--geo", "--location"]) ||
            readFlag(argv, i, ["--industry"]) ||
            readFlag(argv, i, ["--existing", "-e"]) ||
            readFlag(argv, i, ["--output", "-o"]) ||
            readFlag(argv, i, ["--format", "-f"]) ||
            readFlag(argv, i, ["--max-pages"], { allowGluedNumber: true }) ||
            readFlag(argv, i, ["--concurrency", "-c"], { allowGluedNumber: true });

        if (hit) {
            const flag = arg.split("=")[0];
            if (flag.startsWith("--input") || flag === "-i") opts.inputPath = hit.value;
            else if (flag.startsWith("--query") || flag === "-q") opts.query = hit.value;
            else if (flag.startsWith("--count") || flag === "-n") opts.count = parseInt(hit.value, 10);
            else if (flag.includes("sales-navigator") || flag.includes("sn-url")) opts.salesNavigatorUrl = hit.value;
            else if (flag.includes("headcount")) opts.companyHeadcount = hit.value;
            else if (flag.includes("function")) opts.function = hit.value;
            else if (flag.includes("job-title") || flag === "--title") opts.jobTitle = hit.value;
            else if (flag.includes("seniority")) opts.seniority = hit.value;
            else if (flag.includes("geography") || flag.includes("geo") || flag === "--location") opts.geography = hit.value;
            else if (flag.includes("industry")) opts.industry = hit.value;
            else if (flag.startsWith("--existing") || flag === "-e") opts.existingPath = normalizeSheetPath(hit.value);
            else if (flag.startsWith("--output") || flag === "-o") opts.outputPath = hit.value;
            else if (flag.startsWith("--format") || flag === "-f") opts.format = hit.value.toLowerCase();
            else if (flag.startsWith("--max-pages")) opts.maxPages = parseInt(hit.value, 10);
            else if (flag.startsWith("--concurrency") || flag === "-c") opts.concurrency = parseInt(hit.value, 10);
            i += hit.consumed;
            continue;
        }

        const asPath = normalizeSheetPath(arg);
        if (looksLikeSheetPath(arg) || looksLikeSheetPath(asPath)) {
            if (!opts.inputPath && !opts.existingPath) {
                // If --count already set, treat as existing; else as --input batch file
                if (opts.count > 0) opts.existingPath = asPath;
                else opts.inputPath = asPath;
            } else if (!opts.existingPath) {
                opts.existingPath = asPath;
            } else {
                throw new Error(`Unexpected extra file argument: ${arg}`);
            }
            i += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (opts.outputPath) {
        const ext = path.extname(opts.outputPath).toLowerCase();
        if (ext === ".xlsx" || ext === ".xls") opts.format = "xlsx";
        else if (ext === ".csv") opts.format = "csv";
    }

    return opts;
}

function validateExistingPath(existingPath) {
    if (!existingPath) return;
    const abs = path.resolve(existingPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`Existing sheet not found: ${abs}`);
    }
    const ext = path.extname(abs).toLowerCase();
    if (![".csv", ".xlsx", ".xls"].includes(ext)) {
        throw new Error(`Unsupported existing sheet type "${ext}". Use .csv, .xlsx, or .xls.`);
    }
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (err) {
        log.error(err.message);
        printHelp();
        process.exitCode = 1;
        return;
    }

    if (opts.help || (!opts.login && process.argv.length <= 2)) {
        printHelp();
        return;
    }

    if (opts.login) {
        const { runLogin } = require("../login");
        await runLogin();
        return;
    }

    if (!["csv", "xlsx"].includes(opts.format)) {
        log.error('--format must be "csv" or "xlsx"');
        process.exitCode = 1;
        return;
    }

    for (const dir of ["input", "output", "session"]) {
        const p = path.join(getAppRoot(), dir);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }

    try {
        validateExistingPath(opts.existingPath);
    } catch (err) {
        log.error(err.message);
        process.exitCode = 1;
        return;
    }

    if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) {
        log.error("--concurrency must be a positive integer (recommended 1–3)");
        process.exitCode = 1;
        return;
    }

    const runOpts = {
        existingPath: opts.existingPath || undefined,
        outputPath: opts.outputPath || undefined,
        format: opts.format,
        maxPages: opts.maxPages,
        concurrency: opts.concurrency,
        forcePeopleSearch: opts.forcePeopleSearch
    };

    // ---- Batch mode: --input Excel/CSV ----
    if (opts.inputPath) {
        const jobs = await loadSearchJobs(opts.inputPath);
        await runDiscoveryBatch(jobs, runOpts);
        return;
    }

    // ---- Single search ----
    if (!opts.salesNavigatorUrl && !opts.query && !opts.geography && !opts.industry &&
        !opts.seniority && !opts.function && !opts.jobTitle && !opts.companyHeadcount) {
        log.error("Provide --query, filter flags, --sales-navigator-url, or --input");
        printHelp();
        process.exitCode = 1;
        return;
    }

    if (!Number.isFinite(opts.count) || opts.count < 1) {
        log.error("--count must be a positive integer");
        process.exitCode = 1;
        return;
    }

    let criteria;
    try {
        criteria = validateSearchJob(parseCliFilters(opts));
    } catch (err) {
        log.error(err.message);
        process.exitCode = 1;
        return;
    }

    await runDiscovery({ criteria, ...runOpts });
}

if (require.main === module) {
    main().catch(err => {
        log.error(err.message || String(err));
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, main };
