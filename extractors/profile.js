const SELECTORS = require("../config/selectors");
const { validateHeadline, validateLocation, validateConnections } = require("../utils/validators");
const { getPublicId } = require("../utils/linkedin-url");
const log = require("../utils/logger");

/**
 * Top-card field extraction (headline, company/education line, location,
 * connections) is anchored to DOM STRUCTURE/POSITION rather than hashed
 * CSS class names (LinkedIn's build hashes change between deploys — see
 * the project's own history of that breaking earlier heuristics) or loose
 * substring matching over every <p> on the page (which previously let a
 * follower/connection count from an unrelated section get picked up as
 * "location").
 *
 * Verified against the live DOM on two different profiles (Aug 2026):
 *
 *   <h2>Full Name</h2>
 *   <svg ...verification badge... />        (optional, ignored)
 *   <p>He/Him</p>                            <- OPTIONAL pronouns badge.
 *                                                Verified live: can appear
 *                                                BEFORE the degree badge.
 *                                                Must be skipped, not read
 *                                                as headline.
 *   <p>· 3rd</p>                             <- OPTIONAL connection-degree
 *                                                badge ("· 1st"/"· 2nd"/"· 3rd").
 *                                                Verified: absent for 1st-degree
 *                                                connections, present for 2nd/3rd,
 *                                                and can appear MORE THAN ONCE
 *                                                (e.g. "· 1st" then "· 2nd" back
 *                                                to back on the same profile).
 *                                                Must be skipped, not read as headline.
 *   <p>Headline text</p>                     <- headline: first <p> after the
 *                                                name h2 that isn't a badge
 *   <p>Company · Education</p>               <- next non-badge <p> after that
 *   <div>
 *     <p>City, Region, Country</p>           <- location: first <p> inside
 *     <p>·</p>                                  the div that also holds the
 *     <p><a href=".../overlay/contact-info/">Contact info</a></p>   contact-info link
 *   </div>
 *   ...
 *   EITHER (verified, two different profiles use different markup):
 *   <div>
 *     <p>316</p>
 *     <p>connections</p>                     <- connections: isolated div,
 *   </div>                                      exact text "connections",
 *                                                preceding <p> is the count
 *   OR:
 *   <p>500+ connections</p>                  <- connections: combined into
 *                                                ONE <p>, count + label together
 *
 * A profile's own follower count (as opposed to connections) lives inside
 * a completely different "Activity" card further down the page, under its
 * own <h2>Activity</h2> — structurally nowhere near this block, which is
 * why anchoring beats "any line that contains a number" style heuristics.
 */

function extractTopCardInPage(fullName) {

    const clean = s => (s || "").replace(/\s+/g, " ").trim();

    // Defined inside this function (not at module scope) because
    // page.evaluate() re-executes only this function's own source inside
    // the browser — it has no access to outer Node-scope variables.

    // "3rd", "· 3rd", "2nd+", "1st" — a connection-degree badge, never a headline.
    const DEGREE_BADGE_PATTERN = /^(·\s*)?\d+(st|nd|rd|th)\+?$/i;

    // "He/Him", "She/Her", "They/Them", "He/Him/His" — a pronouns badge,
    // never a headline. Matched against a closed vocabulary of actual
    // pronoun words (not a generic "word/word" shape) so it can never
    // reject a real headline that legitimately uses "/" as a separator,
    // e.g. "Founder/CEO" or "Product/Growth Lead".
    const PRONOUN_WORDS = "he|him|his|she|her|hers|they|them|their|theirs|ze|zir|zirs|xe|xem|xyr";
    const PRONOUN_BADGE_PATTERN = new RegExp(
        `^(${PRONOUN_WORDS})\\s*/\\s*(${PRONOUN_WORDS})(\\s*/\\s*(${PRONOUN_WORDS}))?$`, "i"
    );

    const isBadge = text => DEGREE_BADGE_PATTERN.test(text) || PRONOUN_BADGE_PATTERN.test(text);

    const result = { headline: "", companyLine: "", pronouns: "", location: "", connections: "" };

    // ---- headline + company/education line: first two non-badge <p> after the name h2 ----
    const nodes = Array.from(document.querySelectorAll("main h2, main p"));
    const nameIdx = nodes.findIndex(
        el => el.tagName === "H2" && clean(el.textContent) === fullName
    );

    if (nameIdx !== -1) {
        const followingRaw = nodes
            .slice(nameIdx + 1)
            .filter(el => el.tagName === "P")
            .map(el => clean(el.textContent));

        const pronounMatch = followingRaw.find(text => PRONOUN_BADGE_PATTERN.test(text));
        result.pronouns = pronounMatch || "";

        const following = followingRaw.filter(text => !isBadge(text));

        result.headline = following[0] || "";
        result.companyLine = following[1] || "";
    }

    // ---- location: anchored to the "Contact info" overlay link ----
    const contactLink = document.querySelector('a[href*="overlay/contact-info"]');
    if (contactLink) {
        const container = contactLink.closest("div");
        const firstP = container ? container.querySelector("p") : null;
        result.location = clean(firstP?.textContent);
    }

    // ---- connections ----
    // Pattern A: isolated <div> with an exact "connections" <p>, count is
    // the preceding sibling <p>.
    const connectionsLabel = Array.from(document.querySelectorAll("p")).find(
        p => /^connections?$/i.test(clean(p.textContent))
    );
    if (connectionsLabel) {
        const prev = connectionsLabel.previousElementSibling;
        if (prev && prev.tagName === "P") {
            result.connections = clean(prev.textContent);
        }
    }

    // Pattern B: a single <p> combining count + label, e.g. "500+ connections".
    if (!result.connections) {
        const combined = Array.from(document.querySelectorAll("p")).find(
            p => /^[\d,]+\+?\s+connections?$/i.test(clean(p.textContent))
        );
        if (combined) {
            const match = clean(combined.textContent).match(/^([\d,]+\+?)\s+connections?$/i);
            if (match) result.connections = match[1];
        }
    }

    return result;
}

