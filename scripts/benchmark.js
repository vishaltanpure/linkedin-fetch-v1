/**
 * Benchmarks the worker pool at different concurrency levels against the
 * SAME fixed set of profiles, so the comparison is apples-to-apples.
 *
 * Usage:
 *   node scripts/benchmark.js 1,2,3
 */

const { createBrowser, closeBrowser } = require("../browser/browser");
const { processTable } = require("../utils/worker-pool");

const PROFILES = [
    "https://www.linkedin.com/in/diego-armando-pedraza-0bb49a117/",
    "https://www.linkedin.com/in/alejandro-leal-a5893110/",
    "https://www.linkedin.com/in/andrescordovezferretto/",
    "https://www.linkedin.com/in/montserrat-jocelin-mercado-perez/",
    "https://www.linkedin.com/in/hugo-pimentel-254b5247/",
    "https://www.linkedin.com/in/cesarvidalromero/"
];

function buildTable(name) {
    return {
        name,
        headers: ["originalQuery/query"],
        rows: PROFILES.map(url => ({ "originalQuery/query": url }))
    };
}

async function runLevel(concurrency) {
    const { browser, context } = await createBrowser();
    const session = { expired: false };
    const memBefore = process.memoryUsage().rss;
    const t0 = Date.now();

    let result;
    try {
        result = await processTable(context, buildTable(`bench-c${concurrency}`), session, concurrency);
    } finally {
        await closeBrowser(browser);
    }

    const totalMs = Date.now() - t0;
    const memAfter = process.memoryUsage().rss;

    return {
        concurrency,
        totalProfiles: PROFILES.length,
        totalSeconds: Number((totalMs / 1000).toFixed(1)),
        profilesPerMinute: Number((PROFILES.length / (totalMs / 60000)).toFixed(2)),
        avgSecPerProfile: Number((totalMs / 1000 / PROFILES.length).toFixed(1)),
        succeeded: result.succeeded,
        failed: result.failed,
        timeouts: result.stats.timeouts,
        crashes: result.stats.crashes,
        sessionErrors: result.stats.sessionErrors,
        retries: result.stats.retries,
        // Node process RSS only (our own process) — the real memory cost is
        // the Chromium tabs, which are separate OS processes. Reported as a
        // rough directional signal, not a precise total.
        nodeRssMb: Number(((memAfter - memBefore) / 1024 / 1024).toFixed(1))
    };
}

(async () => {
    const levels = (process.argv[2] || "1,2,3").split(",").map(Number);
    const results = [];

    for (const c of levels) {
        console.log(`\n===== Benchmarking concurrency=${c} (${PROFILES.length} profiles) =====`);
        const r = await runLevel(c);
        results.push(r);
        console.log(JSON.stringify(r, null, 2));
    }

    console.log("\n===== SUMMARY =====");
    console.table(results);
})();
