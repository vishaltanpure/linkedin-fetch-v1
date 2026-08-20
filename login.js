/**
 * Interactive LinkedIn login. Opens a real browser window, waits for
 * the user to log in manually, then saves the session to session/linkedin.json
 * (resolved relative to the app's own location — see utils/app-root.js —
 * so this works correctly whether run as `node login.js` in dev or as
 * a packaged .exe launched from anywhere).
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { getAppRoot } = require("./utils/app-root");
const log = require("./utils/logger");

async function runLogin() {

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("https://www.linkedin.com/login");

    log.info("Please log in manually in the browser window...");

    await page.waitForURL("https://www.linkedin.com/feed/**", {
        timeout: 0
    });

    const sessionDir = path.join(getAppRoot(), "session");
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    await context.storageState({
        path: path.join(sessionDir, "linkedin.json")
    });

    log.success("Session saved successfully!");

    await browser.close();
}

if (require.main === module) {
    runLogin().catch(err => {
        log.error(err.message);
        process.exitCode = 1;
    });
}

module.exports = { runLogin };
