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
    // The middle token is a MIDDLE NAME, not part of the surname. A vanity
    // slug cannot tell the two apart — it carries every token either way — so
    // the slug-adjacency merge that used to return "Avent Jay" here also
    // returned "Singh Rai" / "Kumar Sharma" for ordinary three-part names.
    // Last token wins; particle-linked compounds are still joined (below).
    assert.deepStrictEqual(
        splitPersonName("Lindsay Avent Jay", "lindsay-avent-jay-a6410a74"),
        { firstName: "Lindsay", lastName: "Jay" }
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
    // Same name WITH a slug — the slug must not turn "Singh" into a surname.
    assert.deepStrictEqual(splitPersonName("Anita Singh Rai", "anita-singh-rai-9b21"), {
        firstName: "Anita",
        lastName: "Rai"
    });
    assert.deepStrictEqual(
        splitPersonName("Rajesh Kumar Sharma", "rajesh-kumar-sharma-4471"),
        { firstName: "Rajesh", lastName: "Sharma" }
    );
    assert.deepStrictEqual(splitPersonName("Abdulmajeed Al-Shehri", "abdulmajeed-al-shehri"), {
        firstName: "Abdulmajeed",
        lastName: "Al-Shehri"
    });
    assert.deepStrictEqual(splitPersonName("Maria de la Cruz", "maria-de-la-cruz-88"), {
        firstName: "Maria",
        lastName: "de la Cruz"
    });
    assert.deepStrictEqual(splitPersonName("P. St. John, MBA"), {
        firstName: "P.",
        lastName: "St. John"
    });
});

// Regression cases taken verbatim from the client's "error profiles" sheet
// (run of 2026-09-04), where FIRST_NAME / LAST_NAME were highlighted as wrong.
test("leading initial is not the first name", () => {
    const cases = [
        ["E. Brooke Moore, CPA", "e-brooke-moore-cpa-44819a35", "Brooke", "Moore"],
        ["F. Patrick Bustamante", "fpatrickbustamante", "Patrick", "Bustamante"],
        ["J. Timothy Gorman", "j-timothy-gorman-9bb26126", "Timothy", "Gorman"],
        ["J. Scott Wirtz", "j-scott-wirtz-94120378", "Scott", "Wirtz"],
        ["S. Kent Welch", "skentwelch", "Kent", "Welch"],
        ["W. Tyler Neely", "w-tyler-neely-682b50a2", "Tyler", "Neely"],
        ["M. Jorge Cardoso", "mjorgecardoso", "Jorge", "Cardoso"],
        ["A. Leonardo Iniguez", "a-leonardo-iniguez-43400433", "Leonardo", "Iniguez"],
        ["P. McKay Marschalk Jr., CFA", "p-mckay-marschalk-jr-cfa-90255887", "McKay", "Marschalk"],
        ["M. Adrianne J.", "m-adrianne-j-b7353986", "Adrianne", "J."]
    ];
    for (const [name, slug, firstName, lastName] of cases) {
        assert.deepStrictEqual(splitPersonName(name, slug), { firstName, lastName }, name);
    }
    // Two-token names keep the initial — there is no other given name there.
    assert.deepStrictEqual(splitPersonName("J. Smith", "j-smith-1234"), {
        firstName: "J.",
        lastName: "Smith"
    });
});

test("honorifics never become the first name", () => {
    assert.deepStrictEqual(
        splitPersonName("Dr . Thomas Kupferschmidt", "dr-thomas-kupferschmidt-bb77268"),
        { firstName: "Thomas", lastName: "Kupferschmidt" }
    );
    assert.deepStrictEqual(
        splitPersonName("Dr. Ing. Olaf Zoellner", "dr-ing-olaf-zoellner-666a3411a"),
        { firstName: "Olaf", lastName: "Zoellner" }
    );
    assert.deepStrictEqual(splitPersonName("Dr.-Ing. Matthias Vodel", "mvodel"), {
        firstName: "Matthias",
        lastName: "Vodel"
    });
    assert.deepStrictEqual(splitPersonName("Dipl.-Ing. Hans Meyer", "hans-meyer"), {
        firstName: "Hans",
        lastName: "Meyer"
    });
    // "Ing"/"Ingrid" must not be confused — the regex is anchored.
    assert.deepStrictEqual(splitPersonName("Ingrid Svensson", "ingrid-svensson"), {
        firstName: "Ingrid",
        lastName: "Svensson"
    });
});

