/**
 * Discovery orchestration:
 *   1. Load existing sheet → suppression set
 *   2. Paginate LinkedIn / Sales Navigator search → unique NEW profile URLs
 *   3. Scrape each URL with the parent app's scrapeProfile()
 *   4. Map to the same output columns as the enrichment app
 *   5. Export CSV/XLSX + print stats
 */

const fs = require("fs");
const path = require("path");

const { createBrowser, closeBrowser } = require("../../browser/browser");
const { scrapeProfile } = require("../../index");
const { isValidLinkedInProfileUrl } = require("../../utils/linkedin-url");
const { OUTPUT_COLUMNS, ORIGINAL_URL_COLUMN, mapToRow } = require("../../utils/schema-mapper");
const { toCsv } = require("../../utils/csv");
const { writeWorkbook } = require("../../utils/xlsx");
const { withTimeout } = require("../../utils/timeout");
const Delay = require("../../utils/delay");
const log = require("../../utils/logger");
const PARENT_CONFIG = require("../../config/concurrency");

const { loadExistingProfileKeys, createDedupeTracker } = require("./dedupe");
const { discoverProfileUrls } = require("./search");
const { getAppRoot } = require("./app-root");
const { describeSearchCriteria } = require("./search-filters");
const { salesLeadToProfileUrl } = require("./normalize-url");

const URL_COLUMN = "originalQuery/query";
const SEARCH_QUERY_COLUMN = "searchQuery";
const SEARCH_MODE_COLUMN = "searchMode";

function blankRow(url) {
    const blank = {};
    for (const col of OUTPUT_COLUMNS) blank[col] = "";
    blank[ORIGINAL_URL_COLUMN] = url || "";
    return blank;
}

function buildOutputPath(explicit, ext, suffix = "") {
    if (explicit) return path.resolve(explicit);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(getAppRoot(), "output");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `discovery-results${suffix}-${stamp}${ext}`);
}

function printStats(summary) {
    log.title("DISCOVERY STATS");
    console.log(`Search criteria:              ${summary.query}`);
    if (summary.searchMode) {
        console.log(`Search mode:                  ${summary.searchMode}`);
    }
    console.log(`Requested (new unique):       ${summary.requested}`);
    console.log(`Search pages visited:         ${summary.pagesVisited}`);
    console.log(`Profiles found in search:     ${summary.profilesFound}`);
    console.log(`Profiles searched (checked):  ${summary.profilesSearched}`);
    console.log(`Existing profiles skipped:    ${summary.existingSkipped}`);
    console.log(`Duplicate profiles skipped:   ${summary.duplicateSkipped}`);
    console.log(`New URLs queued:              ${summary.newUrlsQueued}`);
    console.log(`New profiles captured:        ${summary.captured}`);
    console.log(`Scrape failures:              ${summary.scrapeFailed}`);
    if (summary.captured < summary.requested) {
        log.warning(
            `Requested: ${summary.requested} — New profiles found: ${summary.captured} — ` +
            `Existing/duplicate skipped: ${summary.existingSkipped + summary.duplicateSkipped}`
        );
        log.warning("No additional matching profiles available (or max pages reached).");
    } else {
        log.success(`Collected ${summary.captured} new unique profiles.`);
    }
}

