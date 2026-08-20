/**
 * DOM DISCOVERY (read-only) for the dedicated details pages.
 *
 * Purpose:
 *   Verify the REAL DOM of  /in/<publicId>/details/experience/
 *   before we write any parser. No extraction logic here — just
 *   capture ground truth so selectors are verified, not assumed.
 *
 * Usage:
 *   node scripts/discover-details.js "https://www.linkedin.com/in/<publicId>/"
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// ---- derive publicId from any profile URL ----
function getPublicId(profileUrl) {
    const match = profileUrl.match(/\/in\/([^/?#]+)/);
    if (!match) throw new Error("Could not parse publicId from: " + profileUrl);
    return match[1];
}

// ---- gentle, incremental scroll so lazy content mounts ----
async function incrementalScroll(page) {
    await page.evaluate(async () => {
        await new Promise(resolve => {
            let y = 0;
            const step = 400;
            const timer = setInterval(() => {
                window.scrollBy(0, step);
                y += step;
                if (y >= document.body.scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 250);
        });
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
}

(async () => {
    const profileUrl = process.argv[2];
    if (!profileUrl) {
        console.error('Pass a profile URL: node scripts/discover-details.js "<url>"');
        process.exit(1);
    }

    const publicId = getPublicId(profileUrl);
    const detailsUrl =
        `https://www.linkedin.com/in/${publicId}/details/experience/`;

    const outDir = path.resolve(__dirname, "..", "output");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        storageState: "./session/linkedin.json"
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    console.log("Opening details page:");
    console.log(detailsUrl);

    await page.goto(detailsUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    // If session is dead / redirected, tell us plainly.
    await page.waitForTimeout(3000);
    const landedUrl = page.url();
    console.log("Landed on:", landedUrl);

    if (/\/(login|authwall|checkpoint)/.test(landedUrl)) {
        console.log("\n⚠️  Redirected to login/authwall — session may be expired.");
        console.log("Re-run your login step to refresh session/linkedin.json.\n");
        await page.screenshot({ path: path.join(outDir, "details-redirect.png") });
        await browser.close();
        return;
    }

    await incrementalScroll(page);

    // The details page renders its list inside <main>. Capture it.
    const mainHtml = await page.locator("main").first().innerHTML();
    fs.writeFileSync(path.join(outDir, "details-experience.html"), mainHtml);
    console.log("Saved: output/details-experience.html");

    // Structured preview: every top-level <li> in the main list.
    const liPreview = await page.locator("main li").evaluateAll(nodes =>
        nodes.slice(0, 12).map((node, index) => {
            const companyLink = node.querySelector('a[href*="/company/"]');
            // visible spans only (aria-hidden="true" is the on-screen copy;
            // LinkedIn duplicates each string in a .visually-hidden sibling)
            const visibleText = Array.from(
                node.querySelectorAll('span[aria-hidden="true"]')
            )
                .map(s => (s.textContent || "").trim())
                .filter(Boolean);
            return {
                index,
                companyHref: companyLink ? companyLink.href : null,
                visibleText: visibleText.slice(0, 8)
            };
        })
    );

    console.log("\n=== FIRST <li> ENTRIES (visible spans) ===");
    console.log(JSON.stringify(liPreview, null, 2));

    await page.screenshot({
        path: path.join(outDir, "details-experience.png"),
        fullPage: true
    });
    console.log("Saved: output/details-experience.png");

    console.log("\nDiscovery complete. Review the two output files above.");
    await browser.close();
})();
