/**
 * Build Sales Navigator Lead-search URLs from Excel/CLI filter columns.
 *
 * SN encodes filters in the `query=` param. Static ID maps cover the
 * screenshot filters (headcount, function, seniority, India, Retail…).
 * Job titles use text-only CURRENT_TITLE (no ID required).
 *
 * Prefer this over brittle sidebar clicking — LinkedIn's filter DOM changes often.
 */

const { parseFilterList } = require("./search-filters");

const SN_SEARCH_BASE = "https://www.linkedin.com/sales/search/people";

/** Company headcount letter codes used by Sales Navigator. */
const HEADCOUNT_MAP = {
    "self-employed": { id: "A", text: "Self-employed" },
    "self employed": { id: "A", text: "Self-employed" },
    "1-10": { id: "B", text: "1-10" },
    "2-10": { id: "B", text: "1-10" },
    "11-50": { id: "C", text: "11-50" },
    "51-200": { id: "D", text: "51-200" },
    "201-500": { id: "E", text: "201-500" },
    "501-1000": { id: "F", text: "501-1000" },
    "501-1,000": { id: "F", text: "501-1000" },
    "1001-5000": { id: "G", text: "1001-5000" },
    "1,001-5,000": { id: "G", text: "1001-5000" },
    "5001-10000": { id: "H", text: "5001-10000" },
    "5,001-10,000": { id: "H", text: "5001-10000" },
    "10001+": { id: "I", text: "10001+" },
    "10,001+": { id: "I", text: "10001+" }
};

/** Seniority level IDs. */
const SENIORITY_MAP = {
    unpaid: { id: "1", text: "Unpaid" },
    training: { id: "2", text: "Training" },
    "entry-level": { id: "3", text: "Entry level" },
    entry: { id: "3", text: "Entry level" },
    senior: { id: "4", text: "Senior" },
    manager: { id: "5", text: "Manager" },
    director: { id: "6", text: "Director" },
    vp: { id: "7", text: "VP" },
    "vice president": { id: "7", text: "VP" },
    cxo: { id: "8", text: "CXO" },
    "c-level": { id: "8", text: "CXO" },
    "c level": { id: "8", text: "CXO" },
    partner: { id: "9", text: "Partner" },
    owner: { id: "10", text: "Owner" }
};

/** Role function IDs. */
const FUNCTION_MAP = {
    accounting: { id: "1", text: "Accounting" },
    administrative: { id: "2", text: "Administrative" },
    "arts and design": { id: "3", text: "Arts and Design" },
    "business development": { id: "4", text: "Business Development" },
    consulting: { id: "6", text: "Consulting" },
    education: { id: "7", text: "Education" },
    engineering: { id: "8", text: "Engineering" },
    entrepreneurship: { id: "9", text: "Entrepreneurship" },
    finance: { id: "10", text: "Finance" },
    "human resources": { id: "12", text: "Human Resources" },
    hr: { id: "12", text: "Human Resources" },
    "information technology": { id: "13", text: "Information Technology" },
    it: { id: "13", text: "Information Technology" },
    legal: { id: "14", text: "Legal" },
    marketing: { id: "15", text: "Marketing" },
    operations: { id: "18", text: "Operations" },
    "product management": { id: "19", text: "Product Management" },
    product: { id: "19", text: "Product Management" },
    "project management": { id: "20", text: "Program and Project Management" },
    sales: { id: "25", text: "Sales" },
    "customer success": { id: "26", text: "Customer Success and Support" },
    support: { id: "26", text: "Customer Success and Support" }
};

