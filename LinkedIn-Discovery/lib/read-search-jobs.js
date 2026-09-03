/**
 * Read search-job definitions from CSV / XLSX / XLS.
 * One row = one discovery run (filters + count + optional existing sheet).
 */

const path = require("path");
const { readAnySheet } = require("./read-sheet");
const { parseSearchJob, validateSearchJob } = require("./search-filters");

async function loadSearchJobs(filePath) {
    const abs = path.resolve(filePath);
    const sheets = await readAnySheet(abs);

    const jobs = [];

    for (const sheet of sheets) {
        for (let i = 0; i < sheet.rows.length; i++) {
            const row = sheet.rows[i];
            const job = parseSearchJob(row, sheet.headers);
            job._source = {
                file: abs,
                sheet: sheet.name,
                row: i + 2 // 1-based, + header
            };

            // Skip completely empty template rows
            const hasData =
                job.salesNavigatorUrl ||
                job.keywords ||
                job.composedKeywords ||
                job.count;
            if (!hasData) continue;

            try {
                validateSearchJob(job);
            } catch (err) {
                throw new Error(
                    `${path.basename(abs)} [${sheet.name} row ${job._source.row}]: ${err.message}`
                );
            }

            jobs.push(job);
        }
    }

    if (jobs.length === 0) {
        throw new Error(`No search jobs found in ${abs}`);
    }

    return jobs;
}

module.exports = {
    loadSearchJobs
};
