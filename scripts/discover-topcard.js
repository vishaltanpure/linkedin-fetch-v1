/**
 * DOM DISCOVERY (read-only) for the profile top-card region:
 * headline, location, connections/followers.
 * No extraction logic — just capture ground truth before fixing the parser.
 *
 * Usage:
 *   node scripts/discover-topcard.js "<profile-url>"
 */

const { createBrowser, closeBrowser } = require("../browser/browser");
const fs = require("fs");

(async () => {
    const profileUrl = process.argv[2] || "https://www.linkedin.com/in/diego-armando-pedraza-0bb49a117/";

    const { browser, page } = await createBrowser();

    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);

    // Save the top-card region HTML (first section-like block in main)
    const topCardHtml = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return "";
        // First child block is typically the top card
        const first = main.querySelector(":scope > div, :scope > section");
        return first ? first.outerHTML : main.innerHTML.slice(0, 5000);
    });
    fs.writeFileSync("./output/topcard.html", topCardHtml);
    console.log("Saved: output/topcard.html (" + topCardHtml.length + " chars)");

    // All elements with data-generated-suggestion-target, data-anonymize, or aria-label near top
    const hints = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll("[data-anonymize], [data-generated-suggestion-target]").forEach(el => {
            const attr = el.getAttribute("data-anonymize") || el.getAttribute("data-generated-suggestion-target");
            const text = (el.textContent || "").trim().slice(0, 120);
            if (text) results.push({ attr, text });
        });
        return results.slice(0, 30);
    });
    console.log("\n=== data-anonymize / data-generated-suggestion-target hints ===");
    console.log(JSON.stringify(hints, null, 2));

    // Text of every element with a class containing "text-body-small" (common LinkedIn utility class for location/connections in top card)
    const bodySmallTexts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[class*="text-body-small"]'))
            .map(el => (el.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 20);
    });
    console.log("\n=== text-body-small elements ===");
    console.log(JSON.stringify(bodySmallTexts, null, 2));

    // headline candidates: text-body-medium
    const bodyMediumTexts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[class*="text-body-medium"]'))
            .map(el => (el.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 10);
    });
    console.log("\n=== text-body-medium elements (headline candidates) ===");
    console.log(JSON.stringify(bodyMediumTexts, null, 2));

    await closeBrowser(browser);
})();
