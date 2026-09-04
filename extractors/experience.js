/**
 * Experience extractor.
 *
 * ROOT-CAUSE NOTE
 * ---------------
 * The main profile page lazy-mounts the Experience / Education / Skills
 * cards on scroll (IntersectionObserver + code-splitting) and virtualizes
 * them off-screen. A DOM snapshot taken after scrolling therefore often
 * does NOT contain the Experience section at all — which is exactly why
 * `page.locator("section")` never found it.
 *
 * FIX
 * ---
 * Scrape LinkedIn's dedicated, deterministic route instead:
 *      /in/<publicId>/details/experience/
 * The full experience list is the primary content of that page, so it
 * renders reliably without any virtualization race.
 *
 * DOM shape (verified against the live Aug 2026 layout):
 *
 *   [componentkey^="entity-collection-item"]        (one per company)
 *     a[href*="/company/"]          <- logo (aria-label="X logo")
 *     a[href*="/company/"]          <- text link, wraps <p> lines
 *
 *   Single-role company:                 Grouped company (many roles):
 *     <p>Role title</p>                    header link:
 *     <p>Company · Employment type</p>       <p>Company</p>
 *     <p>Start - End · Duration</p>          <p>Total duration</p>
 *     <p>Location</p>            (opt)     nested <li> per role:
 *                                            <p>Role title</p>
 *                                            <p>Employment type</p>   (opt)
 *                                            <p>Start - End · Dur</p>
 *                                            <p>Location</p>          (opt)
 *
 * The per-role <p> lines are NOT positionally stable (the employment-type
 * line is sometimes present, sometimes folded into the company line), so
 * each line is classified by pattern rather than by index.
 */

const { buildExperienceUrl, toCompanyAboutUrl, toCompanyLinkedinUrl } = require("../utils/linkedin-url");
const scroll = require("../utils/scroll");

// ---------------------------------------------------------------------------
// In-page collection. Returns one object per company entity. Self-contained.
// ---------------------------------------------------------------------------
function collectEntitiesInPage() {

    const clean = s =>
        (s || "").replace(/\s+/g, " ").replace(/[·•]/g, "·").trim();

    const pTexts = el =>
        Array.from(el.querySelectorAll("p"))
            .map(p => clean(p.textContent))
            .filter(Boolean);

    const container = document.querySelector("main") || document.body;

    const entities = Array.from(
        container.querySelectorAll('[componentkey^="entity-collection-item"]')
    );

    return entities.map(entity => {

        const logoEl = entity.querySelector('[role="img"][aria-label$="logo"]');
        const logoCompany = logoEl
            ? logoEl.getAttribute("aria-label").replace(/\s*logo$/i, "").trim()
            : "";

        // Companies AND schools (universities/hospitals often use /school/)
        const companyLinks = Array.from(
            entity.querySelectorAll('a[href*="/company/"], a[href*="/school/"]')
        );
        const primaryHref = companyLinks.length
            ? companyLinks[0].getAttribute("href")
            : "";

        // Header text-link = first org link that carries <p> text.
        const headerLink = companyLinks.find(a => a.querySelector("p")) || null;
        const headerLines = headerLink ? pTexts(headerLink) : pTexts(entity);

        // Nested <li> => grouped company with several roles.
        const subRoles = Array.from(entity.querySelectorAll("li")).map(li => {
            const liLink = li.querySelector('a[href*="/company/"], a[href*="/school/"]');
            return {
                href: liLink ? liLink.getAttribute("href") : primaryHref,
                lines: pTexts(li)
            };
        });

        return { logoCompany, primaryHref, headerLines, subRoles };
    });
}

// ---------------------------------------------------------------------------
// Node-side classification helpers.
// ---------------------------------------------------------------------------
const EMPLOYMENT_TYPES =
    /^(full[\s-]?time|part[\s-]?time|self[\s-]?employed|freelance|contract|internship|apprenticeship|seasonal)$/i;

const EMPLOYMENT_CANON = {
    "full time": "Full-time",
    "full-time": "Full-time",
    "part time": "Part-time",
    "part-time": "Part-time",
    "self employed": "Self-employed",
    "self-employed": "Self-employed",
    freelance: "Freelance",
    contract: "Contract",
    internship: "Internship",
    apprenticeship: "Apprenticeship",
    seasonal: "Seasonal"
};

