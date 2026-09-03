const path = require("path");

/**
 * Root of the LinkedIn-Discovery app (this package), not the parent
 * enrichment scraper. Session/output for Discovery live here when we
 * intentionally write local files; scrape engine still uses parent paths
 * via relative requires.
 */
function getAppRoot() {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return path.resolve(__dirname, "..");
}

module.exports = { getAppRoot };
