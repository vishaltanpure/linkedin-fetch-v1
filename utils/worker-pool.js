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
const { OUTPUT_COLUMNS, ORIGINAL_URL_COLUMN, mapToRow } = require("./schema-mapper");
const Delay = require("./delay");
const log = require("./logger");
const { withTimeout } = require("./timeout");
const CONFIG = require("../config/concurrency");

const URL_COLUMN = "originalQuery/query";
const OUTPUT_COLUMN_SET = new Set(OUTPUT_COLUMNS);

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

function blankScrapedFields() {
    const blank = {};
    for (const col of OUTPUT_COLUMNS) blank[col] = "";
    return blank;
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

    // Preserve only genuinely-foreign columns (e.g. "notes", "tag"). If
    // this table was already produced by a prior run of this app (or
    // manually pre-filled, like the Downloads sheet), it already carries
    // our own output column names — those must NOT be preserved as-is,
    // or they'd appear twice: once empty (stale header, never written
    // to) and once more further right with the freshly scraped values.
    const preservedHeaders = headers.filter(
        h => h !== URL_COLUMN && !OUTPUT_COLUMN_SET.has(h)
    );
    const outputColumns = [...preservedHeaders, URL_COLUMN, ...OUTPUT_COLUMNS];

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

    function blankRowFor(inputRow, url) {
        return { ...inputRow, [URL_COLUMN]: url, ...blankScrapedFields(), [ORIGINAL_URL_COLUMN]: url };
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
                const url = (inputRow[URL_COLUMN] || "").trim();

                if (!url) {
                    results[i] = blankRowFor(inputRow, url);
                    continue;
                }

                log.title(`${workerLabel} [${i + 1}/${rows.length}] ${url}`);

                try {
                    const record = await scrapeWithRetry(page, url, workerLabel);
                    // URL_COLUMN ("originalQuery/query") stays the raw input,
                    // unchanged. ORIGINAL_URL_COLUMN ("Original LinkedIn URL")
                    // comes from mapToRow(record) — the browser-resolved URL,
                    // NOT overridden back to the raw input here (that was the
                    // bug: it used to force this column back to the raw
                    // encoded URL even after a successful resolve+scrape).
                    results[i] = { ...inputRow, [URL_COLUMN]: url, ...mapToRow(record) };
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

                if (!session.expired && nextIndex < rows.length) {
                    await Delay.long(page);
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
            const url = (inputRow[URL_COLUMN] || "").trim();
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
