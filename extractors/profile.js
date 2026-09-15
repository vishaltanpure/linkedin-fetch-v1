const SELECTORS = require("../config/selectors");
const { validateHeadline, validateLocation, validateFollowers } = require("../utils/validators");
const { getPublicId } = require("../utils/linkedin-url");
const { PRONOUN_WORDS, isPronounBadge } = require("../utils/pronouns");
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
const LEADING_TITLE_RE = /^(dr|doctor|mr|mrs|ms|miss|mx|prof|professor|sir|dame|hon|rev|adv|er|ca|eng|engg|engr|engineer|ing|dipl|ir|arch|ar)\.?$/i;

/**
 * Academic/honorific particles that only ever appear as part of a compound
 * title — "Dr.-Ing.", "Dr. rer. nat.", "Dipl.-Ing.", "Prof. Dr. med.".
 * Never used on their own to strip a token; see isLeadingTitleToken().
 */
const TITLE_PARTICLE_RE = /^(ing|dipl|mag|med|rer|nat|habil|hc|univ|techn)\.?$/i;

/** Trailing degrees / certifications / generational suffixes — never lastName. */
const TRAILING_SUFFIX_RE = /^(jr|sr|ii|iii|iv|v|phd|ph\.d|md|m\.d|mba|m\.b\.a|msa|m\.s\.a|mph|m\.p\.h|mpa|msc|m\.sc|ms|m\.s|llm|llb|bba|btech|b\.tech|mtech|m\.tech|miet|cfa|cpa|ca|esq|cissp|fmp|cfm|pmp|csm|cissp|pe|ra|aia|leed|leed\s*ap|cma|cia|cfe|frm|prm|shrm|phr|sphr|gphr|rn|np|do|dds|dmd|od|pharmd|jd|esq|ceng|cpeng|cping|peng|beng)\.?$/i;

/**
 * Professional post-nominals that arrive as ALL-CAPS acronyms.
 *
 * Stored punctuation-free and UPPER-CASE. A token only matches when it is
 * written in caps ("ARRT") or carries periods ("M.M.", "M.Eng") — a normal
 * mixed-case surname can never match, and an unknown caps token is still
 * treated as a surname, so genuinely capitalised names (HAU, LEE, KIM) are
 * unaffected. Deliberately excludes two-letter forms that are common
 * surnames in their own right (MA, BA, DO, HO, NG, LI).
 */
const CREDENTIAL_ACRONYMS = new Set([
    // Degrees
    "MBA", "MSA", "MPH", "MPA", "MSC", "MS", "MM", "MED", "MENG", "MFA", "MPP",
    "MSN", "MSW", "MPS", "BSC", "BENG", "BBA", "BTECH", "MTECH", "BS", "BSN",
    "PHD", "EDD", "JD", "LLM", "LLB", "MD", "DDS", "DMD", "DVM", "OD", "PHARMD",
    "DNP", "DBA", "PSYD", "DPT", "DSC",
    // Accounting / finance
    "CPA", "CFA", "CFP", "CMA", "CIA", "CFE", "CTP", "CTFA", "CLU", "CHFC",
    "ACA", "ACCA", "CIMA", "FCA", "CFM", "FMP", "FRM", "PRM", "CAIA", "CGMA",
    // Project / process / IT
    "PMP", "CSM", "PSM", "CSPO", "ACP", "CBAP", "CCBA", "ITIL", "TOGAF",
    "CISA", "CISM", "CISSP", "CCNA", "CCNP", "CCIE", "CEH", "GCPM", "GMP",
    "LSSBB", "LSSGB", "SSBB", "SSGB", "CPIM", "CSCP", "CPSM", "CPM", "CIM",
    // HR
    "SPHR", "PHR", "GPHR", "SHRM", "SHRMCP", "SHRMSCP", "CHRM", "HRM", "CDS",
    // Marketing
    "PCM", "CDMP", "CIPP", "CIPM",
    // Architecture / engineering / safety
    "AIA", "AIC", "NCARB", "LEED", "PE", "RA", "CEM", "CENG", "CSP", "CIH",
    "CHST", "OHST", "COHS", "CP", "CPP", "AZCP",
    // Clinical
    "RN", "LPN", "NP", "PA", "APRN", "CRNA", "ARRT", "RT", "RRT", "CPHQ",
    "CHFP", "FACHE", "FACS", "FAAP", "CCRN", "CNOR"
]);

