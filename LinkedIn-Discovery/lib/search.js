/**
 * LinkedIn People Search + Sales Navigator — discover profile URLs.
 *
 * Modes:
 *   people_search     — /search/results/people/?keywords=...
 *   sales_navigator   — /sales/search/people?query=...  (paste URL from SN UI)
 *
 * Multi-filter fidelity:
 *   Best:  salesNavigatorUrl, or Excel/CLI filters applied on the SN sidebar
 *   Fallback: filter columns composed into People Search keywords
 */

const Delay = require("../../utils/delay");
const log = require("../../utils/logger");
const {
    extractProfileUrlFromHref,
    normalizeProfileUrl
} = require("./normalize-url");
const {
    withPageParam
} = require("./search-filters");
const {
    hasStructuredFilters,
    detectSalesNavigatorAccess,
    applySalesNavigatorFilters
} = require("./sn-filters");

const PEOPLE_SEARCH_BASE = "https://www.linkedin.com/search/results/people/";

function buildPeopleSearchUrl(keywords, pageNum) {
    const params = new URLSearchParams({
        keywords: String(keywords || "").trim(),
        origin: "GLOBAL_SEARCH_HEADER",
        sid: "dis"
    });
    if (pageNum > 1) params.set("page", String(pageNum));
    return `${PEOPLE_SEARCH_BASE}?${params.toString()}`;
}

/**
 * Collect profile URLs from people search OR Sales Navigator results.
 */
function collectProfileHrefsInPage() {
    const hrefs = [];
    const seen = new Set();

    const selectors = [
        'a[href*="/in/"]',
        'a[href*="/sales/lead/"]',
        'a[data-control-name="search_srp_result"]'
    ];

    const anchors = new Set();
    for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(a => anchors.add(a));
    }

    for (const a of anchors) {
        let href = a.getAttribute("href") || "";
        if (!href) continue;

        if (href.startsWith("/")) {
            href = `https://www.linkedin.com${href}`;
        }

        // Sales Navigator lead link — keep full URL; scraper resolves via redirect
        if (/\/sales\/lead\//i.test(href)) {
            const key = href.split("?")[0].toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            hrefs.push(href.split("?")[0]);
            continue;
        }

        if (!/linkedin\.com\/in\/[^/?#]+/i.test(href)) continue;

        if (/\/in\/[^/]+\/(?:overlay|detail|recent-activity|details)/i.test(href)) {
            const m = href.match(/^(https?:\/\/[^/]+\/in\/[^/?#]+)/i);
            if (!m) continue;
            href = m[1];
        }

        const key = href.split("?")[0].split("#")[0].replace(/\/+$/, "").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        hrefs.push(href.split("?")[0].split("#")[0].replace(/\/+$/, ""));
    }

    return hrefs;
}

async function assertAuthenticated(page) {
    const url = page.url();
    if (/\/(login|authwall|checkpoint)/i.test(url)) {
        throw new Error(
            "Session expired or not logged in — run: node discovery-app.js --login"
        );
    }
    if (/\/sales\/(login|subscribe|upgrade)/i.test(url)) {
        throw new Error(
            "Sales Navigator access required — log in with a Sales Navigator account, " +
            "or use keywords-only people search (omit salesNavigatorUrl)."
        );
    }
}

function resolveSearchUrl(criteria, pageNum) {
    if (criteria.mode === "sales_navigator" && criteria.salesNavigatorUrl) {
        return withPageParam(criteria.salesNavigatorUrl, pageNum, "sales_navigator");
    }
    const keywords = criteria.composedKeywords || criteria.keywords || "";
    return buildPeopleSearchUrl(keywords, pageNum);
}

/**
 * Premium SN session + Excel/CLI filters → apply sidebar chips (screenshot).
 * No SN / --people-search → People Search keyword fallback.
 */
async function prepareSearchCriteria(page, criteria) {
    const resolved = { ...criteria };

    if (resolved.forcePeopleSearch) {
        resolved.mode = "people_search";
        log.info("Forced People Search (--people-search)");
        return resolved;
    }

    if (resolved.mode === "sales_navigator" && resolved.salesNavigatorUrl) {
        return resolved;
    }

    const wantsSn = hasStructuredFilters(resolved) || resolved.mode === "auto";
    if (!wantsSn && resolved.mode === "people_search") {
        return resolved;
    }

    const hasSn = await detectSalesNavigatorAccess(page);
    if (!hasSn) {
        log.warning(
            "No Sales Navigator on this account — using People Search keywords. " +
            "Log in with a premium SN account to apply sidebar filters."
        );
        resolved.mode = "people_search";
        return resolved;
    }

    log.info("Sales Navigator detected — building Lead-search URL from filters");
    const result = await applySalesNavigatorFilters(page, resolved);

    if (result.ok && result.url) {
        resolved.mode = "sales_navigator";
        resolved.salesNavigatorUrl = result.url;
        resolved.filtersApplied = result.applied;
        resolved.filtersFailed = result.failed;
        resolved.filtersReadyOnPage = true;
        log.info(`SN filters on: ${result.applied.join(" | ")}`);
        return resolved;
    }

    log.warning(
        (result.reason || "Could not apply SN filters") +
        " — falling back to People Search keywords. " +
        "For exact SN chips, paste salesNavigatorUrl from the browser address bar."
    );
    resolved.mode = "people_search";
    resolved.filtersFailed = result.failed;
    return resolved;
}

/**
 * Load one search results page and return discovered profile URLs.
 */
async function loadSearchPage(page, criteria, pageNum) {
    const alreadyOnFirst =
        pageNum === 1 &&
        criteria.filtersReadyOnPage &&
        /\/sales\/search\/people/i.test(page.url());

    if (!alreadyOnFirst) {
        const url = resolveSearchUrl(criteria, pageNum);
        const modeLabel = criteria.mode === "sales_navigator" ? "Sales Navigator" : "People Search";
        log.info(`${modeLabel} page ${pageNum}: ${url.slice(0, 120)}${url.length > 120 ? "..." : ""}`);

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });
    } else {
        log.info("Sales Navigator page 1: filters already applied (skip reload)");
    }

    await assertAuthenticated(page);

    await page
        .locator('a[href*="/in/"], a[href*="/sales/lead/"]')
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => {});

    // SN lazy-loads; one pass is enough once cards are present
    await page.evaluate(() => window.scrollBy(0, 1400)).catch(() => {});
    await Delay.short(page);

    const rawHrefs = await page.evaluate(collectProfileHrefsInPage).catch(() => []);

    const urls = [];
    const seen = new Set();
    for (const href of rawHrefs) {
        let extracted = extractProfileUrlFromHref(href) || href;

        // sales/lead URLs — keep as-is for navigation (redirects to profile)
        if (/\/sales\/lead\//i.test(extracted)) {
            const key = extracted.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                urls.push(extracted);
            }
            continue;
        }

        const key = normalizeProfileUrl(extracted);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        urls.push(extracted);
    }

    const emptyHint = await page.evaluate(() => {
        const text = (document.querySelector("main")?.innerText || document.body?.innerText || "").slice(0, 1200);
        return /no results|0 results|try another search|we couldn't find|no leads match|adjust your filters/i.test(text);
    }).catch(() => false);

    return {
        pageNum,
        urls,
        empty: emptyHint || urls.length === 0
    };
}

