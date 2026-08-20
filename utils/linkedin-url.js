/**
 * LinkedIn URL helpers.
 *
 * All profile section data is scraped from LinkedIn's dedicated,
 * deterministic "details" routes instead of the lazy-mounted profile
 * page. These helpers build those URLs and normalise company URLs.
 */

// Must be a linkedin.com/in/<publicId> profile URL (any subdomain, http/https,
// with or without trailing slash/query/hash). Rejects company pages, posts,
// search results, non-LinkedIn URLs, and garbage input up front — before any
// navigation — so a bad row fails with a clear reason instead of silently
// producing incomplete data.
const PROFILE_URL_PATTERN = /^https?:\/\/([\w-]+\.)?linkedin\.com\/in\/[^/?#]+/i;

function isValidLinkedInProfileUrl(url) {
    return PROFILE_URL_PATTERN.test(String(url || "").trim());
}

// LinkedIn vanity slugs are conventionally all-lowercase (e.g.
// "jonathangkennedy", "alejandro-leal-a5893110"). The opaque encoded
// member-ID form seen in some shared/exported links (e.g.
// "ACwAAABn5wgBxEOlL8lrbIEkh1kiyjwMVoLu5ys") always contains uppercase
// letters — verified against live examples, where LinkedIn redirects
// that form to its canonical lowercase vanity URL client-side, ~1s after
// the page content itself finishes rendering. Used to know when to wait
// for that redirect rather than trusting page.url() immediately.
function looksLikeEncodedProfileId(url) {
    const match = String(url || "").match(/\/in\/([^/?#]+)/);
    return !!match && /[A-Z]/.test(match[1]);
}

// "https://www.linkedin.com/in/alejandro-leal-a5893110/" -> "alejandro-leal-a5893110"
function getPublicId(profileUrl) {

    const match = String(profileUrl).match(/\/in\/([^/?#]+)/);

    if (!match) {
        throw new Error("Could not parse publicId from URL: " + profileUrl);
    }

    return match[1];
}

// Build the deterministic experience details route for a profile.
function buildExperienceUrl(profileUrl) {

    const publicId = getPublicId(profileUrl);

    return `https://www.linkedin.com/in/${publicId}/details/experience/`;
}

/**
 * Normalise any company URL to its canonical /about/ page.
 *
 *   https://www.linkedin.com/company/162594/?trk=...   ->
 *   https://www.linkedin.com/company/162594/about/
 */
function toCompanyAboutUrl(companyUrl) {

    if (!companyUrl) return "";

    // strip query / hash
    let clean = String(companyUrl).split("?")[0].split("#")[0];

    // isolate /company/<slug-or-id>/
    const match = clean.match(/\/company\/([^/]+)/);

    if (!match) return "";

    return `https://www.linkedin.com/company/${match[1]}/about/`;
}

module.exports = {
    isValidLinkedInProfileUrl,
    looksLikeEncodedProfileId,
    getPublicId,
    buildExperienceUrl,
    toCompanyAboutUrl
};
