/**
 * LinkedIn profile scraper — production entry point.
 *
 * Flow (each step uses a deterministic page, never the lazy profile DOM
 * for Experience):
 *   1. Profile page          -> name, headline, about, location,
 *                               followers, education, openToWork
 *   2. /details/experience/  -> current position, company, dates,
 *                               employment type, company URL
 *   3. /company/<id>/about/  -> website, industry, employee count,
 *                               headquarters, associated members
 *   4. /recent-activity/all/ -> most recent post's reaction type and
 *                               "posted ago" text, plus recent activity
 *                               text used for keyword scanning
 *
 * URL resolution: LinkedIn accepts both vanity-slug profile URLs
 * (/in/jonathangkennedy) and opaque encoded-ID URLs (/in/ACwAAA...), and
 * redirects the latter to their canonical vanity URL client-side after
 * load (verified against live examples). Rather than trying to parse or
 * classify the input URL string, step 1 always reads back page.url()
 * AFTER navigation/redirects settle, and every subsequent step (2-4)
 * navigates from that resolved URL — never from the raw input. This
 * means an encoded URL "just works" without special-casing it, since by
 * the time step 2 runs, the browser has already told us the real
 * canonical URL. `profileUrl` (the original input, untouched) and
 * `resolvedProfileUrl` are both preserved on the returned record.
 *
 * Usage:
 *   node index.js "https://www.linkedin.com/in/<publicId-or-encoded-id>/"
 */

const fs = require("fs");
const path = require("path");

const { createBrowser, closeBrowser } = require("./browser/browser");
const { retry } = require("./utils/retry");
const log = require("./utils/logger");

const { getProfile } = require("./extractors/profile");
const { getExperience } = require("./extractors/experience");
const { getCompanyAbout } = require("./extractors/company");
const { getActivity } = require("./extractors/activity");
const { scanForKeywords } = require("./extractors/disease-keywords");
const { getAppRoot } = require("./utils/app-root");
const { isValidLinkedInProfileUrl, looksLikeEncodedProfileId } = require("./utils/linkedin-url");

