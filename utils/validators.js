/**
 * Field-level validation applied after extraction — a defense-in-depth
 * layer on top of the DOM anchoring itself. If a value slips through
 * that clearly looks like the WRONG kind of field (e.g. a location
 * that's actually a follower/connection count string), it's rejected
 * (-> "") and logged rather than shipped as incorrect data.
 */

const log = require("./logger");
const { PRONOUN_BADGE } = require("./pronouns");

// "870,998 followers" / "316 connections" / "500+ connections"
const COUNT_LIKE = /^[\d,]+\+?\s*(followers?|connections?)$/i;

// The only shapes a followers/connections value should ever take: "316", "1,234", "500+"
const COUNT_SHAPE = /^[\d,]+\+?$/;
const CONNECTIONS_SHAPE = COUNT_SHAPE; // alias kept for older call sites

// "3rd", "· 3rd", "2nd+", "1st" — a connection-degree badge, never a headline.
// Root cause is already fixed at extraction (extractors/profile.js skips this
// <p> when picking the headline candidate) — this is a defense-in-depth
// backstop in case that anchoring ever slips on a future layout change.
const DEGREE_BADGE = /^(·\s*)?\d+(st|nd|rd|th)\+?$/i;

const normalize = s => (s || "").trim().toLowerCase();

// `companyName`/`location` are optional cross-checks: a headline that's
// merely a restatement of the company or location field is a sign the
// wrong text got extracted, not a real headline.
function validateHeadline(headline, context, companyName, location) {
    if (!headline) {
        log.warning(`[${context}] Headline not captured`);
        return "";
    }
    const trimmed = headline.trim();
    if (DEGREE_BADGE.test(trimmed)) {
        log.warning(`[${context}] Rejected headline "${headline}" — looks like a connection-degree badge, not a headline`);
        return "";
    }
    if (PRONOUN_BADGE.test(trimmed)) {
        log.warning(`[${context}] Rejected headline "${headline}" — looks like a pronouns badge, not a headline`);
        return "";
    }
    // Nested-span / UI fragment garbage (observed: "This is a mo")
    if (/^this is a\b/i.test(trimmed) || trimmed.length < 4) {
        log.warning(`[${context}] Rejected headline "${headline}" — looks like UI placeholder / fragment`);
        return "";
    }
    if (/^(beginning of dialog|end of dialog|this is a modal)/i.test(trimmed)) {
        log.warning(`[${context}] Rejected headline "${headline}" — looks like dialog chrome`);
        return "";
    }
    if (/^(followers?|connections?)$/i.test(trimmed) || COUNT_LIKE.test(trimmed)) {
        log.warning(`[${context}] Rejected headline "${headline}" — looks like a follower/connection label`);
        return "";
    }
    // Top-card "Company · School" org pair is never a person headline
    if (trimmed.includes("·")) {
        const left = trimmed.split("·")[0].trim();
        const looksLikeJob =
            /\b(director|manager|officer|engineer|analyst|specialist|consultant|president|executive|lead|head|chief|coordinator|scientist|economist|architect|founder|sales|operations|clinical)\b/i.test(
                left
            );
        if (!looksLikeJob) {
            log.warning(`[${context}] Rejected headline "${headline}" — looks like company · education line`);
            return "";
        }
    }
    // About section prose (LinkedIn headline max is 220 chars)
    if (
        trimmed.length > 220 ||
        /\b(see more|…\s*more|\.{3}\s*more)\s*$/i.test(trimmed) ||
        (trimmed.length > 140 && (trimmed.match(/[.!?]/g) || []).length >= 2)
    ) {
        const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
        log.warning(`[${context}] Rejected headline "${preview}" — looks like About section prose`);
        return "";
    }
    if (companyName && normalize(trimmed) === normalize(companyName)) {
        // Only reject when companyName looks like an org, not a job title
        // that was mis-parsed from "Title at Company" headlines.
        const looksLikeJobTitle = /\b(director|manager|officer|engineer|analyst|specialist|consultant|president|executive|lead|head|chief|coordinator|scientist|economist|architect|founder)\b/i.test(companyName);
        if (!looksLikeJobTitle) {
            log.warning(`[${context}] Rejected headline "${headline}" — identical to the company name`);
            return "";
        }
    }
    if (location && normalize(trimmed) === normalize(location)) {
        log.warning(`[${context}] Rejected headline "${headline}" — identical to the location`);
        return "";
    }
    return headline;
}

function validateLocation(location, context) {
    if (!location) return "";
    if (COUNT_LIKE.test(location.trim())) {
        log.warning(`[${context}] Rejected location "${location}" — looks like a follower/connection count, not a place`);
        return "";
    }
    return location;
}

function validateConnections(connections, context) {
    if (!connections) return "";
    const trimmed = connections.trim();
    if (!COUNT_SHAPE.test(trimmed)) {
        log.warning(`[${context}] Rejected connections value "${connections}" — doesn't match expected number/"N+" shape`);
        return "";
    }
    return trimmed;
}

function validateFollowers(followers, context) {
    if (!followers) return "";
    const trimmed = followers.trim();
    if (!COUNT_SHAPE.test(trimmed)) {
        log.warning(`[${context}] Rejected followers value "${followers}" — doesn't match expected number/"N+" shape`);
        return "";
    }
    return trimmed;
}

module.exports = {
    validateHeadline,
    validateLocation,
    validateConnections,
    validateFollowers,
    COUNT_LIKE,
    COUNT_SHAPE,
    CONNECTIONS_SHAPE,
    DEGREE_BADGE,
    PRONOUN_BADGE
};
