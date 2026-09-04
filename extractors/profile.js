const SELECTORS = require("../config/selectors");
const { validateHeadline, validateLocation, validateFollowers } = require("../utils/validators");
const { getPublicId } = require("../utils/linkedin-url");
const log = require("../utils/logger");

/**
 * Top-card field extraction (headline, company/education line, location,
 * followers) is anchored to DOM STRUCTURE/POSITION rather than hashed
 * CSS class names.
 *
 * Headline: prefer dedicated paragraph after the name (not nested <span>
 * fragments — those produced garbage like "This is a mo" from longer UI text).
 * Location: prefer precise "City, Region" near Contact info; accept country-only
 * as fallback (previously required a comma and dropped "India" / "United States").
 */

/** Leading honorifics that must not become firstName (e.g. "Dr. Hitesh Bhatt", "Eng. Abdulmajeed"). */
const LEADING_TITLE_RE = /^(dr|doctor|mr|mrs|ms|miss|mx|prof|professor|sir|dame|hon|rev|adv|er|ca|eng|engg|engr|engineer|ir|arch|ar)\.?$/i;

/** Trailing degrees / certifications / generational suffixes — never lastName. */
const TRAILING_SUFFIX_RE = /^(jr|sr|ii|iii|iv|v|phd|ph\.d|md|m\.d|mba|m\.b\.a|msa|m\.s\.a|mph|m\.p\.h|mpa|msc|m\.sc|ms|m\.s|llm|llb|bba|btech|b\.tech|mtech|m\.tech|miet|cfa|cpa|ca|esq|cissp|fmp|cfm|pmp|csm|cissp|pe|ra|aia|leed|leed\s*ap|cma|cia|cfe|frm|prm|shrm|phr|sphr|gphr|rn|np|do|dds|dmd|od|pharmd|jd|esq|ceng|cpeng|cping|peng|beng)\.?$/i;

/** Job-title words — used when LinkedIn stuffs the headline into the name via " - ". */
const EMBEDDED_TITLE_RE =
    /\b(architect|engineer|manager|director|officer|consultant|analyst|specialist|founder|president|executive|partner|principal|leader|head|lead|chief|owner|intern|associate|coordinator|scientist|designer|developer|fractional|revenue|retention|marketing|sales)\b/i;

/** Single-letter middle initials (optional period). */
const MIDDLE_INITIAL_RE = /^[A-Za-z]\.?$/;

