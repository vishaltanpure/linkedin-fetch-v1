/**
 * LinkedIn URL normalization for duplicate detection.
 *
 * Treats these as the same profile:
 *   https://www.linkedin.com/in/john-doe
 *   https://www.linkedin.com/in/john-doe/
 *   https://linkedin.com/in/john-doe
 *   http://www.linkedin.com/in/john-doe?trk=...
 *   https://www.linkedin.com/in/John-Doe/
 */

/**
 * Sales Navigator lead path → member id (ACw… or vanity).
 *   /sales/lead/ACwAAAfX…,NAME_SEARCH,…  →  ACwAAAfX…
 */
function salesLeadId(url) {
    const m = String(url || "").match(/\/sales\/(?:lead|people)\/([^/?#]+)/i);
    if (!m) return "";
    return m[1].split(",")[0].trim();
}

/** Convert a SN lead URL to a /in/ URL scrapeProfile() accepts. */
function salesLeadToProfileUrl(url) {
    const id = salesLeadId(url);
    if (!id) return "";
    return `https://www.linkedin.com/in/${id}`;
}

function normalizeProfileUrl(url) {
    if (!url) return "";

    let decoded;
    try {
        decoded = decodeURIComponent(String(url).trim());
    } catch {
        decoded = String(url).trim();
    }

    // Drop scheme, leading www., query, hash, trailing slash
    let clean = decoded
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .split("?")[0]
        .split("#")[0]
        .replace(/\/+$/, "")
        .toLowerCase();

    const match = clean.match(/^(?:[a-z0-9-]+\.)?linkedin\.com\/in\/([^/]+)/i);
    if (match) {
        return `linkedin.com/in/${match[1]}`;
    }

    // SN lead URLs share the same member id as /in/ACw…
    const leadId = salesLeadId(decoded);
    if (leadId) {
        return `linkedin.com/in/${leadId.toLowerCase()}`;
    }

    return "";
}

function extractProfileUrlFromHref(href) {
    if (!href) return "";
    const match = String(href).match(
        /https?:\/\/(?:[\w-]+\.)?linkedin\.com\/in\/[^/?#]+/i
    );
    if (!match) return "";
    // Canonical absolute form used for scraping (keep original casing in path for navigation)
    const abs = match[0].split("?")[0].split("#")[0].replace(/\/+$/, "");
    return abs;
}

function isProfileUrl(url) {
    return !!normalizeProfileUrl(url);
}

module.exports = {
    normalizeProfileUrl,
    extractProfileUrlFromHref,
    isProfileUrl,
    salesLeadId,
    salesLeadToProfileUrl
};