function splitMiddot(text) {
    return String(text || "")
        .split("·")
        .map(x => x.trim())
        .filter(Boolean);
}

/** Word-boundary "Present" — must NOT match "Presentation Skills". */
function isDateLine(s) {
    return /\bpresent\b/i.test(s) || /\b(19|20)\d{2}\b/.test(s);
}

function isSkillsLine(s) {
    return /^skills\s*:/i.test(String(s || "").trim());
}

/** Pull employment type from a line or "Full-time · 9 yrs 1 mo" header. */
function extractEmploymentType(text) {
    for (const part of splitMiddot(text)) {
        const key = part.trim().toLowerCase().replace(/\s+/g, " ");
        if (EMPLOYMENT_TYPES.test(key)) {
            return EMPLOYMENT_CANON[key] || EMPLOYMENT_CANON[key.replace(/\s+/g, "-")] || part.trim();
        }
    }
    return "";
}

function isLocationLine(s) {
    const trimmed = s.trim();

    // "Skills: Agile Methodologies, Spring Framework, +8 skills" — a real
    // observed case that otherwise matches the comma check below and gets
    // misread as a location. Any "Label: value" style metadata line is
    // never a location, so a colon anywhere rules it out.
    if (trimmed.includes(":")) return false;

    // Job-description sentences ("Gerente de Sistemas, Arquitectura.") end
    // with sentence-final punctuation — real locations never do.
    if (/[.!?]$/.test(trimmed)) return false;

    // A real "City, Region, Country" location is short. Long comma-
    // containing text is a description, a skills list, or a compound
    // legal company name — not a place. Longest verified real location
    // seen so far is ~35 chars; 60 leaves real headroom without letting
    // multi-clause sentences through (observed bad cases run 90-150+ chars).
    if (trimmed.length > 60) return false;

    return /,/.test(trimmed) || /\b(remote|hybrid|on-site|onsite)\b/i.test(trimmed);
}

// "Feb 2016 - Present · 10 yrs 7 mos" -> { startDate, endDate, duration }
function parseDateLine(dateLine) {
    const parts = splitMiddot(dateLine);
    const rangePart = parts[0] || "";
    const duration = parts[1] || "";

    let startDate = "";
    let endDate = "";

    if (rangePart) {
        const range = rangePart.split(/\s*[-–—]\s*/);
        startDate = (range[0] || "").trim();
        endDate = (range[1] || "").trim();
    }

    return { startDate, endDate, duration };
}

/** True for "Full-time" or group header "Full-time · 9 yrs 1 mo". */
function isEmploymentMetaLine(line) {
    const parts = splitMiddot(line);
    if (!parts.length) return false;
    if (!extractEmploymentType(parts[0])) return false;
    return parts.slice(1).every(p =>
        extractEmploymentType(p) ||
        /\b\d+\s*(yr|yrs|year|years|mo|mos|month|months)\b/i.test(p) ||
        /\b(remote|hybrid|on-site|onsite)\b/i.test(p)
    );
}

/**
 * Turn a title + a set of descriptor <p> lines into a normalised role.
 * `seedCompany` / `seedEmploymentType` come from a grouped company header.
 */
