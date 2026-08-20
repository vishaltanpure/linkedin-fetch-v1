const path = require("path");

/**
 * Resolves the application's own root directory, regardless of the
 * current working directory the app happens to be launched from.
 *
 * In dev mode (node index.js / node app.js) this is the project root.
 * When packaged with pkg into a standalone .exe, __dirname points inside
 * the virtual snapshot filesystem (not a real path on disk) — pkg sets
 * process.pkg in that case, and process.execPath is the real path to the
 * .exe itself, so the exe's own folder is used instead. This matters
 * because things like session/linkedin.json and output/ must live next
 * to the .exe on disk, not inside the read-only snapshot.
 */
function getAppRoot() {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return path.resolve(__dirname, "..");
}

module.exports = { getAppRoot };