/** Surname particles kept with the last name (St. John, Van Der Berg, De Luca). */
const SURNAME_PARTICLE_RE = /^(st|st\.|ste|ste\.|van|von|der|den|de|del|della|da|di|la|le|du|des|mc|mac|o'|al|el)$/i;

/**
 * "Dr. Hitesh R. Bhatt, MBA" → firstName=Hitesh, lastName=Bhatt
 * "Mark Kirn FMP"            → firstName=Mark, lastName=Kirn
 * "Christopher St. John"     → firstName=Christopher, lastName=St. John
 * "Anita Singh Rai"          → firstName=Anita, lastName=Rai
 */
function looksLikeCredential(token) {
    const raw = String(token || "").replace(/^,+|,+$/g, "");
    if (!raw) return false;
    if (TRAILING_SUFFIX_RE.test(raw)) return true;
    // Do NOT treat arbitrary ALL-CAPS tokens as credentials — surnames are
    // often shown in caps (HAU, LEE, KIM). Only known short cert codes.
    const letters = raw.replace(/\./g, "");
    return /^(FMP|CFM|PMP|CSM|CFA|CPA|CISSP|FRM|PRM|SHRM|PHR|SPHR|GPHR|LEED|AIA|CMA|CIA|CFE)$/i.test(letters);
}

/**
 * LinkedIn often appends the job title to the display name:
 *   "Courtenay Powell - Fractional Revenue and Retention Architect"
 * Keep only the person-name side. "Mark Kirn - FMP" also strips here.
 * Do not split hyphenated given names (Jean-Luc) — those have no spaces around "-".
 */
function stripEmbeddedTitleFromName(fullName) {
    const text = String(fullName || "").trim();
    const match = text.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (!match) return text;
    const left = match[1].trim();
    const right = match[2].trim();
    const rightWords = right.split(/\s+/).filter(Boolean);
    if (looksLikeCredential(right) || EMBEDDED_TITLE_RE.test(right) || rightWords.length >= 3) {
        return left;
    }
    return text;
}

function splitPersonName(fullName) {
    const parts = stripEmbeddedTitleFromName(fullName)
        .replace(/,/g, " ")
        // leftover "Name - Credential" → whitespace (defense in depth)
        .replace(/\s+[-–—]\s+/g, " ")
        .split(/\s+/)
        .map(part => part.replace(/^,+|,+$/g, "").replace(/^[-–—]+|[-–—]+$/g, ""))
        .filter(Boolean);

    while (parts.length > 1 && LEADING_TITLE_RE.test(parts[0])) {
        parts.shift();
    }

    while (parts.length > 1 && looksLikeCredential(parts[parts.length - 1])) {
        parts.pop();
    }

    // Drop bare middle initials between first and last ("John M. Smith" → John / Smith)
    const core = parts.filter((part, idx) => {
        if (idx === 0 || idx === parts.length - 1) return true;
        return !MIDDLE_INITIAL_RE.test(part);
    });

    const firstName = core.shift() || "";
    if (!core.length) {
        return { firstName, lastName: "" };
    }

    // Keep surname particles with the final token (St. John, Van Der Berg)
    const lastTokens = [];
    for (let i = core.length - 1; i >= 0; i--) {
        lastTokens.unshift(core[i]);
        if (i === 0) break;
        if (!SURNAME_PARTICLE_RE.test(core[i - 1])) break;
    }

    return {
        firstName,
        lastName: lastTokens.join(" ")
    };
}

function extractTopCardInPage(fullName) {

    const clean = s => (s || "").replace(/\s+/g, " ").trim();
    const normalize = s => clean(s).toLowerCase();

    const DEGREE_BADGE_PATTERN = /^(·\s*)?\d+(st|nd|rd|th)\+?$/i;
    const PRONOUN_WORDS = "he|him|his|she|her|hers|they|them|their|theirs|ze|zir|zirs|xe|xem|xyr";
    const PRONOUN_BADGE_PATTERN = new RegExp(
        `^(${PRONOUN_WORDS})\\s*/\\s*(${PRONOUN_WORDS})(\\s*/\\s*(${PRONOUN_WORDS}))?$`, "i"
    );

    // LinkedIn UI chrome / truncated nested-span garbage (e.g. "This is a mo")
    const UI_NOISE = /^(this is a\b|see more|show more|show less|message|connect|connections?|follow|followers?|save|more|contact info|open to work|premium|visit my website)$/i;
    const DIALOG_CHROME = /^(this is a modal|beginning of dialog|end of dialog)/i;

    // LinkedIn headline max is 220 chars. Longer prose is the About section.
    const HEADLINE_MAX = 220;
    const isAboutLike = text => {
        if (!text) return false;
        if (text.length > HEADLINE_MAX) return true;
        if (/\b(see more|…\s*more|\.{3}\s*more)\s*$/i.test(text)) return true;
        // Multi-sentence bio prose that leaked from About
        if (text.length > 140 && (text.match(/[.!?]/g) || []).length >= 2) return true;
        return false;
    };

    const isBadge = text => DEGREE_BADGE_PATTERN.test(text) || PRONOUN_BADGE_PATTERN.test(text);
    const isCountLike = text =>
        /^[\d,]+\+?\s*(followers?|connections?)$/i.test(text) ||
        /^(followers?|connections?)$/i.test(text);
    const isUiNoise = text =>
        UI_NOISE.test(text) ||
        /^this is a /i.test(text) ||
        DIALOG_CHROME.test(text);

    // Precise locations usually have a comma; country-only is still valid.
    const PROFESSION_OR_TITLE =
        /\b(officer|manager|director|engineer|architect|founder|consultant|analyst|specialist|executive|president|economist|scientist|researcher|professor|lecturer|physician|lawyer|attorney|accountant|auditor|banker|trader|designer|developer|nurse|teacher|quant|quantitative|ceo|cfo|cto|coo|vp|svp|evp|leader|head|lead|chief|partner|principal|owner|fractional|intern|associate|coordinator|advisor|adviser|investor|entrepreneur)\b/i;

    const isPrecisePlace = text => {
        if (!text || isCountLike(text) || /contact info/i.test(text)) return false;
        if (text.length > 90) return false;
        // Job titles often contain commas:
        // "Director Clinical Operations, UMMC Department of ..."
        if (PROFESSION_OR_TITLE.test(text)) return false;
        // "Company · School" is not a place
        if (/[|·]/.test(text)) return false;
        return /,/.test(text) || /\b(remote|hybrid|on-site|onsite)\b/i.test(text);
    };
    // Top-card "University · School" line — never the person headline
    const isCompanyEducationLine = text => {
        if (!text || !text.includes("·")) return false;
        const left = text.split("·")[0].trim();
        return left.length >= 2 && !PROFESSION_OR_TITLE.test(left);
    };
    const isCountryOrRegion = text => {
        if (!text || isCountLike(text) || isPrecisePlace(text)) return false;
        if (text.length < 3 || text.length > 60) return false;
        if (/[|·]/.test(text)) return false;
        if (/\d{4}/.test(text)) return false;
        // Never treat job titles / professions as places
        if (PROFESSION_OR_TITLE.test(text)) return false;
        // Allowlist only — no Title-Case guessing (that rejected
        // "Quantitative Economist", "Advisor", custom short headlines).
        return /^(united states|united kingdom|saudi arabia|united arab emirates|uae|india|australia|canada|germany|france|singapore|china|japan|brazil|mexico|south africa|netherlands|ireland|new zealand|qatar|kuwait|bahrain|oman|egypt|nigeria|pakistan|bangladesh|indonesia|malaysia|thailand|vietnam|philippines|hong kong|taiwan|south korea|italy|spain|portugal|sweden|norway|denmark|finland|switzerland|austria|belgium|poland|turkey|israel|russia|ukraine|greater london|england|scotland|wales|california|texas|new york|florida|massachusetts|bavaria|munich|london|paris|berlin|dubai|riyadh|jeddah|doha|singapore|tokyo|sydney|melbourne|toronto|vancouver|chicago|boston|seattle|atlanta|houston|dallas|miami|denver|phoenix)$/i.test(text);
    };

    const uniq = arr => Array.from(new Set(arr.filter(Boolean)));

    // Strip trailing credentials / embedded titles so name matching works
    const nameKey = s => {
        let t = clean(s);
        const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
        if (m) {
            const right = m[2].trim();
            if (
                /\b(architect|engineer|manager|director|officer|consultant|analyst|specialist|founder|president|executive|partner|principal|leader|fractional|revenue|retention)\b/i.test(right) ||
                right.split(/\s+/).length >= 3 ||
                /^(fmp|cfm|pmp|csm|cfa|cpa|mba|phd|md)$/i.test(right)
            ) {
                t = m[1].trim();
            }
        }
        return t
            .toLowerCase()
            .replace(/,/g, " ")
            .replace(/\s+[-–—]\s+/g, " ")
            .replace(/\b(jr|sr|ii|iii|iv|v|phd|md|mba|msa|mph|mpa|msc|ms|llm|llb|fmp|cfm|pmp|csm|cfa|cpa|pe|rn|jd|esq|ceng|cpeng|cping|beng)\.?\b/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    };

    const result = { headline: "", companyLine: "", pronouns: "", location: "", followers: "" };

    // Prefer LinkedIn's stable anonymize hooks when present (never About-length)
    const anonHeadline = document.querySelector('[data-anonymize="headline"], [data-anonymize="person-headline"]');
    if (anonHeadline) {
        const t = clean(anonHeadline.textContent);
        if (t && !isUiNoise(t) && !isBadge(t) && !isAboutLike(t)) result.headline = t;
    }

    const wanted = nameKey(fullName);
    const nameCandidates = Array.from(document.querySelectorAll("main h1, main h2"));
    let nameNode = nameCandidates.find(el => clean(el.textContent) === fullName);
    if (!nameNode && wanted) {
        nameNode = nameCandidates.find(el => {
            const key = nameKey(el.textContent);
            return key && (key === wanted || key.startsWith(wanted) || wanted.startsWith(key));
        });
    }
    // Top-card name is usually the first non-section h1/h2 in main
    if (!nameNode) {
        nameNode = nameCandidates.find(el => {
            const t = clean(el.textContent);
            return t && !/^(activity|experience|education|skills|about|interests|publications)$/i.test(t);
        });
    }

    // Scope to the top-card section so About <p> further down main never wins.
    const topCard =
        nameNode?.closest("section, article") ||
        nameNode?.parentElement?.parentElement ||
        document.querySelector("main");

    // ---- Structural: top-card <p> lines = headline / company / location ----
    if (nameNode && topCard) {
        const nodes = Array.from(topCard.querySelectorAll("h1, h2, p"));
        const nameIdx = nodes.findIndex(el => el === nameNode);
        const followingPs = (nameIdx === -1 ? nodes : nodes.slice(nameIdx + 1))
            .filter(el => el.tagName === "P")
            .map(el => clean(el.textContent))
            .filter(Boolean);

        result.pronouns = followingPs.find(t => PRONOUN_BADGE_PATTERN.test(t)) || "";

        const usable = followingPs.filter(t =>
            !isBadge(t) &&
            !isCountLike(t) &&
            !isUiNoise(t) &&
            !isAboutLike(t) &&
            !/^contact info$/i.test(t)
        );

        if (!result.headline) {
            // LinkedIn top-card order after name: headline, then company · edu,
            // then location. Take the FIRST usable non-place line — including
            // headlines that contain "·" or " at " (very common).
            const isHeadlineCandidate = t =>
                !isPrecisePlace(t) &&
                !isCountryOrRegion(t) &&
                !isCompanyEducationLine(t) &&
                t.length >= 3 &&
                t.length <= HEADLINE_MAX;

            result.headline =
                usable.find(t => t.includes("|") && isHeadlineCandidate(t)) ||
                usable.find(t => isHeadlineCandidate(t) && !t.includes("·")) ||
                usable.find(isHeadlineCandidate) ||
                "";
        }

        // Company/education line uses a middot between two orgs.
        result.companyLine =
            usable.find(t =>
                normalize(t) !== normalize(result.headline) &&
                (isCompanyEducationLine(t) || t.includes("·"))
            ) || "";
    }

    // Fallback: text-body-medium near the top card (common LinkedIn headline class)
    if (!result.headline && topCard) {
        const medium = uniq(
            Array.from(topCard.querySelectorAll('[class*="text-body-medium"], p'))
                .map(el => clean(el.textContent))
        ).filter(t =>
            t &&
            nameKey(t) !== wanted &&
            !isBadge(t) &&
            !isCountLike(t) &&
            !isUiNoise(t) &&
            !isAboutLike(t) &&
            !/^contact info$/i.test(t) &&
            !isPrecisePlace(t) &&
            !isCountryOrRegion(t) &&
            t.length <= HEADLINE_MAX
        );

        result.headline =
            medium.find(t => t.includes("|") && t.length >= 3) ||
            medium.find(t => t.length >= 3) ||
            "";
    }

    if (!result.companyLine && topCard) {
        const pTexts = uniq(
            Array.from(topCard.querySelectorAll("p")).map(el => clean(el.textContent))
        );
        result.companyLine =
            pTexts.find(t =>
                normalize(t) !== normalize(result.headline) &&
                t.includes("·")
            ) || "";
    }

    // ---- Location: Contact info container first; prefer precise over country ----
    const contactLink = document.querySelector('a[href*="overlay/contact-info"]');
    if (contactLink) {
        const container = contactLink.closest("div");
        const texts = uniq(
            Array.from(container?.querySelectorAll("p") || [])
                .map(el => clean(el.textContent))
        );
        result.location =
            texts.find(isPrecisePlace) ||
            texts.find(isCountryOrRegion) ||
            texts.find(t => t && !/^contact info$/i.test(t) && !isBadge(t) && !isCountLike(t) && t.length < 80) ||
            "";
    }

    if (!result.location && topCard) {
        const texts = uniq(
            Array.from(topCard.querySelectorAll("p"))
                .map(el => clean(el.textContent))
        );
        result.location =
            texts.find(isPrecisePlace) ||
            texts.find(isCountryOrRegion) ||
            "";
    }

    // ---- followers ----
    const followersLabel = Array.from(document.querySelectorAll("p")).find(
        p => /^followers?$/i.test(clean(p.textContent))
    );
    if (followersLabel) {
        const prev = followersLabel.previousElementSibling;
        if (prev && prev.tagName === "P") {
            result.followers = clean(prev.textContent);
        }
    }

    if (!result.followers) {
        const combined = Array.from(document.querySelectorAll("p")).find(
            p => /^[\d,]+\+?\s+followers?$/i.test(clean(p.textContent))
        );
        if (combined) {
            const match = clean(combined.textContent).match(/^([\d,]+\+?)\s+followers?$/i);
            if (match) result.followers = match[1];
        }
    }

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

    return result;
}

async function getProfile(page) {

    // Prefer the profile identity heading (h1 on newer layouts, else h2).
    let fullName = "";
    const nameLocators = [
        page.locator('main h1').filter({ hasText: /\S/ }).first(),
        page.locator(SELECTORS.PROFILE.NAME).filter({ hasText: /\S/ }).nth(1),
        page.locator(SELECTORS.PROFILE.NAME).filter({ hasText: /\S/ }).first()
    ];
    for (const loc of nameLocators) {
        const text = await loc.textContent().catch(() => "");
        const cleaned = (text || "").replace(/\s+/g, " ").trim();
        if (cleaned && !/^(activity|experience|education|skills)$/i.test(cleaned)) {
            fullName = cleaned;
            break;
        }
    }
    if (!fullName) {
        throw new Error("Could not read profile name from top card");
    }

    const { firstName, lastName } = splitPersonName(fullName);

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

    const companyLineNormalized = (topCard.companyLine || "").replace(/\s+at\s+/i, " · ");
    const [companyName = "", education = ""] = companyLineNormalized
        .split("·")
        .map(s => s.trim());

    const headline = validateHeadline(topCard.headline, fullName, companyName, location);

    if (!topCard.location) {
        log.info(`[${fullName}] No location found on profile (not filled in, or Contact info link absent)`);
    }
    if (!topCard.followers) {
        log.info(`[${fullName}] No followers count found on profile`);
    }
    if (!headline) {
        log.warning(`[${fullName}] Headline empty after extraction`);
    }

    const about = await page
        .locator('[data-testid="expandable-text-box"]')
        .first()
        .textContent()
        .then(t => (t || "").replace(/\s+/g, " ").trim())
        .catch(() => "");

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

/**
 * Node-side mirror of top-card headline selection (for tests / debugging).
 *
 * LinkedIn top-card order after the name is: headline → company · edu →
 * location. First usable non-place line wins (including "Title at Company"
 * and lines with "·"). Company/education is the middot line only.
 */
function pickHeadlineFromCandidates(candidates) {
    const clean = s => String(s || "").replace(/\s+/g, " ").trim();
    const HEADLINE_MAX = 220;
    const PROFESSION_OR_TITLE =
        /\b(officer|manager|director|engineer|architect|founder|consultant|analyst|specialist|executive|president|economist|scientist|researcher|professor|lecturer|physician|lawyer|attorney|accountant|auditor|banker|trader|designer|developer|nurse|teacher|quant|quantitative|ceo|cfo|cto|coo|vp|svp|evp|leader|head|lead|chief|partner|principal|owner|fractional|intern|associate|coordinator|advisor|adviser|investor|entrepreneur)\b/i;
    const isBadge = text => /^(·\s*)?\d+(st|nd|rd|th)\+?$/i.test(text);
    const isCountLike = text =>
        /^[\d,]+\+?\s*(followers?|connections?)$/i.test(text) ||
        /^(followers?|connections?)$/i.test(text);
    const isUiNoise = text =>
        /^(this is a\b|see more|show more|show less|message|connect|connections?|follow|followers?|save|more|contact info|open to work|premium|visit my website)$/i.test(text) ||
        /^(this is a modal|beginning of dialog|end of dialog)/i.test(text);
    const isAboutLike = text => {
        if (!text) return false;
        if (text.length > HEADLINE_MAX) return true;
        if (/\b(see more|…\s*more|\.{3}\s*more)\s*$/i.test(text)) return true;
        if (text.length > 140 && (text.match(/[.!?]/g) || []).length >= 2) return true;
        return false;
    };
    const isPrecisePlace = text => {
        if (!text || isCountLike(text) || /contact info/i.test(text)) return false;
        if (text.length > 90) return false;
        if (PROFESSION_OR_TITLE.test(text)) return false;
        if (/[|·]/.test(text)) return false;
        return /,/.test(text) || /\b(remote|hybrid|on-site|onsite)\b/i.test(text);
    };
    const isCompanyEducationLine = text => {
        if (!text || !text.includes("·")) return false;
        const left = text.split("·")[0].trim();
        return left.length >= 2 && !PROFESSION_OR_TITLE.test(left);
    };
    const isCountryOrRegion = text => {
        if (!text || isCountLike(text) || isPrecisePlace(text)) return false;
        if (text.length < 3 || text.length > 60) return false;
        if (/[|·]/.test(text)) return false;
        if (/\d{4}/.test(text)) return false;
        if (PROFESSION_OR_TITLE.test(text)) return false;
        return /^(united states|united kingdom|saudi arabia|united arab emirates|uae|india|australia|canada|germany|france|singapore|china|japan|brazil|mexico|south africa|netherlands|ireland|new zealand|qatar|kuwait|bahrain|oman|egypt|nigeria|pakistan|bangladesh|indonesia|malaysia|thailand|vietnam|philippines|hong kong|taiwan|south korea|italy|spain|portugal|sweden|norway|denmark|finland|switzerland|austria|belgium|poland|turkey|israel|russia|ukraine|greater london|england|scotland|wales|california|texas|new york|florida|massachusetts|bavaria|munich|london|paris|berlin|dubai|riyadh|jeddah|doha|tokyo|sydney|melbourne|toronto|vancouver|chicago|boston|seattle|atlanta|houston|dallas|miami|denver|phoenix)$/i.test(text);
    };

    const usable = (candidates || [])
        .map(clean)
        .filter(t =>
            t &&
            !isBadge(t) &&
            !isCountLike(t) &&
            !isUiNoise(t) &&
            !isAboutLike(t) &&
            !/^contact info$/i.test(t)
        );

    const isHeadlineCandidate = t =>
        !isPrecisePlace(t) &&
        !isCountryOrRegion(t) &&
        !isCompanyEducationLine(t) &&
        t.length >= 3 &&
        t.length <= HEADLINE_MAX;

    return (
        usable.find(t => t.includes("|") && isHeadlineCandidate(t)) ||
        usable.find(t => isHeadlineCandidate(t) && !t.includes("·")) ||
        usable.find(isHeadlineCandidate) ||
        ""
    );
}

module.exports = {
    getProfile,
    splitPersonName,
    pickHeadlineFromCandidates
};
