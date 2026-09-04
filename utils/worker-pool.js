/**
 * Concurrent profile scraping using a pool of tabs (pages) sharing ONE
 * authenticated browser context — same session, same cookies, multiple
 * simultaneous navigation streams. concurrency=1 is a worker pool of one:
 * behaves identically to the original sequential loop (same log format,
 * same pacing), so existing single-tab usage is unaffected by default.
 *
 * Job queue: a single shared `nextIndex` cursor into the input rows.
 * Safe without locks — Node's single-threaded event loop means
 * `nextIndex++` can't be interleaved by another worker mid-statement.
 * Each worker pulls the next row, scrapes it on its own page, writes the
 * result into `results[i]` (preserving input order regardless of
 * completion order), and loops until the queue is drained or the shared
 * session is marked expired.
 */

const { scrapeProfile } = require("../index");
const { OUTPUT_COLUMNS, mapToRow, blankMappedRow } = require("./schema-mapper");
const Delay = require("./delay");
const log = require("./logger");
const { withTimeout } = require("./timeout");
const CONFIG = require("../config/concurrency");

const URL_COLUMN = "originalQuery/query";

/** Excel hyperlink cells may still arrive as objects if read elsewhere. */
function coerceUrl(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") {
        const s = value.trim();
        return s === "[object Object]" ? "" : s;
    }
    if (typeof value === "object") {
        const link = value.hyperlink != null ? String(value.hyperlink).trim() : "";
        const text = value.text != null ? String(value.text).trim() : "";
        if (/linkedin\.com/i.test(link)) return link;
        if (/linkedin\.com/i.test(text)) return text;
        return link || text || "";
    }
    const s = String(value).trim();
    return s === "[object Object]" ? "" : s;
}

function isSessionError(err) {
    return /login|authwall|checkpoint|session expired/i.test(err.message || "");
}

function isCrashError(err) {
    return /crashed|has been closed|target closed/i.test(err.message || "");
}

function isTimeoutError(err) {
    return /timed out after \d+ms/i.test(err.message || "");
}