test("credentials never become the last name", () => {
    const cases = [
        ["Becky Reed, CDMP, PCM", "becky-reed-cdmp-pcm-8b1626b", "Becky", "Reed"],
        ["Beth Barnett, MBA-Actg", "beth-barnett-mba-actg-3a669b44", "Beth", "Barnett"],
        ["Falguni Amin, ACA", "falguniamin", "Falguni", "Amin"],
        ["Guilherme Almeida, AIA, NCARB", "guiamalmeida", "Guilherme", "Almeida"],
        ["Karen Parker, AIC", "karen-parker-aic-932ba4115", "Karen", "Parker"],
        ["Kay McLaurin, CPSM", "kaymclaurin", "Kay", "McLaurin"],
        ["Kendra Cannon, M.M.", "kendra-cannon-m-m-96a2a92a", "Kendra", "Cannon"],
        ["Melissa Leach, DNP, RN", "melissa-leach-dnp-rn-3a556632", "Melissa", "Leach"],
        ["Sean Hamba, GCPM", "shamba", "Sean", "Hamba"],
        ["Pothys Vignesh Velladurai, M.Eng", "pothys-vignesh-velladurai-m-eng-3b4048106", "Pothys", "Velladurai"],
        ["Dave Miller, CDS", "dave-miller-cds-77501b33", "Dave", "Miller"],
        ["Daryl Dunlop, COHS, CHRM.", "daryl-dunlop-cohs-chrm-6161b6114", "Daryl", "Dunlop"],
        ["Greg Thompson, Wharton GMP", "greg-thompson-wharton-gmp-2a1b52", "Greg", "Thompson"],
        ["Maviea Ellis, ARRT", "maviea", "Maviea", "Ellis"],
        ["Kaled Aljebur, CP", "kaled-aljebur", "Kaled", "Aljebur"],
        ["Lori Dassa Sponte, HRM", "loridassasponte", "Lori", "Sponte"]
    ];
    for (const [name, slug, firstName, lastName] of cases) {
        assert.deepStrictEqual(splitPersonName(name, slug), { firstName, lastName }, name);
    }
});

test("an unknown ALL-CAPS token is still treated as a surname", () => {
    // The protection the credential rules must not break: caps surnames.
    assert.deepStrictEqual(splitPersonName("Chi Chung HAU", "chi-chung-hau"), {
        firstName: "Chi Chung",
        lastName: "HAU"
    });
    assert.deepStrictEqual(splitPersonName("Sarah LEE", "sarah-lee-771"), {
        firstName: "Sarah",
        lastName: "LEE"
    });
    // Mixed-case words are names, never credentials.
    assert.deepStrictEqual(splitPersonName("Robert Aca", "robert-aca-99"), {
        firstName: "Robert",
        lastName: "Aca"
    });
});

test("trailing junk and trailing initials", () => {
    assert.deepStrictEqual(splitPersonName("Peter Linden 09", "peter-linden-09-37429b17"), {
        firstName: "Peter",
        lastName: "Linden"
    });
    assert.deepStrictEqual(
        splitPersonName("Daniel Palacios (Aerospace networker)", "daniel-palacios-regional-recruiting-mgr"),
        { firstName: "Daniel", lastName: "Palacios" }
    );
    // Slug confirms the real surname sits in front of the trailing initial.
    assert.deepStrictEqual(
        splitPersonName("Chandana Basaveni B.", "chandanabasaveni"),
        { firstName: "Chandana", lastName: "Basaveni" }
    );
    assert.deepStrictEqual(
        splitPersonName("Jotham Ndugga-Kabuye I", "jothamnduggakabuye"),
        { firstName: "Jotham", lastName: "Ndugga-Kabuye" }
    );
    // No corroboration available: LinkedIn genuinely shows only an initial,
    // so we report it rather than inventing a surname.
    assert.deepStrictEqual(splitPersonName("Tracey S.", "tracey-s-93523715"), {
        firstName: "Tracey",
        lastName: "S."
    });
    assert.deepStrictEqual(splitPersonName("James W. K.", "james-w-k-0a0b9651"), {
        firstName: "James",
        lastName: "K."
    });
});

test("rejects pronoun badges as headline (EN + DE)", () => {
    assert.strictEqual(validateHeadline("she/her", "test"), "");
    assert.strictEqual(validateHeadline("He/Him", "test"), "");
    assert.strictEqual(validateHeadline("sie/ihr", "test"), "");
    assert.strictEqual(validateHeadline("Sie/Ihr", "test"), "");
    assert.strictEqual(validateHeadline("er/ihm", "test"), "");
    assert.ok(
        validateHeadline("Product Manager | SaaS", "test").includes("Product Manager")
    );
    assert.strictEqual(
        pickHeadlineFromCandidates([
            "sie/ihr",
            "Healthcare Professional",
            "Company · School",
            "Berlin, Germany"
        ]),
        "Healthcare Professional"
    );
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