async function getProfile(page) {

    const fullName = (
        await page
            .locator(SELECTORS.PROFILE.NAME)
            .filter({ hasText: /\S/ })
            .nth(1)
            .textContent()
    ).trim();

    const parts = fullName.split(" ");

    const firstName = parts.shift() || "";
    const lastName = parts.join(" ");

    const topCard = await page.evaluate(extractTopCardInPage, fullName);

    const location = validateLocation(topCard.location, fullName);
    const connections = validateConnections(topCard.connections, fullName);

    // "Aeromexico · Universidad Estatal del Valle de Ecatepec" -> company, education
    const [companyName = "", education = ""] = topCard.companyLine
        .split("·")
        .map(s => s.trim());

    // Cross-checked against company/location so a misextraction (headline
    // field ending up with the company name or place) is caught, not just
    // pronoun/degree-badge shapes.
    const headline = validateHeadline(topCard.headline, fullName, companyName, location);

    if (!topCard.location) {
        log.info(`[${fullName}] No location found on profile (not filled in, or Contact info link absent)`);
    }
    if (!topCard.connections) {
        log.info(`[${fullName}] No connections count found on profile (may show only a follower count instead)`);
    }

    // About section text. data-testid="expandable-text-box" is the stable
    // hook LinkedIn uses for the About card's body (verified against the
    // live DOM), independent of the more fragile paragraph heuristics
    // used above for headline/company/location.
    const about = await page
        .locator('[data-testid="expandable-text-box"]')
        .first()
        .textContent()
        .then(t => (t || "").replace(/\s+/g, " ").trim())
        .catch(() => "");

    // "Open to work" — verified live DOM shows this as a carousel card
    // near the top of the profile's OWN page:
    //   <a href="/in/<own-public-id>/">
    //     <p><span><strong>Open to work</strong></span></p>
    //     <p><span>Pune | On-site · Hybrid</span></p>   (preferences)
    //   </a>
    //
    // This is a DIFFERENT pattern than aria-label="<Name> is open to
    // work" — that one only appears on OTHER people's small badge icons
    // shown in "More profiles for you" suggestion carousels (confirmed:
    // it never appears for the profile's own status, only for someone
    // else's, on someone else's page). Scoping to an <a> that links back
    // to THIS profile's own URL avoids misattributing a suggested
    // profile's open-to-work status to the one actually being scraped.
    const publicId = (() => {
        try {
            return getPublicId(page.url());
        } catch {
            return null;
        }
    })();

    const openToWork = publicId
        ? await page.evaluate(ownPublicId => {
            const links = Array.from(
                document.querySelectorAll(`a[href*="/in/${ownPublicId}"]`)
            );
            return links.some(a =>
                Array.from(a.querySelectorAll("strong")).some(
                    el => (el.textContent || "").trim().toLowerCase() === "open to work"
                )
            );
        }, publicId).catch(() => false)
        : false;

    return {

        fullName,

        firstName,

        lastName,

        headline,

        pronouns: topCard.pronouns || "",

        about,

        companyName,

        education,

        location,

        connections,

        openToWork

    };

}

module.exports = {

    getProfile

};
