const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const { getAppRoot } = require("../utils/app-root");

async function createBrowser() {

    const browser = await chromium.launch({

        headless: false,

        args: [
            "--start-maximized"
        ]

    });

    const sessionPath = path.join(getAppRoot(), "session", "linkedin.json");

    const context = await browser.newContext({

        // No saved session yet (first run) — proceed logged out rather
        // than crash; scrapeProfile()'s own login/authwall check catches
        // this with a clear error.
        storageState: fs.existsSync(sessionPath) ? sessionPath : undefined,

        viewport: null

    });

    // Block resource types we never read (images, fonts, video/audio).
    // Pure speed optimization — request volume/timing to linkedin.com
    // itself is unchanged, only CDN-hosted media downloads are skipped.
    // Scripts/XHR/stylesheets are left alone since the profile pages are
    // a heavy SPA that needs those to render the DOM we actually parse.
    const BLOCKED_RESOURCE_TYPES = new Set(["image", "font", "media"]);

    await context.route("**/*", route => {
        const type = route.request().resourceType();
        if (BLOCKED_RESOURCE_TYPES.has(type)) {
            return route.abort();
        }
        return route.continue();
    });

    const page = await context.newPage();

    page.setDefaultTimeout(30000);

    return {

        browser,

        context,

        page

    };

}

async function closeBrowser(browser) {

    if (browser) {

        await browser.close();

    }

}

module.exports = {

    createBrowser,

    closeBrowser

};