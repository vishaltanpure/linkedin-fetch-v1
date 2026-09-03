/**
 * Offline tests for sn-url.js (Sales Navigator URL builder)
 */
const assert = require("assert");
const { buildSalesNavigatorUrl } = require("../lib/sn-url");

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}`);
        throw err;
    }
}

console.log("sn-url tests\n");

test("builds URL for screenshot filters", () => {
    const { url, applied, failed } = buildSalesNavigatorUrl({
        companyHeadcount: "51-200,201-500",
        function: "Sales,Marketing,Information Technology",
        jobTitle: "Sales,Marketing",
        seniority: "CXO,Director",
        geography: "India",
        industry: "Retail"
    });

    assert.ok(url, "url should be built");
    assert.ok(url.includes("/sales/search/people"));
    assert.ok(url.includes("COMPANY_HEADCOUNT"));
    assert.ok(url.includes("id:D") && url.includes("id:E"), "headcount D+E");
    assert.ok(url.includes("FUNCTION"));
    assert.ok(url.includes("CURRENT_TITLE"));
    assert.ok(url.includes("SENIORITY_LEVEL"));
    assert.ok(url.includes("id:8") && url.includes("id:6"), "CXO+Director");
    assert.ok(url.includes("REGION") && url.includes("102713980"), "India geo");
    assert.ok(url.includes("INDUSTRY") && url.includes("id:27"), "Retail");
    assert.ok(applied.length >= 10, `expected many applied, got ${applied.length}`);
    assert.strictEqual(failed.length, 0, `unexpected failed: ${failed.join(", ")}`);
});

test("reports unmapped geography", () => {
    const { failed, applied } = buildSalesNavigatorUrl({
        seniority: "CXO",
        geography: "Atlantis"
    });
    assert.ok(failed.some(f => /Atlantis/i.test(f)));
    assert.ok(applied.some(a => /CXO/i.test(a)));
});

test("returns null url when nothing mappable", () => {
    const { url } = buildSalesNavigatorUrl({ geography: "Atlantis" });
    assert.strictEqual(url, null);
});

console.log("\nAll sn-url tests passed.");