/** Job-title words — used when LinkedIn stuffs the headline into the name via " - ". */
const EMBEDDED_TITLE_RE =
    /\b(architect|engineer|manager|director|officer|consultant|analyst|specialist|founder|president|executive|partner|principal|leader|head|lead|chief|owner|intern|associate|coordinator|scientist|designer|developer|fractional|revenue|retention|marketing|sales)\b/i;

/** Single-letter middle initials (optional period). */
const MIDDLE_INITIAL_RE = /^[A-Za-z]\.?$/;

/** Surname particles kept with the last name (St. John, Van Der Berg, De Luca). */
const SURNAME_PARTICLE_RE = /^(st|st\.|ste|ste\.|van|von|der|den|de|del|della|da|di|la|le|du|des|mc|mac|o'|al|el)$/i;

/** A bare initial: "J", "J.". */
function isBareInitial(token) {
    return MIDDLE_INITIAL_RE.test(String(token || "").trim());
}

/** Lower-case alphanumeric form used to compare a name token against a vanity slug. */
function slugKey(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True when the vanity slug corroborates that `token` is part of the person's
 * real name. Works for both hyphenated ("chandana-basaveni") and glued
 * ("chandanabasaveni") slugs. Short tokens are ignored — two characters match
 * far too easily to be evidence of anything.
 */
function slugConfirms(publicId, token) {
    const slug = slugKey(publicId);
    const key = slugKey(token);
    return key.length >= 3 && slug.includes(key);
}

/**
 * "Dr. Hitesh R. Bhatt, MBA" → firstName=Hitesh, lastName=Bhatt
 * "Mark Kirn FMP"            → firstName=Mark, lastName=Kirn
 * "Christopher St. John"     → firstName=Christopher, lastName=St. John
 * "Anita Singh Rai"          → firstName=Anita, lastName=Rai
 */
function looksLikeCredential(token) {
    const raw = String(token || "").replace(/^[,\s]+|[,\s]+$/g, "");
    if (!raw) return false;
    if (TRAILING_SUFFIX_RE.test(raw)) return true;

    // Caps ("ARRT") or dotted ("M.M.", "M.Eng") only. A plain mixed-case word
    // is a name, never a credential — that is what keeps surnames safe.
    const isCapsOrDotted = raw === raw.toUpperCase() || raw.includes(".");
    if (isCapsOrDotted && CREDENTIAL_ACRONYMS.has(raw.replace(/[.\s]/g, "").toUpperCase())) {
        return true;
    }

    // Hyphenated credential + qualifier: "MBA-Actg", "SHRM-CP", "LEED-AP".
    const head = raw.split(/[-–—]/)[0];
    if (head && head !== raw) {
        const headKey = head.replace(/[.\s]/g, "").toUpperCase();
        const headIsCapsOrDotted = head === head.toUpperCase() || head.includes(".");
        if (headIsCapsOrDotted &&
            (CREDENTIAL_ACRONYMS.has(headKey) || TRAILING_SUFFIX_RE.test(head))) {
            return true;
        }
    }

    return false;
}

/** Leftover tokens that carry no name information: "09", ".", "-". */
function isJunkToken(token) {
    const raw = String(token || "").trim();
    if (!raw) return true;
    if (/^\d+$/.test(raw)) return true;
    return !/[\p{L}]/u.test(raw);
}

/**
 * True for a whole token that is nothing but honorifics — "Dr.", "Dr.-Ing.",
 * "Dipl.-Ing.". Every dot/hyphen-separated piece has to be a title, so
 * "St." (particle) and "Al-Shehri" (surname) are never mistaken for one.
 */
function isLeadingTitleToken(token) {
    const raw = String(token || "").trim();
    if (!raw) return false;
    if (LEADING_TITLE_RE.test(raw)) return true;
    const pieces = raw.split(/[.\-–—]+/).filter(Boolean);
    if (pieces.length < 2) return false;
    let sawTitle = false;
    for (const piece of pieces) {
        if (LEADING_TITLE_RE.test(piece)) {
            sawTitle = true;
            continue;
        }
        if (TITLE_PARTICLE_RE.test(piece)) continue;
        return false;
    }
    return sawTitle;
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

/**
 * Drop comma-separated post-nominal groups.
 *
 * The comma in "Karen Parker, AIC" / "Becky Reed, CDMP, PCM" is the single
 * most reliable signal LinkedIn gives about where the name stops and the
 * letters after it begin — the previous implementation replaced every comma
 * with a space as its FIRST step, destroying that signal and leaving the
 * credential standing as the final token (i.e. as LAST_NAME).
 *
 * Only a trailing group that actually contains a credential is dropped, and
 * only when it is short, so "Dr., Hitesh R. Bhatt, MBA" loses "MBA" alone and
 * "Nguyen, Anh" (Last, First) is left intact.
 */
function stripPostNominalGroups(text) {
    const segments = String(text || "").split(",").map(s => s.trim()).filter(Boolean);
    if (segments.length <= 1) return segments[0] || "";

    const kept = [segments[0]];
    for (const segment of segments.slice(1)) {
        const tokens = segment.split(/\s+/).filter(Boolean);
        // "MBA" / "CDMP" / "Wharton GMP" — a short group carrying a credential
        // is a post-nominal phrase, not part of the person's name.
        if (tokens.some(looksLikeCredential) && tokens.length <= 3) continue;
        kept.push(segment);
    }
    return kept.join(" ");
}

function splitPersonName(fullName, publicId) {

    const cleaned = stripPostNominalGroups(
        stripEmbeddedTitleFromName(fullName)
            // "Petr Kodl (inactive)" / "Daniel Palacios (Aerospace networker)"
            .replace(/[(（\[][^)）\]]*[)）\]]/g, " ")
            .replace(/[“”"][^“”"]*[“”"]/g, " ")
    );

    let parts = cleaned
        // "Engg.Abdulmajeed" / "Dr.Hitesh" (period, no space) → insert space
        .replace(
            /^(engg|engr|engineer|eng|dr|doctor|mr|mrs|ms|miss|mx|prof|professor|sir|dame|hon|rev|adv|ir|arch)\.(?=[A-Za-z])/i,
            "$1. "
        )
        // leftover "Name - Credential" → whitespace (defense in depth)
        .replace(/\s+[-–—]\s+/g, " ")
        .split(/\s+/)
        .map(part => part.replace(/^,+|,+$/g, "").replace(/^[-–—]+|[-–—]+$/g, ""))
        .filter(Boolean)
        // "Dr . Thomas Kupferschmidt" leaves a lone "."; "Peter Linden 09"
        // leaves a bare number. Neither is ever part of a person's name, and
        // an orphan "." previously survived to become FIRST_NAME.
        .filter(part => !isJunkToken(part));

    while (parts.length > 1 && isLeadingTitleToken(parts[0])) {
        parts.shift();
    }

    while (parts.length > 1 && looksLikeCredential(parts[parts.length - 1])) {
        parts.pop();
    }

    // "E. Brooke Moore" / "J. Timothy Gorman" — a US-style leading initial.
    // The given name the person actually goes by is the NEXT token, and the
    // vanity slug agrees (e-brooke-moore, j-timothy-gorman). Skipped when the
    // following token is itself an initial or a surname particle, so
    // "P. St. John" keeps "P." as the first name — there is no other given
    // name there to promote.
    if (
        parts.length >= 3 &&
        isBareInitial(parts[0]) &&
        !isBareInitial(parts[1]) &&
        !SURNAME_PARTICLE_RE.test(parts[1]) &&
        !isLeadingTitleToken(parts[1])
    ) {
        parts = parts.slice(1);
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

    // ALL-CAPS surname (e.g. "Chi Chung HAU") → given name may be multi-token.
    // Runs after credential stripping, so "Karen Parker AIC" has already lost
    // its "AIC" and never reaches this branch.
    const tail = core[core.length - 1];
    if (/^[A-Z]{2,8}$/.test(tail) && core.length >= 1) {
        return {
            firstName: [firstName, ...core.slice(0, -1)].filter(Boolean).join(" "),
            lastName: tail
        };
    }

    // NOTE: a slug-adjacency "compound surname" merge used to live here
    // ("lindsay-avent-jay" -> lastName "Avent Jay"). It was removed because the
    // slug cannot distinguish a compound surname from an ordinary middle name:
    // every 3-token name whose slug carries all three tokens matched it, so
    // "Anita Singh Rai" became "Singh Rai" and "Rajesh Kumar Sharma" became
    // "Kumar Sharma". The last token is the surname; genuine compounds are
    // still joined below when a particle (Van, De, St., Al) links them.

    // Keep surname particles with the final token (St. John, Van Der Berg)
    const lastTokens = [];
    for (let i = core.length - 1; i >= 0; i--) {
        lastTokens.unshift(core[i]);
        if (i === 0) break;
        if (!SURNAME_PARTICLE_RE.test(core[i - 1])) break;
    }
    let lastName = lastTokens.join(" ");

    // "Chandana Basaveni B." / "Jotham Ndugga-Kabuye I" — LinkedIn shows a
    // trailing initial AFTER the surname. The real surname is the token in
    // front of it, but only when the vanity slug confirms that token is part
    // of the name (so "Tracey S.", who has no surname on LinkedIn at all,
    // still yields "S." rather than a guess).
    if (isBareInitial(lastName) && core.length >= 2) {
        const candidate = core[core.length - 2];
        if (candidate && !isBareInitial(candidate) && slugConfirms(publicId, candidate)) {
            lastName = candidate;
        }
    }

    return {
        firstName,
        lastName
    };
}

function extractTopCardInPage({ fullName, pronounWords }) {

    const clean = s => (s || "").replace(/\s+/g, " ").trim();
    const normalize = s => clean(s).toLowerCase();

    const DEGREE_BADGE_PATTERN = /^(·\s*)?\d+(st|nd|rd|th)\+?$/i;
    const PRONOUN_BADGE_PATTERN = new RegExp(
        `^(${pronounWords})\\s*/\\s*(${pronounWords})(\\s*/\\s*(${pronounWords}))?$`,
        "i"
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
    // Organisation names present on the page. The last-resort locator below
    // takes whatever heading it finds, and on a profile whose top card had not
    // rendered that was once a company card — shipping "Siemens (inactive)" as
    // a person's first/last name. An org name is never a person name.
    const orgNames = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/company/"], a[href*="/school/"]'))
            .map(a => (a.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
    ).catch(() => []);
    const orgNameSet = new Set(orgNames.map(n => n.toLowerCase()));

    // Section headings and activity-tab titles that are never a person's name.
    // "All activity" is the heading of /in/<id>/recent-activity/all/ — reached
    // when an input row carries that sub-route (index.js now normalises those
    // away, so this is the second line of defence).
    const NOT_A_PERSON_NAME =
        /^(all activity|activity|posts|comments|reactions|documents|images|videos|newsletters|experience|education|skills|about|interests|publications|explore|ad options|don[’']t want)\b/i;

    for (const loc of nameLocators) {
        const text = await loc.textContent().catch(() => "");
        const cleaned = (text || "").replace(/\s+/g, " ").trim();
        if (!cleaned || NOT_A_PERSON_NAME.test(cleaned)) continue;
        if (orgNameSet.has(cleaned.toLowerCase())) {
            log.warning(`Skipping name candidate "${cleaned}" — matches a company/school on the page`);
            continue;
        }
        fullName = cleaned;
        break;
    }
    if (!fullName) {
        throw new Error("Could not read profile name from top card");
    }
    if (/this page doesn[’']t exist|page not found/i.test(fullName)) {
        throw new Error("Profile not found (LinkedIn 404 page)");
    }

    let publicId = null;
    try {
        publicId = getPublicId(page.url());
    } catch {
        publicId = null;
    }

    const { firstName, lastName } = splitPersonName(fullName, publicId);

    await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {});
    await page
        .locator("main h2")
        .filter({ hasText: /^Activity$/i })
        .first()
        .waitFor({ timeout: 1200 })
        .catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    const topCard = await page.evaluate(extractTopCardInPage, {
        fullName,
        pronounWords: PRONOUN_WORDS
    });

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
        .locator("main section")
        .filter({ has: page.locator("h2", { hasText: /^About$/i }) })
        .locator('[data-testid="expandable-text-box"]')
        .first()
        .textContent()
        .then(t => (t || "").replace(/\s+/g, " ").trim())
        .catch(() => "");

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
    const isBadge = text =>
        /^(·\s*)?\d+(st|nd|rd|th)\+?$/i.test(text) ||
        isPronounBadge(text);
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