/** Common geography REGION ids (LinkedIn geo). */
const GEOGRAPHY_MAP = {
    india: { id: "102713980", text: "India" },
    "united states": { id: "103644278", text: "United States" },
    usa: { id: "103644278", text: "United States" },
    us: { id: "103644278", text: "United States" },
    "united kingdom": { id: "101165590", text: "United Kingdom" },
    uk: { id: "101165590", text: "United Kingdom" },
    canada: { id: "101174742", text: "Canada" },
    australia: { id: "101452733", text: "Australia" },
    germany: { id: "101282230", text: "Germany" },
    france: { id: "105015875", text: "France" },
    singapore: { id: "102454443", text: "Singapore" },
    "united arab emirates": { id: "104305776", text: "United Arab Emirates" },
    uae: { id: "104305776", text: "United Arab Emirates" },
    "san francisco": { id: "102277331", text: "San Francisco Bay Area" },
    "san francisco bay area": { id: "102277331", text: "San Francisco Bay Area" },
    "new york": { id: "105080838", text: "New York City Metropolitan Area" },
    "new york city": { id: "105080838", text: "New York City Metropolitan Area" },
    london: { id: "90009496", text: "London Area, United Kingdom" },
    mumbai: { id: "106164952", text: "Mumbai Metropolitan Region" },
    "mumbai metropolitan region": { id: "106164952", text: "Mumbai Metropolitan Region" },
    bangalore: { id: "105214831", text: "Bengaluru" },
    bengaluru: { id: "105214831", text: "Bengaluru" },
    delhi: { id: "115918471", text: "Delhi, India" },
    "new delhi": { id: "115918471", text: "Delhi, India" }
};

/** Common INDUSTRY ids. */
const INDUSTRY_MAP = {
    retail: { id: "27", text: "Retail" },
    software: { id: "4", text: "Software Development" },
    "computer software": { id: "4", text: "Software Development" },
    "software development": { id: "4", text: "Software Development" },
    "information technology and services": { id: "96", text: "IT Services and IT Consulting" },
    "it services": { id: "96", text: "IT Services and IT Consulting" },
    "financial services": { id: "43", text: "Financial Services" },
    banking: { id: "41", text: "Banking" },
    "hospital & health care": { id: "14", text: "Hospitals and Health Care" },
    healthcare: { id: "14", text: "Hospitals and Health Care" },
    marketing: { id: "80", text: "Advertising Services" },
    advertising: { id: "80", text: "Advertising Services" },
    "real estate": { id: "44", text: "Real Estate" },
    education: { id: "69", text: "Education" },
    manufacturing: { id: "25", text: "Manufacturing" },
    telecommunications: { id: "8", text: "Telecommunications" },
    "internet": { id: "6", text: "Technology, Information and Internet" },
    technology: { id: "6", text: "Technology, Information and Internet" }
};

function normKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, " ");
}

function lookup(map, raw) {
    const key = normKey(raw);
    if (map[key]) return map[key];
    // allow "51 - 200"
    const compact = key.replace(/\s+/g, "");
    for (const [k, v] of Object.entries(map)) {
        if (k.replace(/\s+/g, "") === compact) return v;
    }
    return null;
}

function encodeText(text) {
    // SN double-encodes spaces/special chars inside the query blob
    return encodeURIComponent(String(text)).replace(/%/g, "%25");
}

function filterValueWithId(id, text) {
    return `(id:${id},text:${encodeText(text)},selectionType:INCLUDED)`;
}

function filterValueTextOnly(text) {
    return `(text:${encodeText(text)},selectionType:INCLUDED)`;
}

function wrapFilter(type, valuesInner) {
    return `(type:${type},values:List(${valuesInner}))`;
}

/**
 * @returns {{ url: string|null, applied: string[], failed: string[], unsupported: string[] }}
 */