function classifyRole(title, lines, seedCompany, href, logoCompany, seedEmploymentType) {

    let company = seedCompany || "";
    let employmentType = seedEmploymentType || "";
    let dateLine = "";
    let location = "";

    for (const raw of lines) {
        const line = (raw || "").trim();
        if (!line) continue;

        // "Skills: Presentation Skills" — never a date/location/company.
        if (isSkillsLine(line)) continue;

        // "Company · Full-time" (single-role layout)
        if (!company && line.includes("·") && !isDateLine(line) && !isEmploymentMetaLine(line)) {
            const parts = splitMiddot(line);
            company = parts[0] || "";
            const et = extractEmploymentType(line);
            if (et) employmentType = et;
            continue;
        }

        // First real date line wins.
        if (isDateLine(line)) {
            if (!dateLine) dateLine = line;
            continue;
        }

        // Standalone "Full-time" or "Full-time · 9 yrs 1 mo"
        if (isEmploymentMetaLine(line)) {
            employmentType = employmentType || extractEmploymentType(line);
            continue;
        }

        // Leftover, no company yet -> treat as company name. Checked
        // BEFORE the location check below: verified DOM order always
        // puts company ahead of location for single-role entities, and a
        // company name can itself contain a comma (real observed case:
        // "MTI, Mozcalti", plus Mexican legal-entity names like
        // "SOCIEDAD DE ALTERNATIVAS ECONÓMICAS, S.A. DE C.V., S.F.P.")
        // — checking isLocationLine first would wrongly claim that comma
        // as a location before company ever got a chance at it.
        if (!company) {
            company = line;
            continue;
        }

        if (isLocationLine(line)) {
            location = location || line;
            continue;
        }

        // Anything else is discarded, NOT assumed to be location. This
        // used to be `location = location || line`, a blind catch-all
        // that silently stuffed any unrecognized line (a duplicated
        // title, a stray metadata snippet, whatever LinkedIn renders
        // that this parser hasn't seen yet) into the location field —
        // real observed failure mode: job titles/company names ending
        // up in Onsite Address. Only text that POSITIVELY looks like a
        // location (comma-separated place, or an explicit
        // remote/hybrid/on-site marker) is ever treated as one.
    }

    const { startDate, endDate, duration } = parseDateLine(dateLine);
    const isCurrent = /\bpresent\b/i.test(dateLine);

    // Defense in depth: even a positively-matched "location" (e.g. it
    // contained a comma) is rejected if it's actually just the title or
    // company restated — never let one field's value leak into another.
    const normalize = s => (s || "").trim().toLowerCase();
    if (location && (normalize(location) === normalize(title) || normalize(location) === normalize(company))) {
        location = "";
    }

    return {
        title: title || "",
        company: company || logoCompany || "",
        employmentType,
        startDate,
        endDate: endDate || (isCurrent ? "Present" : ""),
        duration,
        location,
        companyUrl: href ? href.split("?")[0].split("#")[0] : "",
        isCurrent
    };
}

function entityToRoles(entity) {

    const { logoCompany, primaryHref, headerLines, subRoles } = entity;

    // Grouped if any nested <li> actually looks like a role (has a date line).
    const realSubRoles = subRoles.filter(sr =>
        sr.lines.some(isDateLine)
    );

    if (realSubRoles.length > 0) {
        const groupCompany = headerLines[0] || logoCompany || "";
        // e.g. headerLines[1] === "Full-time · 9 yrs 1 mo"
        const groupEmployment =
            headerLines.slice(1).map(extractEmploymentType).find(Boolean) || "";
        return realSubRoles.map(sr => {
            const [title, ...rest] = sr.lines;
            return classifyRole(
                title,
                rest,
                groupCompany,
                sr.href,
                logoCompany,
                groupEmployment
            );
        });
    }

    // Single-role entity.
    const [title, ...rest] = headerLines;
    return [
        classifyRole(title, rest, "", primaryHref, logoCompany, "")
    ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function getExperience(page, profileUrl) {

    const url = buildExperienceUrl(profileUrl);

    await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    if (/\/(login|authwall|checkpoint)/.test(page.url())) {
        throw new Error("Redirected to login/authwall — session expired.");
    }

    await page
        .locator('main a[href*="/company/"], main a[href*="/school/"]')
        .first()
        .waitFor({ timeout: 12000 })
        .catch(() => {});

    await scroll.gentle(page);

    const entities = await page.evaluate(collectEntitiesInPage);
    const roles = entities.flatMap(entityToRoles);

    const current = roles.find(r => r.isCurrent) || roles[0] || null;

    // companyLinkedinUrl for output: canonical org page (/company/ or /school/)
    // companyAboutUrl for the About scraper (…/about/)
    const rawOrgUrl = current ? current.companyUrl : "";

    return {
        currentPosition: current ? current.title : "",
        currentCompany: current ? current.company : "",
        startDate: current ? current.startDate : "",
        endDate: current ? current.endDate : "",
        duration: current ? current.duration : "",
        employmentType: current ? current.employmentType : "",
        location: current ? current.location : "",
        companyLinkedinUrl: toCompanyLinkedinUrl(rawOrgUrl) || toCompanyAboutUrl(rawOrgUrl).replace(/\/about\/?$/, "/") || "",
        companyAboutUrl: toCompanyAboutUrl(rawOrgUrl),
        experiences: roles
    };
}

module.exports = {
    getExperience,
    _internals: {
        classifyRole,
        parseDateLine,
        entityToRoles,
        isDateLine,
        extractEmploymentType,
        isSkillsLine
    }
};
