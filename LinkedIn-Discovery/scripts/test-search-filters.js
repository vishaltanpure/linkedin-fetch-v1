/**
 * Offline tests for search-filters.js
 */
const assert = require("assert");
const {
    parseFilterList,
    buildKeywordsFromFilters,
    parseSearchJob,
    validateSearchJob,
    isSalesNavigatorUrl,
    withPageParam
} = require("../lib/search-filters");

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}`);
        throw err;
    }
}

console.log("search-filters tests\n");

test("parseFilterList splits comma and pipe", () => {
    assert.deepStrictEqual(parseFilterList("CXO, Director | VP"), ["CXO", "Director", "VP"]);
});

test("buildKeywordsFromFilters composes all fields", () => {
    const kw = buildKeywordsFromFilters({
        keywords: "CMO",
        geography: "India",
        industry: "Retail",
        seniority: "CXO,Director"
    });
    assert.ok(kw.includes("CMO"));
    assert.ok(kw.includes("India"));
    assert.ok(kw.includes("Retail"));
    assert.ok(kw.includes("CXO"));
    assert.ok(kw.includes("Director"));
});

test("parseSearchJob from Excel row", () => {
    const job = parseSearchJob({
        searchName: "India Retail",
        count: "50",
        geography: "India",
        industry: "Retail",
        seniority: "CXO,Director",
        "company headcount": "51-200, 201-500"
    });
    assert.strictEqual(job.count, 50);
    assert.strictEqual(job.mode, "auto");
    assert.strictEqual(job.hasStructuredFilters, true);
    assert.ok(job.composedKeywords.includes("India"));
    assert.ok(job.composedKeywords.includes("51-200"));
});

test("parseSearchJob with Sales Navigator URL", () => {
    const url = "https://www.linkedin.com/sales/search/people?query=(filters:List())";
    const job = parseSearchJob({ count: "10", salesNavigatorUrl: url });
    assert.strictEqual(job.mode, "sales_navigator");
    assert.ok(isSalesNavigatorUrl(job.salesNavigatorUrl));
    validateSearchJob(job);
});

test("validateSearchJob rejects empty criteria", () => {
    assert.throws(() => validateSearchJob({ count: 5, composedKeywords: "" }), /salesNavigatorUrl OR keywords/);
});

test("withPageParam adds page for SN", () => {
    const base = "https://www.linkedin.com/sales/search/people?query=abc";
    const p2 = withPageParam(base, 2, "sales_navigator");
    assert.ok(p2.includes("page=2"));
});

console.log("\nAll search-filters tests passed.");
