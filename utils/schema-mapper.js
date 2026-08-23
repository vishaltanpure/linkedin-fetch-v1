/**
 * Maps our scraper's internal record shape (from index.js scrapeProfile)
 * to the exact column names the "Data Refresh Output Format.xlsx"
 * template expects, plus "Activity" and "Original LinkedIn URL" columns
 * added per client feedback.
 */

// Name pulled out as a constant so app.js can specifically guarantee this
// column is never blanked out on a failed/skipped row — it falls back to
// the raw input URL there, since no resolution ever happened.
const ORIGINAL_URL_COLUMN = "Original LinkedIn URL";

const OUTPUT_COLUMNS = [
    // First entry -> lands immediately after the input URL column
    // (originalQuery/query) in app.js's column ordering, i.e. 2nd overall.
    ORIGINAL_URL_COLUMN,
    "firstName",
    "lastName",
    "headline",
    "currentPosition",
    "currentcompanyName",
    "currentPositionduration",
    "currentpositionstartdate",
    "currentPositionstatus",
    "contractType",
    "openToWork",
    "post/engagement/reactions/type",
    "Activity",
    "followers count",
    "currentPosition/companyLinkedinUrl",
    "location/country",
    "associateMember",
    "employeeRange",
    "currentPositioncompany/industries",
    "currentPosition/companyUrl",
    "companyType",
    "Onsite Address",
    "Company Location",
    "Disease Keyword"
];

// "Monterrey, Nuevo León, Mexico" -> "Mexico"
function deriveCountry(location) {
    if (!location) return "";
    const parts = location.split(",").map(p => p.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
}

// record: the object returned by scrapeProfile() in index.js
function mapToRow(record) {
    return {
        // The final URL as the browser resolved it after any redirects
        // (e.g. an encoded /in/ACwAAA... input resolves to its canonical
        // /in/<vanity-slug>/ URL) — NOT the raw input string. Falls back
        // to the raw input only if resolution genuinely never happened.
        [ORIGINAL_URL_COLUMN]: record.resolvedProfileUrl || record.profileUrl || "",
        firstName: record.firstName || "",
        lastName: record.lastName || "",
        headline: record.headline || "",
        currentPosition: record.currentPosition || "",
        currentcompanyName: record.currentCompany || "",
        currentPositionduration: record.duration || "",
        currentpositionstartdate: record.startDate || "",
        currentPositionstatus: record.endDate || "",
        contractType: record.employmentType || "",
        openToWork: record.openToWork ? "true" : "false",
        "post/engagement/reactions/type": record.postReactionType || "",
        // post/postedAt/postedAgoText was removed as a standalone column
        // — it's a subset of Activity (headerText + postedAgoText
        // combined), which already carries the same information.
        Activity: record.activitySummary || "",
        "followers count": record.followers || record.connections || "",
        "currentPosition/companyLinkedinUrl": record.companyLinkedinUrl || "",
        "location/country": deriveCountry(record.location),
        associateMember: record.associatedMembers ? Number(record.associatedMembers) : "",
        // Full LinkedIn-displayed range (e.g. "1,001-5,000 employees"), NOT
        // parsed down to just the leading number — that discarded the
        // upper bound entirely, which is exactly the bug this fixes.
        employeeRange: record.employeeCount || "",
        "currentPositioncompany/industries": record.industry || "",
        "currentPosition/companyUrl": record.website || "",
        companyType: record.companyType || "",
        // Current job's own location (falls back to profile location only
        // when the role itself doesn't list one — see index.js), NOT the
        // person's general profile location outright, and never a
        // previous position's location.
        "Onsite Address": record.jobLocation || "",
        "Company Location": record.headquarters || "",
        "Disease Keyword": record.diseaseKeywords || ""
    };
}

module.exports = {
    OUTPUT_COLUMNS,
    ORIGINAL_URL_COLUMN,
    mapToRow,
    deriveCountry
};
