const SELECTORS = require("../config/selectors");
const { validateHeadline, validateLocation, validateFollowers } = require("../utils/validators");
const { getPublicId } = require("../utils/linkedin-url");
const log = require("../utils/logger");

/**
 * Top-card field extraction (headline, company/education line, location,
 * followers) is anchored to DOM STRUCTURE/POSITION rather than hashed
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
 *   Followers (preferred over connections — client request):
 *   EITHER:
 *   <div>
 *     <p>870,998</p>
 *     <p>followers</p>                       <- isolated label + preceding count
 *   </div>
 *   OR:
 *   <p>870,998 followers</p>                 <- combined count + label
 *
 * Creator / Activity-card layouts also expose followers under the
 * profile's own <h2>Activity</h2> section further down the page — we
 * check that as a fallback when the top card only shows connections.
 */

/** Leading honorifics that must not become firstName (e.g. "Dr. Hitesh Bhatt"). */
const LEADING_TITLE_RE = /^(dr|doctor|mr|mrs|ms|miss|mx|prof|professor|sir|dame|hon|rev|adv|er|ca)\.?$/i;
const TRAILING_SUFFIX_RE = /^(jr|sr|ii|iii|iv|v|phd|ph\.d|md|m\.d|mba|m\.b\.a|msc|m\.sc|ms|m\.s|btech|b\.tech|mtech|m\.tech|cfa|cpa|ca|esq)\.?$/i;

/**
 * "Dr. Hitesh Bhatt" → firstName=Hitesh, lastName=Bhatt
 * "Hitesh Bhatt"     → firstName=Hitesh, lastName=Bhatt
 */
function splitPersonName(fullName) {
    const parts = String(fullName || "")
        .trim()
        .split(/\s+/)
        .map(part => part.replace(/^[,]+|[,]+$/g, ""))
        .filter(Boolean);

    while (parts.length > 1 && LEADING_TITLE_RE.test(parts[0].replace(/,+$/, ""))) {
        parts.shift();
    }

    while (parts.length > 1 && TRAILING_SUFFIX_RE.test(parts[parts.length - 1])) {
        parts.pop();
    }

    const firstName = (parts.shift() || "").replace(/,+$/g, "");
    const lastName = parts.length ? parts[parts.length - 1].replace(/,+$/g, "") : "";
    return { firstName, lastName };
}