// Deterministic failures that a retry can never fix.
function isRetryableError(err) {
    if (isSessionError(err)) return false;
    if (/Invalid LinkedIn profile URL|Profile not found/i.test(err.message || "")) return false;
    return true;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scrape every row of one table (a CSV file's rows, or one XLSX sheet's
 * rows) using `concurrency` tabs against the given browser context.
 *
 * `session` is shared mutable state ({ expired: bool }) across every
 * table AND every worker in the run — once a session/authwall error is
 * confirmed by any worker, every remaining row (in this table AND any
 * later table) is left blank instead of retrying against a dead session.
 */
async function processTable(context, table, session, concurrency = CONFIG.MAX_CONCURRENT_TABS) {

    const { name, headers, rows } = table;

    // Output is exactly the mapped template columns (first column of the
    // mapping sheet). Input still requires originalQuery/query to find URLs.
    const outputColumns = [...OUTPUT_COLUMNS];

    const results = new Array(rows.length);
    const stats = {
        succeeded: 0,
        failed: 0,
        timeouts: 0,
        crashes: 0,
        sessionErrors: 0,
        retries: 0
    };

    let nextIndex = 0;
    const effectiveConcurrency = Math.max(1, Math.min(concurrency, rows.length || 1));

    function blankRowFor(_inputRow, url) {
        return blankMappedRow(url);
    }

    async function scrapeWithRetry(page, url, workerLabel) {
        let lastErr;

        for (let attempt = 1; attempt <= CONFIG.JOB_MAX_RETRIES + 1; attempt++) {
            try {
                return await withTimeout(
                    scrapeProfile(page, url),
                    CONFIG.JOB_TIMEOUT_MS,
                    `Profile timed out after ${CONFIG.JOB_TIMEOUT_MS}ms`
                );
            } catch (err) {
                lastErr = err;
                if (isTimeoutError(err)) stats.timeouts++;
                if (isCrashError(err)) stats.crashes++;

                if (!isRetryableError(err) || attempt > CONFIG.JOB_MAX_RETRIES) {
                    throw err;
                }

                stats.retries++;
                log.warning(`${workerLabel} Retry ${attempt}/${CONFIG.JOB_MAX_RETRIES} for ${url} (${err.message})`);
                await sleep(CONFIG.JOB_RETRY_BASE_DELAY_MS * attempt);
            }
        }

        throw lastErr;
    }

    async function worker(workerId) {

        const workerLabel = effectiveConcurrency > 1 ? `[${name}][w${workerId}]` : `[${name}]`;

        // Stagger concurrent workers' first request so N tabs starting up
        // doesn't read as a single burst of simultaneous requests.
        if (effectiveConcurrency > 1) {
            await sleep(workerId * CONFIG.WORKER_START_STAGGER_MS);
        }

        let page = await context.newPage();
        page.setDefaultTimeout(30000);

        try {
            while (true) {

                if (session.expired) break;

                const i = nextIndex++;
                if (i >= rows.length) break;

                const inputRow = rows[i];
                const url = coerceUrl(inputRow[URL_COLUMN]);

                if (!url) {
                    results[i] = blankRowFor(inputRow, url);
                    continue;
                }

                log.title(`${workerLabel} [${i + 1}/${rows.length}] ${url}`);

                try {
                    const record = await scrapeWithRetry(page, url, workerLabel);
                    // Output row = mapped template only.
                    // Linkedin Contact ← input URL (originalQuery/query) as-is
                    // Linkedin Public Profile URL ← resolved URL from scrape
                    results[i] = mapToRow(record, url);
                    stats.succeeded++;
                    log.success(`${workerLabel} Scraped`);
                } catch (err) {
                    stats.failed++;
                    log.error(`${workerLabel} Skipped (${err.message})`);
                    results[i] = blankRowFor(inputRow, url);

                    if (isSessionError(err)) {
                        stats.sessionErrors++;
                        session.expired = true;
                        log.error(
                            "Session appears expired. Re-run login to log in again. " +
                            "Remaining rows will be left blank."
                        );
                    } else if (isCrashError(err) || isTimeoutError(err)) {
                        // The page may be in a bad/stuck state after a crash or
                        // hang — recycle it rather than reuse, so the next job
                        // on this worker starts from a clean tab.
                        log.warning(`${workerLabel} Recycling tab after crash/timeout`);
                        await page.close().catch(() => {});
                        page = await context.newPage().catch(() => null);
                        if (page) {
                            page.setDefaultTimeout(30000);
                        } else {
                            log.error(`${workerLabel} Could not open a replacement tab — worker stopping`);
                            break;
                        }
                    }
                }

                // Between jobs: medium pacing (was Delay.long ~3.5–6s).
                if (!session.expired && nextIndex < rows.length) {
                    await Delay.medium(page);
                }
            }
        } finally {
            await page.close().catch(() => {});
        }
    }

    const workers = [];
    for (let w = 0; w < effectiveConcurrency; w++) {
        workers.push(worker(w));
    }
    await Promise.all(workers);

    // Fill any rows never reached (e.g. the queue was still non-empty when
    // the session was marked expired) so the output always matches the
    // input row count with the original URL preserved.
    for (let i = 0; i < rows.length; i++) {
        if (!results[i]) {
            const inputRow = rows[i];
            const url = coerceUrl(inputRow[URL_COLUMN]);
            results[i] = blankRowFor(inputRow, url);
        }
    }

    return {
        name,
        headers: outputColumns,
        rows: results,
        succeeded: stats.succeeded,
        failed: stats.failed,
        stats
    };
}

module.exports = {
    processTable,
    isSessionError,
    isCrashError,
    isTimeoutError,
    isRetryableError
};