function buildSalesNavigatorUrl(criteria) {
    const applied = [];
    const failed = [];
    const unsupported = [];
    const filterParts = [];

    // ---- COMPANY_HEADCOUNT ----
    const headcounts = parseFilterList(criteria.companyHeadcount);
    if (headcounts.length) {
        const vals = [];
        for (const h of headcounts) {
            const hit = lookup(HEADCOUNT_MAP, h);
            if (hit) {
                vals.push(filterValueWithId(hit.id, hit.text));
                applied.push(`Company headcount: ${hit.text}`);
            } else {
                failed.push(`companyHeadcount=${h}`);
            }
        }
        if (vals.length) filterParts.push(wrapFilter("COMPANY_HEADCOUNT", vals.join(",")));
    }

    // ---- FUNCTION ----
    const functions = parseFilterList(criteria.function);
    if (functions.length) {
        const vals = [];
        for (const f of functions) {
            const hit = lookup(FUNCTION_MAP, f);
            if (hit) {
                vals.push(filterValueWithId(hit.id, hit.text));
                applied.push(`Function: ${hit.text}`);
            } else {
                failed.push(`function=${f}`);
            }
        }
        if (vals.length) filterParts.push(wrapFilter("FUNCTION", vals.join(",")));
    }

    // ---- CURRENT_TITLE (text only) ----
    const titles = parseFilterList(criteria.jobTitle);
    if (titles.length) {
        const vals = titles.map(t => {
            applied.push(`Current job title: ${t}`);
            return filterValueTextOnly(t);
        });
        filterParts.push(wrapFilter("CURRENT_TITLE", vals.join(",")));
    }

    // ---- SENIORITY_LEVEL ----
    const seniorities = parseFilterList(criteria.seniority);
    if (seniorities.length) {
        const vals = [];
        for (const s of seniorities) {
            const hit = lookup(SENIORITY_MAP, s);
            if (hit) {
                vals.push(filterValueWithId(hit.id, hit.text));
                applied.push(`Seniority level: ${hit.text}`);
            } else {
                failed.push(`seniority=${s}`);
            }
        }
        if (vals.length) filterParts.push(wrapFilter("SENIORITY_LEVEL", vals.join(",")));
    }

    // ---- REGION / geography ----
    const geos = parseFilterList(criteria.geography);
    if (geos.length) {
        const vals = [];
        for (const g of geos) {
            const hit = lookup(GEOGRAPHY_MAP, g);
            if (hit) {
                vals.push(filterValueWithId(hit.id, hit.text));
                applied.push(`Geography: ${hit.text}`);
            } else {
                unsupported.push(`geography=${g}`);
                failed.push(`geography=${g}`);
            }
        }
        if (vals.length) filterParts.push(wrapFilter("REGION", vals.join(",")));
    }

    // ---- INDUSTRY ----
    const industries = parseFilterList(criteria.industry);
    if (industries.length) {
        const vals = [];
        for (const ind of industries) {
            const hit = lookup(INDUSTRY_MAP, ind);
            if (hit) {
                vals.push(filterValueWithId(hit.id, hit.text));
                applied.push(`Industry: ${hit.text}`);
            } else {
                unsupported.push(`industry=${ind}`);
                failed.push(`industry=${ind}`);
            }
        }
        if (vals.length) filterParts.push(wrapFilter("INDUSTRY", vals.join(",")));
    }

    if (!filterParts.length && !criteria.keywords) {
        return { url: null, applied, failed, unsupported };
    }

    let queryInner = `spellCorrectionEnabled:true,filters:List(${filterParts.join(",")})`;
    if (criteria.keywords) {
        queryInner = `spellCorrectionEnabled:true,keywords:List(${encodeText(criteria.keywords)}),filters:List(${filterParts.join(",")})`;
        applied.push(`keywords: ${criteria.keywords}`);
    }

    const url = `${SN_SEARCH_BASE}?query=(${queryInner})`;
    return { url, applied, failed, unsupported };
}

module.exports = {
    SN_SEARCH_BASE,
    HEADCOUNT_MAP,
    SENIORITY_MAP,
    FUNCTION_MAP,
    GEOGRAPHY_MAP,
    INDUSTRY_MAP,
    buildSalesNavigatorUrl,
    lookup,
    normKey
};