/**
 * Paginate search until enough NEW unique URLs are queued.
 *
 * @param {import('playwright').Page} page
 * @param {object} criteria — from parseSearchJob / parseCliFilters
 * @param {number} targetCount
 * @param {object} dedupe
 * @param {number} [maxPages=40]
 */
async function discoverProfileUrls(page, criteria, targetCount, dedupe, maxPages = 40) {
    if (!targetCount || targetCount < 1) {
        throw new Error("targetCount must be a positive number");
    }

    const resolved = await prepareSearchCriteria(page, criteria);

    const accepted = [];
    const stats = {
        searchMode: resolved.mode,
        pagesVisited: 0,
        profilesSearched: 0,
        profilesFound: 0,
        existingSkipped: 0,
        duplicateSkipped: 0,
        invalidSkipped: 0,
        newUrlsQueued: 0
    };

    let consecutiveEmpty = 0;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        if (accepted.length >= targetCount) break;

        const result = await loadSearchPage(page, resolved, pageNum);
        stats.pagesVisited++;
        stats.profilesFound += result.urls.length;

        if (result.empty && result.urls.length === 0) {
            consecutiveEmpty++;
            log.warning(`Search page ${pageNum}: no profile results`);
            if (consecutiveEmpty >= 2) {
                log.info("No additional matching profiles available.");
                break;
            }
            await Delay.short(page);
            continue;
        }
        consecutiveEmpty = 0;

        for (const url of result.urls) {
            stats.profilesSearched++;
            if (accepted.length >= targetCount) break;

            const decision = dedupe.accept(url);
            if (decision.ok) {
                accepted.push(url);
                stats.newUrlsQueued++;
                log.success(`Queued [${accepted.length}/${targetCount}] ${url}`);
            } else if (decision.reason === "existing") {
                stats.existingSkipped++;
                log.info(`Skip existing: ${url}`);
            } else if (decision.reason === "duplicate") {
                stats.duplicateSkipped++;
                log.info(`Skip in-run duplicate: ${url}`);
            } else {
                stats.invalidSkipped++;
            }
        }

        if (accepted.length >= targetCount) break;
        await Delay.short(page);
    }

    stats.existingSkipped = dedupe.stats.existingSkipped;
    stats.duplicateSkipped = dedupe.stats.duplicateSkipped;

    return { urls: accepted, stats, criteria: resolved };
}

module.exports = {
    buildPeopleSearchUrl,
    loadSearchPage,
    discoverProfileUrls,
    resolveSearchUrl,
    prepareSearchCriteria
};