async function scrapeProfile(page, profileUrl) {

    // ---- 0. Validate the URL before touching the browser at all ----
    // A clearly-invalid input (wrong site, company/post URL instead of a
    // profile, empty string, typo) fails fast with a specific reason here,
    // instead of silently producing a mostly-blank row after however many
    // retries/timeouts it takes to fail navigation.
    if (!isValidLinkedInProfileUrl(profileUrl)) {
        throw new Error(
            `Invalid LinkedIn profile URL: "${profileUrl}" — expected a linkedin.com/in/<profile-id> URL`
        );
    }

    // ---- 1. Profile page ----
    await retry(() =>
        page.goto(profileUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        })
    );

    // The profile-not-found redirect (-> /404/) is client-side and can
    // land shortly after "domcontentloaded", so these checks need to wait
    // for the page to actually settle first. Rather than a blind fixed
    // delay, wait for a signal that's only present on a real, fully
    // rendered profile (the top card's "Contact info" link) — resolves
    // as soon as it's ready instead of always waiting the same amount,
    // and its absence (timeout) is itself consistent with a redirect
    // having happened, so falling through to the URL checks below is
    // still correct either way.
    await page
        .locator('a[href*="overlay/contact-info"]')
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});

    if (/\/(login|authwall|checkpoint)/.test(page.url())) {
        throw new Error("Session expired — re-run login to refresh session/linkedin.json");
    }

    if (/\/404\/?$/.test(page.url())) {
        throw new Error("Profile not found (LinkedIn redirected to 404)");
    }

    // The canonical URL as LinkedIn itself resolved it (identical to
    // profileUrl for a standard vanity URL; the real /in/<slug>/ URL for
    // an encoded-ID input). Every later navigation step derives its
    // publicId from THIS, not from the original input string.
    //
    // For an encoded-ID input, the client-side redirect to the canonical
    // vanity URL fires ~1s AFTER the content itself is ready (verified
    // against live examples) — the "Contact info" wait above resolves
    // too early to catch it. So: if the URL still looks encoded at this
    // point, wait briefly for it to change before trusting it. If it
    // never changes (redirect doesn't happen for some reason), fall back
    // to whatever URL we have rather than failing the whole profile.
    if (looksLikeEncodedProfileId(page.url())) {
        const beforeRedirect = page.url();
        await page
            .waitForURL(url => url.href !== beforeRedirect, { timeout: 5000 })
            .catch(() => {});
    }

    const resolvedProfileUrl = page.url();

    const profile = await retry(() => getProfile(page));
    log.success("Profile extracted");

    // ---- 2. Experience (dedicated details route) ----
    const experience = await retry(() => getExperience(page, resolvedProfileUrl));
    log.success(`Experience extracted (${experience.experiences.length} roles)`);

    // ---- 3. Company About ----
    const company = await retry(() =>
        getCompanyAbout(page, experience.companyLinkedinUrl)
    );
    log.success("Company about extracted");

    // ---- 4. Recent activity ----
    const activity = await retry(() => getActivity(page, resolvedProfileUrl));
    log.success("Activity extracted");

    // ---- Disease/condolence keyword scan (headline + About + activity) ----
    const diseaseKeywords = scanForKeywords(
        profile.headline,
        profile.about,
        activity.summary,
        activity.recentText
    );

    // Onsite Address = the CURRENT job's own location, not the person's
    // general profile location and never a previous position's location.
    // Most LinkedIn users don't fill in a per-role location though, so
    // when the current experience entry doesn't have one, fall back to
    // the profile's own location (logged, so it's clear which source a
    // given row actually came from if that ever needs auditing).
    let jobLocation = experience.location || "";
    if (!jobLocation && profile.location) {
        jobLocation = profile.location;
        log.info(`No location on current role — using profile location for Onsite Address: "${profile.location}"`);
    }

    // ---- Assemble the required output shape ----
    return {
        profileUrl,
        resolvedProfileUrl,
        fullName: profile.fullName || "",
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        headline: profile.headline || "",
        pronouns: profile.pronouns || "",
        about: profile.about || "",
        location: profile.location || "",
        connections: profile.followers || "",
        followers: profile.followers || "",
        education: profile.education || "",
        openToWork: profile.openToWork || false,
        currentPosition: experience.currentPosition || "",
        currentCompany: experience.currentCompany || "",
        duration: experience.duration || "",
        startDate: experience.startDate || "",
        endDate: experience.endDate || "",
        employmentType: experience.employmentType || "",
        jobLocation,
        companyLinkedinUrl: experience.companyLinkedinUrl || "",
        website: company.website || "",
        industry: company.industry || "",
        employeeCount: company.employeeCount || "",
        companyType: company.companyType || "",
        headquarters: company.headquarters || "",
        associatedMembers: company.associatedMembers || "",
        postReactionType: activity.reactionType || "",
        postedAgoText: activity.postedAgoText || "",
        activitySummary: activity.summary || "",
        diseaseKeywords: diseaseKeywords.join(", ")
    };
}

async function main() {

    const profileUrl =
        process.argv[2] ||
        "https://www.linkedin.com/in/diego-armando-pedraza-0bb49a117/";

    const { browser, page } = await createBrowser();

    try {
        log.title("LINKEDIN SCRAPER");
        log.info(profileUrl);

        const result = await scrapeProfile(page, profileUrl);

        log.title("FINAL RESULT");
        console.log(JSON.stringify(result, null, 2));

        const outDir = path.join(getAppRoot(), "output");
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const outFile = path.join(
            outDir,
            "result-" + (profileUrl.match(/\/in\/([^/?#]+)/) || [, "profile"])[1] + ".json"
        );
        fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
        log.success("Saved: " + path.relative(process.cwd(), outFile));

    } catch (err) {
        log.error(err.message);
        process.exitCode = 1;
    } finally {
        await closeBrowser(browser);
    }
}

// Allow use as both a CLI and a library.
if (require.main === module) {
    main();
}

module.exports = { scrapeProfile };
