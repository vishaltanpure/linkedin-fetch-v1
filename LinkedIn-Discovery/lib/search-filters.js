/**
 * Sales Navigator / LinkedIn Discovery — search filter helpers.
 *
 * Three ways to search (best → fallback):
 *   1. salesNavigatorUrl — paste the full URL from Sales Navigator after
 *      applying filters in the UI (most accurate for multi-filter).
 *   2. Structured filter columns — applied on the SN Lead search sidebar
 *      when the session has Sales Navigator; otherwise composed into
 *      People Search keywords.
 *   3. keywords / query — free-text only.
 *
 * Excel/CSV column names (case-insensitive, aliases supported):
 *   count, keywords, salesNavigatorUrl,
 *   companyHeadcount, function, jobTitle, seniority,
 *   geography, industry, existingSheet, maxPages, searchName
 */

const FILTER_FIELD_DEFS = [
    { key: "companyHeadcount", aliases: ["company headcount", "headcount", "company_size", "employeeRange"] },
    { key: "function", aliases: ["role function", "roleFunction", "department"] },
    { key: "jobTitle", aliases: ["current job title", "title", "currentTitle", "job title"] },
    { key: "seniority", aliases: ["seniority level", "seniorityLevel", "level"] },
    { key: "geography", aliases: ["geo", "location", "region", "country"] },
    { key: "industry", aliases: ["sector"] }
];

/** Columns on the search-jobs input sheet (any one row = one discovery run). */
const SEARCH_JOB_COLUMNS = [
    "searchName",
    "count",
    "keywords",
    "salesNavigatorUrl",
    "companyHeadcount",
    "function",
    "jobTitle",
    "seniority",
    "geography",
    "industry",
    "existingSheet",
    "maxPages"
];

function normalizeHeader(h) {
    return String(h || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[_/-]/g, "");
}

function pickRowValue(row, headers, key, aliases = []) {
    const wanted = new Set([
        normalizeHeader(key),
        ...aliases.map(normalizeHeader)
    ]);
    for (const h of headers) {
        if (wanted.has(normalizeHeader(h))) {
            const v = row[h];
            if (v !== undefined && v !== null && String(v).trim() !== "") {
                return String(v).trim();
            }
        }
    }
    return "";
}

/** Split "A, B | C" → ["A", "B", "C"] */
function parseFilterList(raw) {
    if (!raw) return [];
    return String(raw)
        .split(/[,|;]/)
        .map(s => s.trim())
        .filter(Boolean);
}

function buildKeywordsFromFilters(filters) {
    const parts = [];

    if (filters.keywords) parts.push(filters.keywords);

    for (const def of FILTER_FIELD_DEFS) {
        const values = parseFilterList(filters[def.key]);
        parts.push(...values);
    }

    // Dedupe while preserving order
    const seen = new Set();
    const unique = [];
    for (const p of parts) {
        const k = p.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        unique.push(p);
    }

    return unique.join(" ");
}

/**
 * Normalize a Sales Navigator search URL (strip page/start for base).
 */
function normalizeSalesNavigatorUrl(url) {
    if (!url) return "";
    let u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) {
        if (u.startsWith("linkedin.com") || u.startsWith("www.")) {
            u = `https://${u}`;
        }
    }
    if (!/\/sales\/search\/people/i.test(u) && !/\/sales\/search\/people/i.test(u)) {
        // Allow pasted path-only SN URLs
        if (/sales\/search\/people/i.test(u)) {
            u = u.startsWith("http") ? u : `https://www.linkedin.com/${u.replace(/^\//, "")}`;
        }
    }
    return u;
}

function isSalesNavigatorUrl(url) {
    return /linkedin\.com\/sales\/search\/people/i.test(String(url || ""));
}

/**
 * Append / replace page param on SN or people search URL.
 */
function withPageParam(baseUrl, pageNum, mode) {
    const u = new URL(baseUrl);

    if (mode === "sales_navigator") {
        // SN uses page=2, page=3, ...
        if (pageNum > 1) u.searchParams.set("page", String(pageNum));
        else u.searchParams.delete("page");
        return u.toString();
    }

    // Regular people search
    if (pageNum > 1) u.searchParams.set("page", String(pageNum));
    else u.searchParams.delete("page");
    return u.toString();
}

/**
 * Build a human-readable label for logs / searchQuery column.
 */
