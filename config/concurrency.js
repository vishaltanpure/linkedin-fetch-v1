/**
 * Worker-pool configuration for concurrent profile scraping.
 *
 * Scope: multiple TABS within ONE authenticated browser context/session —
 * not multiple accounts. See PACKAGING.md / project notes for why: from
 * LinkedIn's side, multiple tabs vs multiple browser processes for the
 * SAME account produce an identical request pattern, so there's no
 * throughput benefit to spinning up separate browser instances unless
 * each is a genuinely different authenticated identity — which this
 * project deliberately does not orchestrate.
 *
 * Every value can be overridden via environment variable without
 * touching code, e.g.:
 *   MAX_CONCURRENT_TABS=3 node app.js contacts.csv
 */

function int(envVar, fallback) {
    const raw = process.env[envVar];
    if (raw === undefined) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const CONFIG = {
    // How many profiles run at once against the single authenticated
    // session. 1 = existing sequential behavior, unchanged.
    MAX_CONCURRENT_TABS: int("MAX_CONCURRENT_TABS", 1),

    // A single profile (all 4 pipeline steps) must finish within this
    // window or its tab is considered hung and recycled. Sized to
    // comfortably cover the activity-fallback worst case: a profile
    // where /recent-activity/all/ renders empty needs up to 3 more
    // sequential tab checks (measured ~50s total) on top of the other
    // 3 pipeline steps (~20-30s combined) — verified 90s was too tight
    // and caused real profiles to fail after two full-length timeouts.
    JOB_TIMEOUT_MS: int("JOB_TIMEOUT_MS", 150000),

    // Extra attempts for a job that failed with a transient-looking error
    // (timeout, crash, navigation failure) — NOT for deterministic
    // failures like an invalid URL or a confirmed 404, which retrying
    // can never fix.
    JOB_MAX_RETRIES: int("JOB_MAX_RETRIES", 1),
    JOB_RETRY_BASE_DELAY_MS: int("JOB_RETRY_BASE_DELAY_MS", 3000),

    // Concurrent workers stagger their first request instead of all
    // firing at once, so N tabs starting up doesn't look like a single
    // burst of simultaneous requests.
    WORKER_START_STAGGER_MS: int("WORKER_START_STAGGER_MS", 1500)
};

module.exports = CONFIG;
