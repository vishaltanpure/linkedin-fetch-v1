/**
 * Offline checks for profile name split + company/school URL helpers.
 *   node scripts/test-profile-parse.js
 */
const assert = require("assert");
const { splitPersonName, pickHeadlineFromCandidates } = require("../extractors/profile");
const {
    toCompanyAboutUrl,
    toCompanyLinkedinUrl
} = require("../utils/linkedin-url");
const { validateHeadline } = require("../utils/validators");

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}`);
        throw err;
    }
}

console.log("profile-parse tests\n");

test("strips titles, commas, degrees, middle initials", () => {
    assert.deepStrictEqual(splitPersonName("Dr., Hitesh R. Bhatt, MBA"), {
        firstName: "Hitesh",
        lastName: "Bhatt"
    });
    assert.deepStrictEqual(splitPersonName("Rex,"), {
        firstName: "Rex",
        lastName: ""
    });
    assert.deepStrictEqual(splitPersonName("Carter,"), {
        firstName: "Carter",
        lastName: ""
    });
    assert.deepStrictEqual(splitPersonName("John M. Smith MSA"), {
        firstName: "John",
        lastName: "Smith"
    });
    assert.deepStrictEqual(splitPersonName("Mark Kirn FMP"), {
        firstName: "Mark",
        lastName: "Kirn"
    });
    assert.deepStrictEqual(splitPersonName("Chi Chung HAU"), {
        firstName: "Chi Chung",
        lastName: "HAU"
    });
    assert.deepStrictEqual(splitPersonName("Mark Kirn - FMP"), {
        firstName: "Mark",
        lastName: "Kirn"
    });
    assert.deepStrictEqual(
        splitPersonName("Courtenay Powell - Fractional Revenue and Retention Architect"),
        { firstName: "Courtenay", lastName: "Powell" }
    );
    assert.deepStrictEqual(splitPersonName("FADI CPIng"), {
        firstName: "FADI",
        lastName: ""
    });
    assert.deepStrictEqual(splitPersonName("Eng. Abdulmajeed Alshehri"), {
        firstName: "Abdulmajeed",
        lastName: "Alshehri"
    });
    assert.deepStrictEqual(splitPersonName("Engg Abdulmajeed Alshehri"), {
        firstName: "Abdulmajeed",
        lastName: "Alshehri"
    });
    assert.deepStrictEqual(splitPersonName("Eng Abdulmajeed Al-Shehri"), {
        firstName: "Abdulmajeed",
        lastName: "Al-Shehri"
    });
    assert.deepStrictEqual(splitPersonName("Engg. Abdulmajeed Alshehri"), {
        firstName: "Abdulmajeed",
        lastName: "Alshehri"
    });
    assert.deepStrictEqual(splitPersonName("Engg.Abdulmajeed Alshehri"), {
        firstName: "Abdulmajeed",
        lastName: "Alshehri"
    });
    assert.deepStrictEqual(
        splitPersonName("Lindsay Avent Jay", "lindsay-avent-jay-a6410a74"),
        { firstName: "Lindsay", lastName: "Avent Jay" }
    );
});

test("keeps compound surnames, drops middle names", () => {
    assert.deepStrictEqual(splitPersonName("Christopher St. John"), {
        firstName: "Christopher",
        lastName: "St. John"
    });
    assert.deepStrictEqual(splitPersonName("Anita Singh Rai"), {
        firstName: "Anita",
        lastName: "Rai"
    });
    assert.deepStrictEqual(splitPersonName("P. St. John, MBA"), {
        firstName: "P.",
        lastName: "St. John"
    });
});

test("rejects UI fragment headlines", () => {
    assert.strictEqual(validateHeadline("This is a mo", "test"), "");
    assert.ok(
        validateHeadline(
            "Chief Financial Officer | Finance Transformation Leader | GRC & AI Strategist",
            "test"
        ).includes("Chief Financial Officer")
    );
});

test("rejects About prose; keeps pipe keyword headline", () => {
    const about =
        "A highly effective head of technical sales leader, building and coaching teams to exceed business goals and targets. Expert understanding of devices, connectivity, Software as a Service (SaaS), x86 hardware edge, Open RAN and Solution Architect Associate (SAA C02) certified by AWS. Drives powerful strategies.… more";
    assert.strictEqual(validateHeadline(about, "test"), "");
    const expected =
        "AI GPU leader | Revenue Growth | GSI | Enterprise | API | Open RAN | Cloud | Build high performing team";
    assert.strictEqual(validateHeadline(expected, "test"), expected);
});

test("rejects connections/followers UI as headline", () => {
    assert.strictEqual(validateHeadline("connections", "test"), "");
    assert.strictEqual(validateHeadline("500+ connections", "test"), "");
    const real =
        "Helping Luxury Membership Businesses Unlock Hidden Lifetime Value in Their Member Base | Creator of The Member Revenue Architecture System™";
    assert.ok(validateHeadline(real, "test").includes("Luxury Membership"));
});

test("Lena-style profession headline is not treated as location", () => {
    const headline = pickHeadlineFromCandidates([
        "· 3rd",
        "Quantitative Economist",
        "Swiss Life Deutschland · LMU Munich",
        "Munich, Bavaria, Germany",
        "Contact info",
        "500+ connections",
        "Data Scientist Technical Accounting"
    ]);
    assert.strictEqual(headline, "Quantitative Economist");
});

test("structural first usable line wins for short/custom headlines", () => {
    assert.strictEqual(
        pickHeadlineFromCandidates([
            "Advisor",
            "Acme Corp · Harvard",
            "Boston, Massachusetts, United States"
        ]),
        "Advisor"
    );
    assert.strictEqual(
        pickHeadlineFromCandidates([
            "Helping teams ship faster",
            "Stripe · Stanford University",
            "San Francisco, California, United States"
        ]),
        "Helping teams ship faster"
    );
    assert.strictEqual(
        pickHeadlineFromCandidates([
            "AI GPU leader | Revenue Growth | GSI | Enterprise",
            "Supermicro · Cambridge Judge Business School",
            "London Area, United Kingdom"
        ]),
        "AI GPU leader | Revenue Growth | GSI | Enterprise"
    );
    // Country-only line must not win over a real headline after it
    assert.strictEqual(
        pickHeadlineFromCandidates([
            "Germany",
            "Quantitative Economist",
            "Munich, Bavaria, Germany"
        ]),
        "Quantitative Economist"
    );
    // Common LinkedIn "Title at Company" headline must not be skipped
    assert.strictEqual(
        pickHeadlineFromCandidates([
            "Ambulatory Operations Director at University of Mississippi Medical Center",
            "University of Mississippi Medical Center · University of Mississippi",
            "Jackson, Mississippi, United States"
        ]),
        "Ambulatory Operations Director at University of Mississippi Medical Center"
    );
    // Headline may itself contain a middot (title · specialty)
    assert.strictEqual(
        pickHeadlineFromCandidates([
            "Sales Manager · Electronics Distribution",
            "ACE Electronics, Inc. · Something School",
            "Miami, Florida, United States"
        ]),
        "Sales Manager · Electronics Distribution"
    );
    // Comma in headline must not be treated as a location (Lindsay Avent Jay)
    assert.strictEqual(
        pickHeadlineFromCandidates([
            "Director Clinical Operations, UMMC Department of Psychiatry and Human Behavior",
            "University of Mississippi Medical Center · Mississippi State University",
            "Brandon, Mississippi, United States"
        ]),
        "Director Clinical Operations, UMMC Department of Psychiatry and Human Behavior"
    );
});

test("rejects company · education as headline", () => {
    assert.strictEqual(
        validateHeadline(
            "University of Mississippi Medical Center · Mississippi State University",
            "test"
        ),
        ""
    );
    assert.strictEqual(
        validateHeadline(
            "Director Clinical Operations, UMMC Department of Psychiatry and Human Behavior",
            "test"
        ),
        "Director Clinical Operations, UMMC Department of Psychiatry and Human Behavior"
    );
});

test("does not reject headline when mis-parsed companyName looks like a job title", () => {
    assert.strictEqual(
        validateHeadline(
            "Ambulatory Operations Director at University of Mississippi Medical Center",
            "test",
            "Ambulatory Operations Director",
            "Jackson, Mississippi, United States"
        ),
        "Ambulatory Operations Director at University of Mississippi Medical Center"
    );
});

test("school and company org URLs", () => {
    assert.strictEqual(
        toCompanyAboutUrl("https://www.linkedin.com/school/university-of-mississippi-medical-center/"),
        "https://www.linkedin.com/school/university-of-mississippi-medical-center/about/"
    );
    assert.strictEqual(
        toCompanyLinkedinUrl("https://www.linkedin.com/school/university-of-mississippi-medical-center/?trk=x"),
        "https://www.linkedin.com/school/university-of-mississippi-medical-center/"
    );
    assert.strictEqual(
        toCompanyLinkedinUrl("/company/acme-corp/"),
        "https://www.linkedin.com/company/acme-corp/"
    );
    assert.strictEqual(toCompanyAboutUrl("https://linkedin.com/in/someone"), "");
});

console.log("\nAll profile-parse tests passed.");