function toScrapeUrl(url) {
    if (isValidLinkedInProfileUrl(url)) return url;
    const fromLead = salesLeadToProfileUrl(url);
    if (fromLead) return fromLead;
    throw new Error(`Not a LinkedIn profile URL: ${url}`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scrape discovered URLs on concurrent tabs in ONE authenticated context.
 * Extra browser processes for the same account do not help (same cookies,
 * same LinkedIn rate limit) and raise checkpoint risk.
 */
async function scrapeUrls(context, urls, jobTimeoutMs, searchDescription, concurrency = 1) {
    const results = new Array(urls.length);
    let captured = 0;
    let scrapeFailed = 0;
    let nextIndex = 0;
    let sessionExpired = false;

    const effective = Math.max(1, Math.min(concurrency, urls.length || 1));
    if (effective > 1) {
        log.info(`Scrape concurrency: ${effective} tabs (same session)`);
    }

    async function worker(workerId) {
        const label = effective > 1 ? `[w${workerId}]` : "";
        if (effective > 1) {
            await sleep(workerId * PARENT_CONFIG.WORKER_START_STAGGER_MS);
        }

        let page = await context.newPage();
        page.setDefaultTimeout(30000);

        try {
            while (true) {
                if (sessionExpired) break;
                const i = nextIndex++;
                if (i >= urls.length) break;

                const rawUrl = urls[i];
                log.title(`${label} [scrape ${i + 1}/${urls.length}] ${rawUrl}`);

                try {
                    const profileUrl = toScrapeUrl(rawUrl);
                    const record = await withTimeout(
                        scrapeProfile(page, profileUrl),
                        jobTimeoutMs,
                        `Profile timed out after ${jobTimeoutMs}ms`
                    );
                    results[i] = {
                        [SEARCH_QUERY_COLUMN]: searchDescription,
                        [URL_COLUMN]: profileUrl,
                        ...mapToRow(record)
                    };
                    captured++;
                    log.success(`${label} Scraped`);
                } catch (err) {
                    scrapeFailed++;
                    log.error(`${label} Scrape failed (${err.message}) — continuing`);
                    results[i] = {
                        [SEARCH_QUERY_COLUMN]: searchDescription,
                        [URL_COLUMN]: rawUrl,
                        ...blankRow(rawUrl)
                    };

                    if (/login|authwall|checkpoint|session expired/i.test(err.message || "")) {
                        sessionExpired = true;
                        throw err;
                    }

                    if (/crashed|has been closed|target closed|timed out after/i.test(err.message || "")) {
                        await page.close().catch(() => {});
                        page = await context.newPage();
                        page.setDefaultTimeout(30000);
                    }
                }

                if (!sessionExpired && nextIndex < urls.length) {
                    await Delay.long(page);
                }
            }
        } finally {
            await page.close().catch(() => {});
        }
    }

    const workers = [];
    for (let w = 0; w < effective; w++) workers.push(worker(w));
    await Promise.all(workers);

    return {
        rows: results.filter(Boolean),
        captured,
        scrapeFailed
    };
}

/**
 * Run one search job (criteria object from search-filters.js).
 */
async function runDiscoveryJob(context, searchPage, criteria, globalExistingKeys, options = {}) {
    const jobTimeoutMs = PARENT_CONFIG.JOB_TIMEOUT_MS;
    const maxPages = criteria.maxPages || options.maxPages || 40;
    const concurrency = options.concurrency || 2;
    const description = describeSearchCriteria(criteria);

    log.title(`SEARCH JOB: ${description}`);
    log.info(`Mode: ${criteria.mode} | Target new unique: ${criteria.count}`);

    // Per-job existing sheet overrides global
    let existingKeys = globalExistingKeys;
    if (criteria.existingSheet) {
        const loaded = await loadExistingProfileKeys(criteria.existingSheet);
        log.info(`Job existing sheet: ${loaded.source} (${loaded.count} URLs)`);
        existingKeys = loaded.keys;
    }

    const dedupe = createDedupeTracker(existingKeys);

    const summary = {
        query: description,
        searchMode: criteria.mode,
        requested: criteria.count,
        pagesVisited: 0,
        profilesFound: 0,
        profilesSearched: 0,
        existingSkipped: 0,
        duplicateSkipped: 0,
        newUrlsQueued: 0,
        captured: 0,
        scrapeFailed: 0
    };

    const { urls, stats: searchStats, criteria: resolved } = await discoverProfileUrls(
        searchPage,
        criteria,
        criteria.count,
        dedupe,
        maxPages
    );

    summary.query = describeSearchCriteria(resolved || criteria);
    summary.searchMode = searchStats.searchMode;

    Object.assign(summary, {
        pagesVisited: searchStats.pagesVisited,
        profilesFound: searchStats.profilesFound,
        profilesSearched: searchStats.profilesSearched,
        existingSkipped: searchStats.existingSkipped,
        duplicateSkipped: searchStats.duplicateSkipped,
        newUrlsQueued: searchStats.newUrlsQueued
    });

    if (urls.length === 0) {
        log.warning("No new unique profiles to scrape for this job.");
        printStats(summary);
        return { rows: [], summary };
    }

    const { rows, captured, scrapeFailed } = await scrapeUrls(
        context,
        urls,
        jobTimeoutMs,
        summary.query,
        concurrency
    );

    summary.captured = captured;
    summary.scrapeFailed = scrapeFailed;

    printStats(summary);
    return { rows, summary };
}

/**
 * Main discovery entry — single job or batch from criteria.
 */
async function runDiscovery(options) {
    const {
        criteria,
        existingPath,
        outputPath,
        format = "csv",
        maxPages = 40,
        concurrency = 2,
        forcePeopleSearch = false
    } = options;

    if (!criteria) {
        throw new Error("criteria is required");
    }

    if (forcePeopleSearch) criteria.forcePeopleSearch = true;

    log.title("LINKEDIN-DISCOVERY");

    const globalExisting = await loadExistingProfileKeys(existingPath);
    if (globalExisting.source) {
        log.info(`Global existing sheet: ${globalExisting.source} (${globalExisting.count} URLs)`);
    }

    const { browser, context, page } = await createBrowser();

    try {
        const { rows, summary } = await runDiscoveryJob(
            context,
            page,
            criteria,
            globalExisting.keys,
            { maxPages, concurrency }
        );

        if (rows.length === 0) {
            return { outputPath: null, rows: [], summary };
        }

        const ext = format === "xlsx" ? ".xlsx" : ".csv";
        const outFile = buildOutputPath(outputPath, ext);

        const headers = [SEARCH_QUERY_COLUMN, URL_COLUMN, ...OUTPUT_COLUMNS];

        if (ext === ".xlsx") {
            await writeWorkbook(outFile, [{ name: "Discovery", headers, rows }]);
        } else {
            fs.writeFileSync(outFile, toCsv(headers, rows));
        }

        log.success(`Saved: ${outFile}`);
        return { outputPath: outFile, rows, summary };
    } finally {
        await closeBrowser(browser);
    }
}

/**
 * Run multiple search jobs from an Excel/CSV input file sequentially.
 */
async function runDiscoveryBatch(jobs, options = {}) {
    const { existingPath, outputPath, format = "csv", maxPages = 40, concurrency = 2, forcePeopleSearch = false } = options;

    log.title("LINKEDIN-DISCOVERY — BATCH");
    log.info(`${jobs.length} search job(s) loaded`);

    const globalExisting = await loadExistingProfileKeys(existingPath);
    if (globalExisting.source) {
        log.info(`Global existing sheet: ${globalExisting.source} (${globalExisting.count} URLs)`);
    }

    const { browser, context, page } = await createBrowser();
    const allRows = [];
    const summaries = [];

    try {
        for (let j = 0; j < jobs.length; j++) {
            if (forcePeopleSearch) jobs[j].forcePeopleSearch = true;
            log.title(`BATCH JOB ${j + 1}/${jobs.length}`);
            const { rows, summary } = await runDiscoveryJob(
                context,
                page,
                jobs[j],
                globalExisting.keys,
                { maxPages, concurrency }
            );
            allRows.push(...rows);
            summaries.push(summary);
            if (j < jobs.length - 1) await Delay.long(page);
        }
    } finally {
        await closeBrowser(browser);
    }

    if (allRows.length === 0) {
        log.warning("Batch complete — no new profiles captured.");
        return { outputPath: null, rows: [], summaries };
    }

    const ext = format === "xlsx" ? ".xlsx" : ".csv";
    const outFile = buildOutputPath(outputPath, ext, "-batch");

    const headers = [SEARCH_QUERY_COLUMN, URL_COLUMN, ...OUTPUT_COLUMNS];

    if (ext === ".xlsx") {
        await writeWorkbook(outFile, [{ name: "Discovery", headers, rows: allRows }]);
    } else {
        fs.writeFileSync(outFile, toCsv(headers, allRows));
    }

    log.success(`Batch saved: ${outFile} (${allRows.length} rows)`);
    return { outputPath: outFile, rows: allRows, summaries };
}

module.exports = {
    runDiscovery,
    runDiscoveryBatch,
    URL_COLUMN,
    SEARCH_QUERY_COLUMN,
    SEARCH_MODE_COLUMN
};
