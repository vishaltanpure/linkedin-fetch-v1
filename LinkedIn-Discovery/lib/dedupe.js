/**
 * Suppression / deduplication list.
 *
 * Loads previously captured LinkedIn profile URLs from CSV / XLSX / XLS
 * (any column that looks like a LinkedIn /in/ URL) and exposes
 * O(1) membership checks via normalized keys.
 */

const path = require("path");
const { normalizeProfileUrl } = require("./normalize-url");
const { readAnySheet } = require("./read-sheet");

// Prefer known URL columns; fall back to scanning every cell.
const PREFERRED_URL_COLUMNS = [
    "originalQuery/query",
    "Original LinkedIn URL",
    "profileUrl",
    "linkedinUrl",
    "LinkedIn URL",
    "url"
];

function collectUrlsFromRows(headers, rows) {
    const preferred = PREFERRED_URL_COLUMNS.filter(c => headers.includes(c));
    const columnsToScan = preferred.length > 0 ? preferred : headers;

    const urls = [];
    for (const row of rows) {
        for (const col of columnsToScan) {
            const value = row[col];
            if (!value) continue;
            const key = normalizeProfileUrl(value);
            if (key) urls.push({ raw: String(value).trim(), key });
        }
    }
    return urls;
}

/**
 * Build a Set of normalized profile URL keys from an existing sheet.
 * @returns {Promise<{ keys: Set<string>, count: number, source: string }>}
 */
async function loadExistingProfileKeys(filePath) {
    const keys = new Set();
    if (!filePath) {
        return { keys, count: 0, source: "" };
    }

    const abs = path.resolve(filePath);
    const sheets = await readAnySheet(abs);

    for (const sheet of sheets) {
        for (const { key } of collectUrlsFromRows(sheet.headers, sheet.rows)) {
            keys.add(key);
        }
    }

    return { keys, count: keys.size, source: abs };
}

/**
 * Mutable dedupe tracker for one discovery run.
 * Checks both the preloaded existing sheet AND URLs already accepted this run.
 */
function createDedupeTracker(existingKeys) {
    const existing = existingKeys || new Set();
    const seenThisRun = new Set();

    const stats = {
        existingSkipped: 0,
        duplicateSkipped: 0,
        accepted: 0
    };

    function classify(url) {
        const key = normalizeProfileUrl(url);
        if (!key) return { action: "invalid", key: "" };
        if (existing.has(key)) return { action: "existing", key };
        if (seenThisRun.has(key)) return { action: "duplicate", key };
        return { action: "new", key };
    }

    function accept(url) {
        const result = classify(url);
        if (result.action === "existing") {
            stats.existingSkipped++;
            return { ok: false, reason: "existing", key: result.key };
        }
        if (result.action === "duplicate") {
            stats.duplicateSkipped++;
            return { ok: false, reason: "duplicate", key: result.key };
        }
        if (result.action === "invalid") {
            return { ok: false, reason: "invalid", key: "" };
        }
        seenThisRun.add(result.key);
        stats.accepted++;
        return { ok: true, reason: "new", key: result.key };
    }

    return {
        classify,
        accept,
        stats,
        size: () => seenThisRun.size,
        has: url => {
            const key = normalizeProfileUrl(url);
            return key ? existing.has(key) || seenThisRun.has(key) : false;
        }
    };
}

module.exports = {
    loadExistingProfileKeys,
    createDedupeTracker,
    collectUrlsFromRows,
    PREFERRED_URL_COLUMNS
};
