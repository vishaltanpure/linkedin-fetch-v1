/**
 * Maps scrapeProfile() records to the client output template.
 *
 * New column (output header) ← Old column / instruction
 *   Linkedin Contact              ← originalQuery/query (input URL)
 *   Linkedin Public Profile URL   ← Original LinkedIn URL (resolved)
 *   Linkedin Company              ← currentPosition/companyLinkedinUrl
 *   LEFT_THE_COMPANY              ← (blank)
 *   FIRST_NAME                    ← firstName
 *   LAST_NAME                     ← lastName
 *   HEADLINE                      ← headline
 *   DESIGNATION                   ← currentPosition (job title)
 *   COMPANY                       ← currentcompanyName
 *   LOCATION                      ← full profile location (city, region, country)
 *   INDUSTRY                      ← currentPositioncompany/industries
 *   WEBSITE                       ← currentPosition/companyUrl
 *   SIZE                          ← employeeRange
 *   Associated_members            ← associateMember
 *   Company Type                  ← (blank)
 *   Disposition                   ← (blank)
 *   Date                          ← today's date
 *   Experience Start              ← currentpositionstartdate
 *   Experience End                ← currentPositionstatus
 *   Total Experience              ← currentPositionduration
 *   Domain Valid                  ← (blank)
 *   Invalid Reason                ← (blank)
 *   onsite_address                ← Onsite Address
 *   followers                     ← followers count
 *   recent_activity               ← Activity
 *   open_to_work                  ← openToWork
 *   contract_type                 ← contractType
 *   Remark_kw                     ← Disease Keyword
 *   remark                        ← 'OK'
 */

const ORIGINAL_URL_COLUMN = "Linkedin Public Profile URL";

const OUTPUT_COLUMNS = [
    "Linkedin Contact",
    "Linkedin Public Profile URL",
    "Linkedin Company",
    "LEFT_THE_COMPANY",
    "FIRST_NAME",
    "LAST_NAME",
    "HEADLINE",
    "DESIGNATION",
    "COMPANY",
    "LOCATION",
    "INDUSTRY",
    "WEBSITE",
    "SIZE",
    "Associated_members",
    "Company Type",
    "Disposition",
    "Date",
    "Experience Start",
    "Experience End",
    "Total Experience",
    "Domain Valid",
    "Invalid Reason",
    "onsite_address",
    "followers",
    "recent_activity",
    "open_to_work",
    "contract_type",
    "Remark_kw",
    "remark"
];

function deriveCountry(location) {
    if (!location) return "";
    const parts = String(location)
        .split(",")
        .map(p => p.trim())
        .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
}

function todayDate() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/** Keep Linkedin Contact as a plain URL string (never "[object Object]"). */
function asUrlString(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") {
        const s = value.trim();
        return s === "[object Object]" ? "" : s;
    }
    if (typeof value === "object") {
        const link = value.hyperlink != null ? String(value.hyperlink).trim() : "";
        const text = value.text != null ? String(value.text).trim() : "";
        if (/linkedin\.com/i.test(link)) return link;
        if (/linkedin\.com/i.test(text)) return text;
        return link || text || "";
    }
    const s = String(value).trim();
    return s === "[object Object]" ? "" : s;
}

/**
 * @param {object} record — scrapeProfile() result
 * @param {string} [inputUrl] — originalQuery/query (raw input URL)
 */
function mapToRow(record, inputUrl) {
    const contact = asUrlString(inputUrl) || asUrlString(record.profileUrl);
    const resolved =
        asUrlString(record.resolvedProfileUrl) ||
        asUrlString(record.profileUrl) ||
        contact;

    return {
        "Linkedin Contact": contact,
        "Linkedin Public Profile URL": resolved,
        "Linkedin Company": record.companyLinkedinUrl || "",
        "LEFT_THE_COMPANY": "",
        "FIRST_NAME": record.firstName || "",
        "LAST_NAME": record.lastName || "",
        "HEADLINE": record.headline || "",
        // Job title (old column: currentPosition). Mapping sheet also lists
        // currentPositionduration for Total Experience separately.
        "DESIGNATION": record.currentPosition || "",
        "COMPANY": record.currentCompany || "",
        "LOCATION": record.location || "",
        "INDUSTRY": record.industry || "",
        "WEBSITE": record.website || "",
        "SIZE": record.employeeCount || "",
        "Associated_members": record.associatedMembers
            ? Number(record.associatedMembers)
            : "",
        "Company Type": "",
        "Disposition": "",
        "Date": todayDate(),
        "Experience Start": record.startDate || "",
        "Experience End": record.endDate || "",
        "Total Experience": record.duration || "",
        "Domain Valid": "",
        "Invalid Reason": "",
        "onsite_address": record.jobLocation || "",
        "followers": record.followers || record.connections || "",
        "recent_activity": record.activitySummary || "",
        "open_to_work": record.openToWork ? "true" : "false",
        "contract_type": record.employmentType || "",
        "Remark_kw": record.diseaseKeywords || "",
        "remark": "OK"
    };
}

function blankMappedRow(url) {
    const blank = {};
    for (const col of OUTPUT_COLUMNS) blank[col] = "";
    const contact = asUrlString(url);
    blank["Linkedin Contact"] = contact;
    blank["Linkedin Public Profile URL"] = contact;
    blank["Date"] = todayDate();
    blank["open_to_work"] = "false";
    blank["remark"] = "OK";
    return blank;
}

module.exports = {
    OUTPUT_COLUMNS,
    ORIGINAL_URL_COLUMN,
    mapToRow,
    blankMappedRow,
    deriveCountry,
    todayDate
};