function describeSearchCriteria(criteria) {
    if (criteria.salesNavigatorUrl) {
        return criteria.searchName ||
            `Sales Navigator search (${criteria.salesNavigatorUrl.slice(0, 80)}...)`;
    }

    const filterBits = [];
    for (const def of FILTER_FIELD_DEFS) {
        const v = criteria[def.key];
        if (v) filterBits.push(`${def.key}=${v}`);
    }

    const base = criteria.keywords || criteria.composedKeywords || "";
    if (filterBits.length) {
        return [base, filterBits.join("; ")].filter(Boolean).join(" | ");
    }
    return base || "(empty criteria)";
}

/**
 * Parse one input row (Excel/CSV) or CLI opts into a search job.
 */
function parseSearchJob(row, headers = Object.keys(row || {})) {
    const get = (key, aliases) => pickRowValue(row, headers, key, aliases);

    const salesNavigatorUrl = normalizeSalesNavigatorUrl(
        get("salesNavigatorUrl", ["snUrl", "sales_navigator_url", "navigatorUrl"])
    );

    const filters = {
        keywords: get("keywords", ["query", "search", "searchQuery"]),
        companyHeadcount: get("companyHeadcount"),
        function: get("function"),
        jobTitle: get("jobTitle"),
        seniority: get("seniority"),
        geography: get("geography"),
        industry: get("industry")
    };

    const composedKeywords = buildKeywordsFromFilters(filters);

    const countRaw = get("count", ["n", "limit", "target"]);
    const count = parseInt(countRaw, 10);

    const maxPagesRaw = get("maxPages", ["maxpages", "pages"]);
    const maxPages = maxPagesRaw ? parseInt(maxPagesRaw, 10) : undefined;

    const hasFilters = FILTER_FIELD_DEFS.some(def => parseFilterList(filters[def.key]).length > 0);

    const criteria = {
        searchName: get("searchName", ["name", "label"]),
        count,
        ...filters,
        composedKeywords,
        salesNavigatorUrl,
        existingSheet: get("existingSheet", ["existing", "dedupeSheet", "suppressionList"]),
        maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : undefined,
        forcePeopleSearch: false,
        hasStructuredFilters: hasFilters,
        // auto = detect SN at runtime and apply sidebar filters
        mode: isSalesNavigatorUrl(salesNavigatorUrl)
            ? "sales_navigator"
            : hasFilters
                ? "auto"
                : "people_search"
    };

    criteria.description = describeSearchCriteria(criteria);

    return criteria;
}

/**
 * Parse CLI filter flags into the same shape as an Excel row.
 */
function parseCliFilters(opts) {
    return parseSearchJob({
        searchName: opts.searchName || "",
        count: String(opts.count || ""),
        keywords: opts.query || "",
        salesNavigatorUrl: opts.salesNavigatorUrl || "",
        companyHeadcount: opts.companyHeadcount || "",
        function: opts.function || "",
        jobTitle: opts.jobTitle || "",
        seniority: opts.seniority || "",
        geography: opts.geography || "",
        industry: opts.industry || "",
        existingSheet: opts.existingPath || "",
        maxPages: opts.maxPages ? String(opts.maxPages) : ""
    });
}

function validateSearchJob(job) {
    if (!Number.isFinite(job.count) || job.count < 1) {
        throw new Error("count must be a positive integer");
    }

    const hasSn = isSalesNavigatorUrl(job.salesNavigatorUrl);
    const hasKeywords = !!(job.composedKeywords || job.keywords);
    const hasFilters = !!(job.hasStructuredFilters);

    if (!hasSn && !hasKeywords && !hasFilters) {
        throw new Error(
            "Search job needs either salesNavigatorUrl OR keywords/filter columns " +
            "(geography, industry, seniority, function, jobTitle, companyHeadcount)"
        );
    }

    return job;
}

module.exports = {
    hasStructuredFilters: (filters) =>
        FILTER_FIELD_DEFS.some(def => parseFilterList(filters[def.key]).length > 0),
    FILTER_FIELD_DEFS,
    SEARCH_JOB_COLUMNS,
    parseFilterList,
    buildKeywordsFromFilters,
    normalizeSalesNavigatorUrl,
    isSalesNavigatorUrl,
    withPageParam,
    describeSearchCriteria,
    parseSearchJob,
    parseCliFilters,
    validateSearchJob
};
