/**
 * Offline unit checks for URL normalize + dedupe (no LinkedIn / browser).
 *   node scripts/test-dedupe.js
 */

const assert = require("assert");
const path = require("path");
const { normalizeProfileUrl } = require("../lib/normalize-url");
const {
    createDedupeTracker,
    loadExistingProfileKeys
} = require("../lib/dedupe");

function checkNormalize() {
    const a = normalizeProfileUrl("https://www.linkedin.com/in/john-doe");
    const b = normalizeProfileUrl("https://www.linkedin.com/in/john-doe/");
    const c = normalizeProfileUrl("https://linkedin.com/in/john-doe");
    const d = normalizeProfileUrl("http://www.linkedin.com/in/john-doe?trk=abc");
    const e = normalizeProfileUrl("https://www.linkedin.com/in/John-Doe/");

    assert.strictEqual(a, b);
    assert.strictEqual(a, c);
    assert.strictEqual(a, d);
    assert.strictEqual(a, e);
    assert.strictEqual(a, "linkedin.com/in/john-doe");
    assert.strictEqual(normalizeProfileUrl("https://www.linkedin.com/company/acme"), "");

    const lead = normalizeProfileUrl(
        "https://www.linkedin.com/sales/lead/ACwAAAfX123,NAME_SEARCH,xyz"
    );
    assert.strictEqual(lead, "linkedin.com/in/acwaaafx123");
    const { salesLeadToProfileUrl } = require("../lib/normalize-url");
    assert.strictEqual(
        salesLeadToProfileUrl("https://www.linkedin.com/sales/lead/ACwAAAfX123,NAME_SEARCH"),
        "https://www.linkedin.com/in/ACwAAAfX123"
    );
    console.log("OK normalize");
}

async function checkDedupe() {
    const sample = path.join(__dirname, "..", "input", "existing.sample.csv");
    const { keys, count } = await loadExistingProfileKeys(sample);
    assert.ok(count >= 2, "expected at least 2 keys from sample");

    const dedupe = createDedupeTracker(keys);

    const existing = dedupe.accept("https://www.linkedin.com/in/example-existing-one/");
    assert.strictEqual(existing.ok, false);
    assert.strictEqual(existing.reason, "existing");

    const first = dedupe.accept("https://www.linkedin.com/in/brand-new-person");
    assert.strictEqual(first.ok, true);

    const dup = dedupe.accept("https://linkedin.com/in/brand-new-person/");
    assert.strictEqual(dup.ok, false);
    assert.strictEqual(dup.reason, "duplicate");

    assert.strictEqual(dedupe.stats.existingSkipped, 1);
    assert.strictEqual(dedupe.stats.duplicateSkipped, 1);
    assert.strictEqual(dedupe.stats.accepted, 1);
    console.log("OK dedupe");
}

(async () => {
    checkNormalize();
    await checkDedupe();
    console.log("ALL PASSED");
})().catch(err => {
    console.error("FAIL", err);
    process.exitCode = 1;
});
