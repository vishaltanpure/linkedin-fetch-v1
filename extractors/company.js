/**
 * Company "About" extractor.
 *
 * Reads the definition list (dt/dd pairs) on a company's /about/ page.
 * The companyLinkedinUrl is derived from the current experience entry
 * (reliable) rather than the profile Top Card (unreliable).
 */

async function getCompanyAbout(page, aboutUrl) {

    const data = {
        website: "",
        industry: "",
        employeeCount: "",
        companyType: "",
        headquarters: "",
        associatedMembers: ""
    };

    if (!aboutUrl) return data;

    await page.goto(aboutUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    if (/\/(login|authwall|checkpoint)/.test(page.url())) {
        return data;
    }

    await page
        .locator("dt")
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});

    const items = await page
        .$$eval("dt, dd", nodes =>
            nodes.map(n => n.innerText.replace(/\s+/g, " ").trim())
        );

    for (let i = 0; i < items.length; i++) {
        const key = items[i];
        const value = items[i + 1];
        if (!value) continue;

        switch (key) {
            case "Website":
                data.website = value;
                break;
            case "Industry":
                data.industry = value;
                break;
            case "Company size":
                data.employeeCount = value;
                break;
            case "Company type":
                data.companyType = value;
                break;
            case "Headquarters":
                data.headquarters = value;
                break;
        }
    }

    // "23,082 associated members LinkedIn members who've listed X as..."
    // is NOT a clean dt/dd label pair (no preceding "Associated members"
    // dt) — it's an orphan line, so it's matched by pattern instead.
    const associatedLine = items.find(item => /associated members/i.test(item));
    if (associatedLine) {
        const match = associatedLine.match(/([\d,]+)\s+associated members/i);
        if (match) {
            data.associatedMembers = match[1].replace(/,/g, "");
        }
    }

    return data;
}

module.exports = {
    getCompanyAbout
};