function extractTopCardInPage(fullName) {

    const clean = s => (s || "").replace(/\s+/g, " ").trim();
    const normalize = s => clean(s).toLowerCase();

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
    const isCountLike = text => /^[\d,]+\+?\s*(followers?|connections?)$/i.test(text);
    const isPlaceLike = text => {
        if (!text) return false;
        if (isCountLike(text)) return false;
        if (/contact info/i.test(text)) return false;
        if (text.length > 80) return false;
        return /,/.test(text) || /\b(remote|hybrid|on-site|onsite)\b/i.test(text);
    };
    const uniq = arr => Array.from(new Set(arr.filter(Boolean)));

    const result = { headline: "", companyLine: "", pronouns: "", location: "", followers: "" };
    const nameNode = Array.from(document.querySelectorAll("main h1, main h2")).find(
        el => clean(el.textContent) === fullName
    );
    const topCard =
        nameNode?.closest("section, article, main > div, main > section, div") ||
        document.querySelector("main");

    if (topCard) {
        const pTexts = uniq(
            Array.from(topCard.querySelectorAll("p, span"))
                .map(el => clean(el.textContent))
        );

        const pronounMatch = pTexts.find(text => PRONOUN_BADGE_PATTERN.test(text));
        result.pronouns = pronounMatch || "";

        const candidates = pTexts.filter(text =>
            text &&
            text !== fullName &&
            !isBadge(text) &&
            !isCountLike(text) &&
            !/^message$/i.test(text) &&
            !/^save$/i.test(text) &&
            !/^more$/i.test(text) &&
            !/^contact info$/i.test(text)
        );

        result.location =
            candidates.find(isPlaceLike) ||
            "";

        result.headline =
            candidates.find(text =>
                !isPlaceLike(text) &&
                !/·/.test(text) &&
                text.length <= 180
            ) ||
            "";

        result.companyLine =
            candidates.find(text =>
                normalize(text) !== normalize(result.headline) &&
                normalize(text) !== normalize(result.location) &&
                (text.includes("·") || /\bat\b/i.test(text))
            ) ||
            candidates.find(text =>
                normalize(text) !== normalize(result.headline) &&
                normalize(text) !== normalize(result.location) &&
                !isPlaceLike(text)
            ) ||
            "";
    }

    // ---- location: anchored to the "Contact info" overlay link ----
    const contactLink = document.querySelector('a[href*="overlay/contact-info"]');
    if (contactLink) {
        const container = contactLink.closest("div");
        const placeTexts = uniq(
            Array.from(container?.querySelectorAll("p, span") || [])
                .map(el => clean(el.textContent))
                .filter(isPlaceLike)
        );
        if (placeTexts.length) result.location = placeTexts[0];
    }

    // ---- followers (not connections) ----
    // Pattern A: isolated <div> with an exact "followers" <p>, count is
    // the preceding sibling <p>.
    const followersLabel = Array.from(document.querySelectorAll("p")).find(
        p => /^followers?$/i.test(clean(p.textContent))
    );
    if (followersLabel) {
        const prev = followersLabel.previousElementSibling;
        if (prev && prev.tagName === "P") {
            result.followers = clean(prev.textContent);
        }
    }

    // Pattern B: a single <p> combining count + label, e.g. "870,998 followers".
    if (!result.followers) {
        const combined = Array.from(document.querySelectorAll("p")).find(
            p => /^[\d,]+\+?\s+followers?$/i.test(clean(p.textContent))
        );
        if (combined) {
            const match = clean(combined.textContent).match(/^([\d,]+\+?)\s+followers?$/i);
            if (match) result.followers = match[1];
        }
    }

    // Pattern C: Activity card — "<h2>Activity</h2>" region often shows
    // "N followers" when the top card only exposes connections.
    if (!result.followers) {
        const headings = Array.from(document.querySelectorAll("main h2"));
        const activityH2 = headings.find(h => /^activity$/i.test(clean(h.textContent)));
        if (activityH2) {
            const region = activityH2.closest("section, div") || activityH2.parentElement;
            const regionText = clean(region?.innerText || "");
            const match = regionText.match(/([\d,]+\+?)\s+followers?\b/i);
            if (match) result.followers = match[1];
        }
    }

    if (!result.location && topCard) {
        const fallbackPlaces = uniq(
            Array.from(topCard.querySelectorAll('[class*="text-body-small"], p, span'))
                .map(el => clean(el.textContent))
                .filter(isPlaceLike)
        );
        result.location = fallbackPlaces[0] || "";
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

    const { firstName, lastName } = splitPersonName(fullName);

    // Follower count often lives on the Activity card further down; nudge
    // lazy sections into view before reading the top card + Activity.
    await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {});
    await page
        .locator("main h2")
        .filter({ hasText: /^Activity$/i })
        .first()
        .waitFor({ timeout: 3000 })
        .catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    const topCard = await page.evaluate(extractTopCardInPage, fullName);

    const location = validateLocation(topCard.location, fullName);
    const followers = validateFollowers(topCard.followers, fullName);

    // "Aeromexico · Universidad Estatal del Valle de Ecatepec" -> company, education
    // If LinkedIn renders "Title at Company", only take the company side here.
    const companyLineNormalized = (topCard.companyLine || "").replace(/\s+at\s+/i, " · ");
    const [companyName = "", education = ""] = companyLineNormalized
        .split("·")
        .map(s => s.trim());

    // Cross-checked against company/location so a misextraction (headline
    // field ending up with the company name or place) is caught, not just
    // pronoun/degree-badge shapes.
    const headline = validateHeadline(topCard.headline, fullName, companyName, location);

    if (!topCard.location) {
        log.info(`[${fullName}] No location found on profile (not filled in, or Contact info link absent)`);
    }
    if (!topCard.followers) {
        log.info(`[${fullName}] No followers count found on profile`);
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

        followers,

        openToWork

    };

}

module.exports = {

    getProfile,

    splitPersonName

};
