/**
 * Recent-activity extractor.
 *
 * Scrapes /in/<publicId>/recent-activity/<tab>/.
 *
 * IMPORTANT (premium / newer layouts):
 *   - Feed posts are often NOT wrapped in <li>. Waiting on `main li`
 *     resolves against filter-tabs / social-count lists and misses
 *     real articles (`[data-view-name="feed-full-update"]` /
 *     `.feed-shared-update-v2[role="article"]`).
 *   - Header class `.update-components-header__text-view` is often
 *     absent on original posts; timestamps are abbreviated ("3mo •",
 *     "8yr •") instead of "3 months ago • Visible to anyone...".
 *
 * Strategy:
 *   1. Try /all/ first.
 *   2. If empty, probe /articles/, /comments/, /reactions/ and keep
 *      the tab with the genuinely most-recent item.
 */

const REACTION_PATTERNS = [
    [/likes this/i, "LIKE"],
    [/celebrates this/i, "CELEBRATE"],
    [/supports this/i, "SUPPORT"],
    [/loves this/i, "LOVE"],
    [/finds this insightful/i, "INSIGHTFUL"],
    [/finds this funny/i, "FUNNY"],
    [/finds this curious/i, "CURIOUS"],
    // Spanish UI (common on LATAM Premium sessions)
    [/recomienda esto/i, "LIKE"],
    [/le gusta esto/i, "LIKE"],
    [/celebra esto/i, "CELEBRATE"],
    [/apoya esto/i, "SUPPORT"],
    [/le encanta esto/i, "LOVE"]
];

const FALLBACK_TABS = ["articles", "comments", "reactions"];

const ACTIVITY_ITEM_SELECTOR = [
    '[data-view-name="feed-full-update"]',
    '.feed-shared-update-v2[role="article"]',
    '.feed-shared-update-v2[data-urn^="urn:li:activity"]',
    ".occludable-update",
    "main li.profile-creator-shared-feed-update__container"
].join(", ");

function detectReactionType(headerText) {
    for (const [pattern, type] of REACTION_PATTERNS) {
        if (pattern.test(headerText)) return type;
    }
    return "";
}

// Supports both "3 weeks ago" and abbreviated "3mo" / "8yr" / "2d" / "5w".
function parseRelativeAgeInDays(text) {
    const raw = text || "";

    const long = raw.match(/(\d+)\s*(minute|hour|day|week|month|year)s?/i);
    if (long) {
        const n = Number(long[1]);
        const unitDays = {
            minute: 1 / 1440,
            hour: 1 / 24,
            day: 1,
            week: 7,
            month: 30,
            year: 365
        };
        return n * (unitDays[long[2].toLowerCase()] || 365);
    }

    const short = raw.match(/(\d+)\s*(mo|yr|w|d|h|m)\b/i);
    if (short) {
        const n = Number(short[1]);
        const unitDays = { m: 1 / 1440, h: 1 / 24, d: 1, w: 7, mo: 30, yr: 365 };
        return n * (unitDays[short[2].toLowerCase()] || 365);
    }

    return Infinity;
}

