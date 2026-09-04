/**
 * Company "About" extractor.
 *
 * Reads firmographic fields from a company's /about/ page.
 * The companyLinkedinUrl is derived from the current experience entry
 * (reliable) rather than the profile Top Card (unreliable).
 *
 * LinkedIn layouts (verified Aug 2026):
 *   NEW (current): no <dt>/<dd>. Each field is a pair of sibling divs:
 *     <div><p>Website</p></div>
 *     <div><a><p>http://...</p></a></div>
 *   Labels and values often appear concatenated in innerText
 *   ("Websitehttp://...", "IndustryIT Services...") when read as a
 *   single text blob — never rely on that alone; walk <p> labels.
 *   OLD: classic <dt>/<dd> definition list (kept as fallback).
 *
 * Exact English-only `switch (key)` on dt/dd previously left
 * website/industry/employeeRange/companyType/HQ blank on the new UI
 * while associatedMembers still matched via regex — matching the
 * blank columns in recent client exports.
 */

function collectCompanyAboutInPage() {

    // Defined inside this function because page.evaluate() only ships
    // this function's own source into the browser — no outer Node scope.
    const clean = s => (s || "").replace(/\s+/g, " ").trim();

    const LABEL_MAP = [
        { field: "website", patterns: [/^(website|sitio web|site web|site internet)$/i] },
        { field: "industry", patterns: [/^(industry|sector|industria|branche)$/i] },
        { field: "employeeCount", patterns: [/^(company size|tamaño de la empresa|taille de l['’]entreprise|unternehmensgröße)$/i] },
        { field: "companyType", patterns: [/^(company type|tipo de empresa|type d['’]entreprise|unternehmenstyp)$/i] },
        { field: "headquarters", patterns: [/^(headquarters|sede|siège social|hauptsitz)$/i] },
        { field: "associatedMembers", patterns: [/^(associated members|miembros asociados|membres associés)$/i] }
    ];

    const matchField = label => {
        const text = clean(label);
        if (!text) return null;
        for (const { field, patterns } of LABEL_MAP) {
            if (patterns.some(p => p.test(text))) return field;
        }
        return null;
    };

    const data = {
        website: "",
        industry: "",
        employeeCount: "",
        companyType: "",
        headquarters: "",
        associatedMembers: ""
    };

    const assign = (field, value) => {
        if (!field || !value || data[field]) return;
        data[field] = value;
    };

    const valueFromBox = (box, field) => {
        if (!box) return "";
        if (field === "website") {
            const href = box.querySelector('a[href*="url="], a[href^="http"]')?.getAttribute("href") || "";
            // LinkedIn wraps external links in /safety/go/?url=<encoded>
            const go = href.match(/[?&]url=([^&]+)/);
            if (go) {
                try {
                    return decodeURIComponent(go[1]).split("?")[0];
                } catch {
                    /* fall through */
                }
            }
            if (/^https?:\/\//i.test(href) && !/linkedin\.com/i.test(href)) {
                return href.split("?")[0];
            }
        }
        return clean(box.textContent);
    };

    // ---- 1. NEW layout: <p>Label</p> in a div, value in the next sibling div ----
    for (const p of Array.from(document.querySelectorAll("main p"))) {
        const field = matchField(p.textContent);
        if (!field) continue;

        const labelBox = p.parentElement;
        const valueBox = labelBox?.nextElementSibling;
        // Sometimes the value is a later sibling inside the same row wrapper.
        let value = valueFromBox(valueBox, field);
        if (!value && labelBox?.parentElement) {
            const kids = Array.from(labelBox.parentElement.children);
            const idx = kids.indexOf(labelBox);
            if (idx >= 0 && kids[idx + 1]) {
                value = valueFromBox(kids[idx + 1], field);
            }
        }
        // Company size value should be just the range, not trailing
        // "N associated members" if both got concatenated.
        if (field === "employeeCount") {
            const sizeOnly = value.match(
                /[\d,]+\+?\s*[-–—]\s*[\d,]+\+?\s*employees?|[\d,]+\+?\s*employees?/i
            );
            if (sizeOnly) value = clean(sizeOnly[0]);
        }
        if (field === "associatedMembers") {
            const onlyDigits = value.match(/[\d,.]+/);
            value = onlyDigits ? onlyDigits[0].replace(/[^\d]/g, "") : "";
        }
        assign(field, value);
    }

    // ---- 2. OLD layout: proper dt -> adjacent dd pairing ----
    if (!data.website || !data.industry || !data.employeeCount) {
        for (const dt of Array.from(document.querySelectorAll("dt"))) {
            const field = matchField(dt.textContent);
            if (!field) continue;
            let dd = dt.nextElementSibling;
            while (dd && dd.tagName !== "DD") dd = dd.nextElementSibling;
            if (!dd) continue;
            assign(field, valueFromBox(dd, field));
        }
    }

    // ---- 3. Regex fallback on Overview text (label+value glued together) ----
    const mainText = clean(document.querySelector("main")?.innerText || "");

    if (!data.website) {
        const m = mainText.match(
            /(?:Website|Sitio web)\s*((?:https?:\/\/|www\.)[^\s]+)/i
        );
        if (m) assign("website", m[1].replace(/[.,;)]+$/, ""));
    }
    if (!data.industry) {
        const m = mainText.match(
            /(?:Industry|Sector|Industria)\s+(.+?)(?=\s+(?:Company size|Tamaño|Headquarters|Sede|Founded|Specialties|Website)|$)/i
        );
        if (m) assign("industry", clean(m[1]));
    }
    if (!data.employeeCount) {
        const m = mainText.match(
            /(?:Company size|Tamaño de la empresa)\s*([\d,]+\+?\s*[-–—]\s*[\d,]+\+?\s*employees?|[\d,]+\+?\s*employees?)/i
        );
        if (m) assign("employeeCount", clean(m[1]));
        if (!data.employeeCount) {
            const chip = mainText.match(
                /([\d,]+\+?\s*[-–—]\s*[\d,]+\+?|\d[\d,]*\+?)\s*employees?/i
            );
            if (chip) assign("employeeCount", clean(chip[0]));
        }
    }
    if (!data.headquarters) {
        const m = mainText.match(
            /(?:Headquarters|Sede|Siège social)\s+(.+?)(?=\s+(?:Founded|Specialties|Company type|Tipo|Verified)|$)/i
        );
        if (m) assign("headquarters", clean(m[1]));
    }
    if (!data.companyType) {
        const m = mainText.match(
            /(?:Company type|Tipo de empresa)\s+(.+?)(?=\s+(?:Founded|Specialties|Headquarters|Website)|$)/i
        );
        if (m) assign("companyType", clean(m[1]));
    }

    // Associated members — orphan line / nested under company size.
    if (!data.associatedMembers) {
        const match = mainText.match(
            /(?:^|\b)([\d.,]+)\s*(associated members|miembros asociados|membres associés)\b/i
        );
        if (match) {
            data.associatedMembers = match[1].replace(/[^\d]/g, "");
        }
    }

    return data;
}

async function getCompanyAbout(page, aboutUrl) {

    const empty = {
        website: "",
        industry: "",
        employeeCount: "",
        companyType: "",
        headquarters: "",
        associatedMembers: ""
    };

    if (!aboutUrl) return empty;

    await page.goto(aboutUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    if (/\/(login|authwall|checkpoint)/.test(page.url())) {
        return empty;
    }

    // Wait for About labels (new <p>Website</p> layout OR legacy dt).
    await page
        .locator("main p, dt, main h2")
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});

    await page.evaluate(() => window.scrollBy(0, 700)).catch(() => {});

    // Prefer waiting until a known About label is present.
    await page
        .getByText(/^(Website|Industry|Company size|Headquarters|Sitio web|Sector)$/i)
        .first()
        .waitFor({ timeout: 5000 })
        .catch(() => {});

    const data = await page.evaluate(collectCompanyAboutInPage).catch(() => empty);
    return data || empty;
}

module.exports = {
    getCompanyAbout
};
