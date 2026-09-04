/**
 * LinkedIn pronoun badge vocabulary (EN + common DE/FR/ES/NL/PT/IT + neo).
 * Used to skip "sie/ihr", "she/her", etc. when they appear as a top-card
 * line that must never become HEADLINE.
 */

const PRONOUN_WORDS = [
    // English + neo
    "he", "him", "his", "she", "her", "hers",
    "they", "them", "their", "theirs",
    "ze", "zir", "zirs", "xe", "xem", "xyr",
    "xier", "xies",
    // German (e.g. sie/ihr, er/ihm)
    "er", "ihn", "ihm", "sie", "ihr", "es",
    // French
    "il", "lui", "elle", "iel", "ellui",
    // Spanish
    "él", "ella",
    // Dutch
    "hij", "hem", "zij", "haar", "hen", "hun",
    // Portuguese
    "ele", "dela", "dele",
    // Italian
    "lei"
].join("|");

const PRONOUN_BADGE = new RegExp(
    `^(${PRONOUN_WORDS})\\s*/\\s*(${PRONOUN_WORDS})(\\s*/\\s*(${PRONOUN_WORDS}))?$`,
    "i"
);

function isPronounBadge(text) {
    return PRONOUN_BADGE.test(String(text || "").trim());
}

module.exports = {
    PRONOUN_WORDS,
    PRONOUN_BADGE,
    isPronounBadge
};
