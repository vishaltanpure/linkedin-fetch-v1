/**
 * Offline checks for experience date/employment classification.
 *   node scripts/test-experience-parse.js
 */
const assert = require("assert");
const { _internals } = require("../extractors/experience");
const { mapToRow } = require("../utils/schema-mapper");
const { splitPersonName } = require("../extractors/profile");

const {
    entityToRoles,
    isDateLine,
    extractEmploymentType
} = _internals;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}`);
        throw err;
    }
}

console.log("experience-parse tests\n");

test("isDateLine does not match Presentation Skills", () => {
    assert.strictEqual(isDateLine("Skills: Presentation Skills"), false);
    assert.strictEqual(isDateLine("Mar 2020 - Present · 6 yrs 7 mos"), true);
});

test("extractEmploymentType from group header", () => {
    assert.strictEqual(extractEmploymentType("Full-time · 9 yrs 1 mo"), "Full-time");
    assert.strictEqual(extractEmploymentType("Part-time"), "Part-time");
    assert.strictEqual(extractEmploymentType("Full time"), "Full-time");
});

test("Melinda-style grouped role keeps dates + contract type", () => {
    const roles = entityToRoles({
        logoCompany: "The University of Queensland",
        primaryHref: "https://www.linkedin.com/school/166664/",
        headerLines: [
            "The University of Queensland",
            "Full-time · 9 yrs 1 mo"
        ],
        subRoles: [
            {
                href: "https://www.linkedin.com/school/166664/",
                lines: [
                    "Regional Manager (India and Europe), Faculty of Engineering, Architecture and Information Technology",
                    "Mar 2020 - Present · 6 yrs 7 mos",
                    "Skills: Presentation Skills"
                ]
            }
        ]
    });

    assert.strictEqual(roles.length, 1);
    assert.strictEqual(roles[0].startDate, "Mar 2020");
    assert.strictEqual(roles[0].endDate, "Present");
    assert.strictEqual(roles[0].duration, "6 yrs 7 mos");
    assert.strictEqual(roles[0].employmentType, "Full-time");
    assert.strictEqual(roles[0].company, "The University of Queensland");
    assert.match(roles[0].title, /Regional Manager/);
});

test("Mark-style grouped role with per-role Full-time", () => {
    const roles = entityToRoles({
        logoCompany: "Whitsons Culinary Group",
        primaryHref: "https://www.linkedin.com/company/579228/",
        headerLines: ["Whitsons Culinary Group", "21 yrs 10 mos"],
        subRoles: [
            {
                href: "https://www.linkedin.com/company/579228/",
                lines: [
                    "Vice President of Customer Experience",
                    "Full-time",
                    "May 2026 - Present · 5 mos"
                ]
            }
        ]
    });
    assert.strictEqual(roles[0].employmentType, "Full-time");
    assert.strictEqual(roles[0].startDate, "May 2026");
    assert.strictEqual(roles[0].duration, "5 mos");
});

test("LOCATION maps full place string", () => {
    const row = mapToRow({
        location: "Bridgewater, New Jersey, United States"
    });
    assert.strictEqual(row.LOCATION, "Bridgewater, New Jersey, United States");
});

test("name with hyphen before credential", () => {
    assert.deepStrictEqual(splitPersonName("Mark Kirn - FMP"), {
        firstName: "Mark",
        lastName: "Kirn"
    });
});

console.log("\nAll experience-parse tests passed.");
