/**
 * DOM DISCOVERY (read-only) for the recent-activity page.
 * No extraction logic — just capture ground truth before writing a parser.
 *
 * Usage:
 *   node scripts/discover-activity.js "<profile-url>"
 */

const { createBrowser, closeBrowser } = require("../browser/browser");
const { getPublicId } = require("../utils/linkedin-url");
const fs = require("fs");

(async () => {
    const profileUrl = process.argv[2];
    const publicId = getPublicId(profileUrl);
    const url = `https://www.linkedin.com/in/${publicId}/recent-activity/all/`;

    const { browser, page } = await createBrowser();

    console.log("Opening:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    console.log("Landed on:", page.url());

    const html = await page.locator("main").first().innerHTML();
    fs.writeFileSync("./output/activity-page.html", html);
    console.log("Saved: output/activity-page.html");

    // First few <li> under main, with their visible text preview.
    const items = await page.locator("main li").evaluateAll(nodes =>
        nodes.slice(0, 3).map((node, i) => ({
            index: i,
            textPreview: (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400)
        }))
    );
    console.log("\n=== FIRST 3 <li> ITEMS ===");
    console.log(JSON.stringify(items, null, 2));

    await page.screenshot({ path: "./output/activity-page.png", fullPage: false });
    console.log("Saved: output/activity-page.png");

    await closeBrowser(browser);
})();
