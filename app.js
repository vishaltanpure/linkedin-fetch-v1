/**
 * LinkedIn Scraper App — CSV or multi-sheet XLSX in, a matching file out.
 *
 * The end user drops a file containing a column named "originalQuery/query"
 * (one LinkedIn profile URL per row) and runs:
 *
 *   node app.js contacts.csv
 *   node app.js "Data Refresh Sample.xlsx"
 *
 * CSV input -> one output CSV (same folder, new filename, timestamped).
 * XLSX input -> one output XLSX with the SAME sheet names/order as the
 * input. Each sheet that has an "originalQuery/query" column gets scraped;
 * any sheet without that column is copied through unchanged (nothing is
 * silently dropped). The input file is never modified.
 *
 * Collected columns:
 *   firstName, lastName, headline,
 *   currentPosition/0/position, currentPosition/0/companyName,
 *   currentPosition/0/duration, currentPosition/0/endDate/text,
 *   followers count, currentPosition/0/companyLinkedinUrl,
 *   location/parsed/country, employeeCountRange/start,
 *   industries/0/name, website, companyType
 *
 * Any field LinkedIn doesn't expose for a given profile (e.g. companyType,
 * education) is simply left blank — the row is never dropped for missing
 * data. A profile that fails outright (private, deleted, network error)
 * is also kept in the output with its scraped columns blank, so every
 * output table always has exactly as many rows as its input table.
 *
 * Usage:
 *   node app.js <input.csv|input.xlsx> [output-path]
 */

const fs = require("fs");
const path = require("path");

const { createBrowser, closeBrowser } = require("./browser/browser");
const { parseCsv, toCsv } = require("./utils/csv");
const { readWorkbook, writeWorkbook } = require("./utils/xlsx");
const { processTable } = require("./utils/worker-pool");
const CONFIG = require("./config/concurrency");
const log = require("./utils/logger");

const URL_COLUMN = "originalQuery/query";

function buildOutputPath(inputPath, explicitOutputPath, ext) {

    if (explicitOutputPath) {
        if (path.resolve(explicitOutputPath) === path.resolve(inputPath)) {
            throw new Error("Output path must differ from the input path.");
        }
        return explicitOutputPath;
    }

    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    return path.join(dir, `${base}-results-${stamp}${ext}`);
}

async function runCsv(inputPath, explicitOutputPath, concurrency) {

    const outputPath = buildOutputPath(inputPath, explicitOutputPath, ".csv");
    const { headers, rows } = parseCsv(fs.readFileSync(inputPath, "utf-8"));

    if (!headers.includes(URL_COLUMN)) {
        throw new Error(
            `Input CSV must have a "${URL_COLUMN}" column. Found: ${headers.join(", ")}`
        );
    }

    log.title(`LINKEDIN SCRAPER APP — ${rows.length} profiles (concurrency: ${concurrency})`);
    log.info(`Input:  ${inputPath}`);
    log.info(`Output: ${outputPath}`);

    const { browser, context } = await createBrowser();
    const session = { expired: false };
    let result;

    try {
        result = await processTable(context, { name: "csv", headers, rows }, session, concurrency);
    } finally {
        await closeBrowser(browser);
    }

    fs.writeFileSync(outputPath, toCsv(result.headers, result.rows));

    logRunSummary(result.stats, result.succeeded, result.failed);
    log.success(`Saved: ${outputPath}`);

    return outputPath;
}

async function runXlsx(inputPath, explicitOutputPath, concurrency) {

    const outputPath = buildOutputPath(inputPath, explicitOutputPath, ".xlsx");
    const sheets = await readWorkbook(inputPath);

    const scrapable = sheets.filter(s => s.headers.includes(URL_COLUMN));
    const skipped = sheets.filter(s => !s.headers.includes(URL_COLUMN));

    if (scrapable.length === 0) {
        throw new Error(
            `No sheet has a "${URL_COLUMN}" column. Sheets found: ${sheets.map(s => s.name).join(", ")}`
        );
    }

    log.title(`LINKEDIN SCRAPER APP — ${sheets.length} sheet(s), ${scrapable.length} scrapable (concurrency: ${concurrency})`);
    log.info(`Input:  ${inputPath}`);
    log.info(`Output: ${outputPath}`);

    if (skipped.length) {
        log.warning(`Skipping (no "${URL_COLUMN}" column, copied through unchanged): ${skipped.map(s => s.name).join(", ")}`);
    }

    const { browser, context } = await createBrowser();
    const session = { expired: false };
    const outputSheets = [];
    const totals = { succeeded: 0, failed: 0, timeouts: 0, crashes: 0, sessionErrors: 0, retries: 0 };

    try {
        for (const sheet of sheets) {

            if (!sheet.headers.includes(URL_COLUMN)) {
                outputSheets.push(sheet);
                continue;
            }

            const result = await processTable(context, sheet, session, concurrency);
            outputSheets.push(result);
            totals.succeeded += result.succeeded;
            totals.failed += result.failed;
            for (const key of ["timeouts", "crashes", "sessionErrors", "retries"]) {
                totals[key] += result.stats[key];
            }
        }
    } finally {
        await closeBrowser(browser);
    }

    await writeWorkbook(outputPath, outputSheets);

    logRunSummary(totals, totals.succeeded, totals.failed);
    log.success(`Saved: ${outputPath}`);

    return outputPath;
}

function logRunSummary(stats, succeeded, failed) {
    log.title("DONE");
    log.success(`${succeeded} succeeded`);
    if (failed) log.warning(`${failed} failed (left blank in output)`);
    if (stats.timeouts) log.warning(`${stats.timeouts} timeout(s)`);
    if (stats.crashes) log.warning(`${stats.crashes} tab crash(es)`);
    if (stats.sessionErrors) log.warning(`${stats.sessionErrors} session/auth failure(s)`);
    if (stats.retries) log.info(`${stats.retries} retry attempt(s)`);
}

async function run(inputPath, explicitOutputPath, concurrency = CONFIG.MAX_CONCURRENT_TABS) {

    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
    }

    const ext = path.extname(inputPath).toLowerCase();

    if (ext === ".xlsx") {
        return runXlsx(inputPath, explicitOutputPath, concurrency);
    }
    if (ext === ".csv") {
        return runCsv(inputPath, explicitOutputPath, concurrency);
    }

    throw new Error(`Unsupported file type "${ext}". Use .csv or .xlsx.`);
}

if (require.main === module) {

    if (process.argv[2] === "--login") {
        const { runLogin } = require("./login");
        runLogin().catch(err => {
            log.error(err.message);
            process.exitCode = 1;
        });
    } else {

        // --concurrency=N can appear anywhere; remaining args are
        // positional (input path, then optional output path).
        const rawArgs = process.argv.slice(2);
        let concurrency = CONFIG.MAX_CONCURRENT_TABS;

        const positional = rawArgs.filter(arg => {
            const match = arg.match(/^--concurrency=(\d+)$/);
            if (match) {
                concurrency = parseInt(match[1], 10);
                return false;
            }
            return true;
        });

        const [inputPath, explicitOutputPath] = positional;

        if (!inputPath) {
            console.error("Usage: node app.js <input.csv|input.xlsx> [output-path] [--concurrency=N]");
            console.error("       node app.js --login");
            process.exit(1);
        }

        run(inputPath, explicitOutputPath, concurrency).catch(err => {
            log.error(err.message);
            process.exitCode = 1;
        });
    }
}

module.exports = { run };