function collectActivityInPage() {

    const clean = s => (s || "").replace(/\s+/g, " ").trim();

    const roots = Array.from(document.querySelectorAll(
        '[data-view-name="feed-full-update"], ' +
        '.feed-shared-update-v2[role="article"], ' +
        '.feed-shared-update-v2[data-urn^="urn:li:activity"]'
    ));

    // Deduplicate: feed-full-update wrappers often contain an inner
    // .feed-shared-update-v2 that would otherwise be counted twice.
    const seen = new Set();
    const items = [];
    for (const root of roots) {
        const article = root.matches?.(".feed-shared-update-v2")
            ? root
            : (root.querySelector(".feed-shared-update-v2") || root);
        const key = article.getAttribute("data-urn") ||
            article.id ||
            clean(article.innerText).slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(article);
        if (items.length >= 10) break;
    }

    if (items.length === 0) {
        for (const li of Array.from(document.querySelectorAll("main li")).slice(0, 10)) {
            items.push(li);
        }
    }

    return items.map(article => {
        const headerEl = article.querySelector(
            ".update-components-header__text-view, .update-components-header"
        );

        const agoEl =
            article.querySelector(".update-components-actor__sub-description .visually-hidden") ||
            article.querySelector(".update-components-actor__sub-description") ||
            Array.from(article.querySelectorAll("span")).find(el =>
                /\b\d+\s*(mo|yr|w|d|h|m|minute|hour|day|week|month|year)s?\b/i.test(clean(el.textContent))
            );

        const commentaryEl = article.querySelector(
            ".update-components-update-v2__commentary, " +
            ".feed-shared-update-v2__description, " +
            ".feed-shared-inline-show-more-text, " +
            "[class*='commentary']"
        );

        const headerText = clean(headerEl?.textContent);
        let postedAgoText = clean(agoEl?.textContent);
        // Trim trailing globe/visibility junk: "3mo •" is enough.
        postedAgoText = postedAgoText
            .replace(/\s*Visible to.*$/i, "")
            .replace(/\s*Visible para.*$/i, "")
            .replace(/\s+/g, " ")
            .trim();

        const commentary = clean(commentaryEl?.textContent)
            .replace(/\s*…more$/i, "")
            .replace(/\s*see more$/i, "")
            .trim();

        const fullText = clean(article.innerText);

        // Original posts often have no header; infer repost/comment/reaction
        // from the leading activity line when present.
        let inferredHeader = headerText;
        if (!inferredHeader) {
            const lead = fullText.slice(0, 160);
            if (/reposted this|ha vuelto a publicar/i.test(lead)) {
                inferredHeader = "reposted this";
            } else if (/commented on|ha comentado/i.test(lead)) {
                inferredHeader = "commented on this";
            } else if (/likes this|le gusta esto|recomienda esto/i.test(lead)) {
                inferredHeader = "likes this";
            }
        }

        return {
            headerText: inferredHeader,
            postedAgoText,
            commentary,
            fullText: [inferredHeader, postedAgoText, commentary, fullText]
                .filter(Boolean)
                .join(" ")
        };
    }).filter(i => i.fullText && (i.postedAgoText || i.commentary || i.headerText || i.fullText.length > 40));
}

async function loadActivityTab(page, publicId, tab, waitTimeoutMs = 10000) {

    await page.goto(`https://www.linkedin.com/in/${publicId}/recent-activity/${tab}/`, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    if (/\/(login|authwall|checkpoint)/.test(page.url())) {
        return [];
    }

    await page
        .locator(ACTIVITY_ITEM_SELECTOR)
        .first()
        .waitFor({ timeout: waitTimeoutMs })
        .catch(() => {});

    await page.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
    await page
        .locator(ACTIVITY_ITEM_SELECTOR)
        .first()
        .waitFor({ timeout: Math.min(4000, waitTimeoutMs) })
        .catch(() => {});

    return page.evaluate(collectActivityInPage).catch(() => []);
}

function buildResult(items) {

    const result = { reactionType: "", postedAgoText: "", summary: "", recentText: "" };

    if (items.length === 0) return result;

    const [mostRecent] = items;

    result.reactionType = detectReactionType(mostRecent.headerText);
    result.postedAgoText = mostRecent.postedAgoText;

    // Prefer a useful Activity cell: header + ago, or commentary preview
    // when the post is an original (no "likes this" header).
    const commentaryPreview = (mostRecent.commentary || "")
        .slice(0, 140)
        .trim();

    result.summary = [
        mostRecent.headerText,
        mostRecent.postedAgoText,
        !mostRecent.headerText && commentaryPreview ? commentaryPreview : ""
    ].filter(Boolean).join(" — ");

    result.recentText = items
        .map(i => [i.headerText, i.postedAgoText, i.commentary, i.fullText].filter(Boolean).join(" "))
        .join(" \n ");

    return result;
}

async function getActivity(page, profileUrl) {

    const publicId = profileUrl.match(/\/in\/([^/?#]+)/)?.[1];
    if (!publicId) return buildResult([]);

    const allItems = await loadActivityTab(page, publicId, "all");
    if (allItems.length > 0) {
        return buildResult(allItems);
    }

    let best = null;
    let bestAgeDays = Infinity;

    for (const tab of FALLBACK_TABS) {
        const items = await loadActivityTab(page, publicId, tab, 6000);
        if (items.length === 0) continue;

        const ageDays = parseRelativeAgeInDays(items[0].postedAgoText);
        if (ageDays < bestAgeDays) {
            best = items;
            bestAgeDays = ageDays;
        }
    }

    return buildResult(best || []);
}

module.exports = {
    getActivity,
    _internals: { detectReactionType, parseRelativeAgeInDays }
};
