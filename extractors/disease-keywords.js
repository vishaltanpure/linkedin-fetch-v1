/**
 * Scans profile text (headline + About + recent activity) for keywords
 * that typically signal a profile has been repurposed as an "in memoriam"
 * page, or otherwise signals the contact should be reviewed before
 * further outreach (retirement, condolences, etc).
 *
 * Keyword list is the client-provided "Disease Keywords" set (including
 * the given misspelling "Condolense"). "Condolence" is also kept so the
 * correctly-spelled form still matches.
 *
 * Matching is whole-word/phrase and case-insensitive, so e.g. "Rip"
 * doesn't match inside "trip" or "gripping". It CAN still match a
 * legitimate unrelated use of a short common word (e.g. someone whose
 * post literally says "let it rip", or a name like "Rip Torn") — the
 * keyword list was given as-is, this isn't a claim of zero false
 * positives.
 */

const KEYWORDS = [
    "Death",
    "Deceased",
    "Departed",
    "Died",
    "Expired",
    "Passed Away",
    "Remembrance",
    "Rest In Peace",
    "Retired",
    "Rip",
    "Condolense", // as provided by client
    "Condolence"  // correct spelling — still match real usage
];

// Trailing s? allows common plurals ("condolences") without loosening
// the leading boundary, so "trip"/"gripping" still can't match "rip".
const PATTERNS = KEYWORDS.map(keyword => ({
    keyword,
    regex: new RegExp(`\\b${keyword.replace(/\s+/g, "\\s+")}s?\\b`, "i")
}));

// Returns the list of matched keywords (deduped, original list casing).
function scanForKeywords(...texts) {

    const combined = texts.filter(Boolean).join(" \n ");
    if (!combined) return [];

    const matched = [];

    for (const { keyword, regex } of PATTERNS) {
        if (regex.test(combined)) matched.push(keyword);
    }

    // "Condolence" and "Condolense" both hitting is just spelling
    // duplication of the same signal — collapse to the client-provided form.
    if (matched.includes("Condolence") && matched.includes("Condolense")) {
        matched.splice(matched.indexOf("Condolence"), 1);
    } else if (matched.includes("Condolence") && !matched.includes("Condolense")) {
        // Prefer reporting the client spelling when only the correct one hit.
        matched[matched.indexOf("Condolence")] = "Condolense";
    }

    return matched;
}

module.exports = {
    KEYWORDS,
    scanForKeywords
};
