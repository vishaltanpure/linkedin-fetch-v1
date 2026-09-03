/**
 * Sales Navigator filter application.
 *
 * Primary path: build a real SN search URL from known filter IDs
 * (headcount / function / seniority / geography / industry / job title).
 * That matches the screenshot filters without brittle sidebar clicks.
 *
 * UI clicking is a last-resort fallback only.
 */

const Delay = require("../../utils/delay");
const log = require("../../utils/logger");
const { parseFilterList } = require("./search-filters");
const { buildSalesNavigatorUrl, SN_SEARCH_BASE } = require("./sn-url");

const SN_SEARCH_URL = SN_SEARCH_BASE;

const FILTER_SECTIONS = [
    { key: "companyHeadcount", titles: ["Company headcount"], kind: "checkbox" },
    { key: "function", titles: ["Function"], kind: "typeahead" },
    { key: "jobTitle", titles: ["Current job title", "Job title"], kind: "typeahead" },
    { key: "seniority", titles: ["Seniority level"], kind: "checkbox" },
    { key: "geography", titles: ["Geography"], kind: "typeahead" },
    { key: "industry", titles: ["Industry"], kind: "typeahead" }
];

function hasStructuredFilters(criteria) {
    return FILTER_SECTIONS.some(s => parseFilterList(criteria[s.key]).length > 0);
}

async function detectSalesNavigatorAccess(page) {
    await page.goto(SN_SEARCH_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });
    await Delay.short(page);

    // Filter panel / results take a moment after SPA boot
    await page
        .locator("text=/Company headcount|Geography|Seniority|Search keywords|results/i")
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});

    const url = page.url();
    if (/\/(login|authwall|checkpoint)/i.test(url)) {
        throw new Error(
            "Session expired or not logged in — run: node discovery-app.js --login"
        );
    }
    if (/\/sales\/(login|subscribe|upgrade|checkout)/i.test(url)) {
        return false;
    }
    if (/\/sales\/search\/people/i.test(url)) {
        return true;
    }
    if (/linkedin\.com\/sales\//i.test(url)) {
        await page.goto(SN_SEARCH_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });
        await Delay.short(page);
        return /\/sales\/search\/people/i.test(page.url()) &&
            !/\/sales\/(login|subscribe|upgrade)/i.test(page.url());
    }
    return false;
}

async function waitForResults(page) {
    await page
        .locator('a[href*="/sales/lead/"], a[href*="/in/"]')
        .first()
        .waitFor({ timeout: 25000 })
        .catch(() => {});
    await Delay.short(page);
}

/**
 * Apply Excel/CLI filters via SN URL (preferred), then load results.
 * Returns { applied, failed, url, method }.
 *
 * Does NOT throw when filters can't be applied — caller can fall back
 * to People Search.
 */
async function applySalesNavigatorFilters(page, criteria) {
    const built = buildSalesNavigatorUrl(criteria);

    if (built.url) {
        log.info(`SN URL built with ${built.applied.length} filter value(s)`);
        for (const a of built.applied) log.success(`SN filter → ${a}`);
        if (built.failed.length) {
            log.warning(
                `Unmapped filter values (skipped): ${built.failed.join(", ")}. ` +
                `Paste a salesNavigatorUrl for exact match, or use a known value.`
            );
        }

        await page.goto(built.url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });
        await waitForResults(page);

        // Confirm we stayed on SN search (not upgrade wall)
        const url = page.url();
        if (/\/sales\/(login|subscribe|upgrade)/i.test(url)) {
            return {
                applied: [],
                failed: built.applied.concat(built.failed),
                url: null,
                method: "url",
                ok: false,
                reason: "Sales Navigator upgrade/login wall after filter URL"
            };
        }

        return {
            applied: built.applied,
            failed: built.failed,
            url,
            method: "url",
            ok: built.applied.length > 0 || !!criteria.keywords
        };
    }

    // Nothing we could encode into a URL
    return {
        applied: [],
        failed: built.failed.length ? built.failed : ["(no mappable filters)"],
        url: null,
        method: "url",
        ok: false,
        reason: "Could not map Excel/CLI filters to Sales Navigator IDs"
    };
}

module.exports = {
    SN_SEARCH_URL,
    FILTER_SECTIONS,
    hasStructuredFilters,
    detectSalesNavigatorAccess,
    applySalesNavigatorFilters
};
