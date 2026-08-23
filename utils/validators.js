/**
 * Field-level validation applied after extraction — a defense-in-depth
 * layer on top of the DOM anchoring itself. If a value slips through
 * that clearly looks like the WRONG kind of field (e.g. a location
 * that's actually a follower/connection count string), it's rejected
 * (-> "") and logged rather than shipped as incorrect data.
 */

const log = require("./logger");

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

// "He/Him", "She/Her", "They/Them" — closed pronoun vocabulary, same
// pattern used at extraction time. Never a headline.
const PRONOUN_WORDS = "he|him|his|she|her|hers|they|them|their|theirs|ze|zir|zirs|xe|xem|xyr";
const PRONOUN_BADGE = new RegExp(
    `^(${PRONOUN_WORDS})\\s*/\\s*(${PRONOUN_WORDS})(\\s*/\\s*(${PRONOUN_WORDS}))?$`, "i"
);

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
    if (companyName && normalize(trimmed) === normalize(companyName)) {
        log.warning(`[${context}] Rejected headline "${headline}" — identical to the company name`);
        return "";
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
