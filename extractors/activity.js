/**
 * Recent-activity extractor.
 *
 * Scrapes /in/<publicId>/recent-activity/<tab>/ — a genuinely different
 * rendering layer than the profile/experience pages (legacy
 * "feed-shared-update" / "update-components-*" class names, no
 * componentkey hooks), verified against the live DOM.
 *
 * /recent-activity/all/ is NOT reliable on its own: verified live that it
 * can render completely empty for a profile that has real activity —
 * e.g. a profile whose only recent activity is a reaction shows 0 items
 * on /all/ while /reactions/ shows 36. So the strategy is:
 *   1. Try /all/ first (fast path — works for most profiles, 1 page load).
 *   2. If that comes back empty, check the three specific tabs
 *      (/articles/ = "Posts" in the nav despite the URL name, /comments/,
 *      /reactions/) and use whichever has the genuinely most recent item,
 *      compared by parsing each item's relative-age text.
 *
 * For each feed item:
 *   - Activity type/reaction is in .update-components-header__text-view
 *     as free text ("reposted this", "likes this", "commented on ...").
 *     Only reaction-type activity ("likes this", "celebrates this", ...)
 *     maps to a reaction type; reposts/comments/original posts don't.
 *   - The "N <ago> • [Edited •] Visible to ..." descriptor lives in
 *     .update-components-actor__sub-description .visually-hidden (the
 *     full accessible text; its aria-hidden sibling is the abbreviated
 *     on-screen version).
 *
 * Only the MOST RECENT item feeds reactionType/postedAgoText (those are
 * singular fields). Several of the most recent items' text is combined
 * separately for keyword scanning, since that's a broader "recent
 * activity" signal rather than a single-post field.
 */

const REACTION_PATTERNS = [
    [/likes this/i, "LIKE"],
    [/celebrates this/i, "CELEBRATE"],
    [/supports this/i, "SUPPORT"],
    [/loves this/i, "LOVE"],
    [/finds this insightful/i, "INSIGHTFUL"],
    [/finds this funny/i, "FUNNY"],
    [/finds this curious/i, "CURIOUS"]
];

// The nav is labeled "Posts", but its actual URL slug is legacy
// ("articles") — verified: /recent-activity/posts/ redirects there.
const FALLBACK_TABS = ["articles", "comments", "reactions"];

function detectReactionType(headerText) {
    for (const [pattern, type] of REACTION_PATTERNS) {
        if (pattern.test(headerText)) return type;
    }
    return "";
}

// "3 weeks ago" -> ~21, "9 years ago" -> ~3285, unparseable -> Infinity
// (treated as oldest/lowest priority rather than accidentally "most recent").
function parseRelativeAgeInDays(text) {
    const match = (text || "").match(/(\d+)\s*(minute|hour|day|week|month|year)s?/i);
    if (!match) return Infinity;
    const n = Number(match[1]);
    const unitDays = {
        minute: 1 / 1440,
        hour: 1 / 24,
        day: 1,
        week: 7,
        month: 30,
        year: 365
    };
    return n * (unitDays[match[2].toLowerCase()] || 365);
}

function collectActivityInPage() {

    const items = Array.from(document.querySelectorAll("main li")).slice(0, 10);

    return items.map(item => {
        const headerEl = item.querySelector(".update-components-header__text-view");
        const agoEl = item.querySelector(".update-components-actor__sub-description .visually-hidden");

        return {
            headerText: (headerEl?.textContent || "").replace(/\s+/g, " ").trim(),
            postedAgoText: (agoEl?.textContent || "").replace(/\s+/g, " ").trim(),
            fullText: (item.innerText || "").replace(/\s+/g, " ").trim()
        };
    }).filter(i => i.fullText);
}

async function loadActivityTab(page, publicId, tab, waitTimeoutMs = 8000) {

    await page.goto(`https://www.linkedin.com/in/${publicId}/recent-activity/${tab}/`, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    if (/\/(login|authwall|checkpoint)/.test(page.url())) {
        return [];
    }

    // Wait for the first activity item to actually render rather than a
    // blind delay — resolves immediately on a fast load, and its timeout
    // is itself the correct signal for "this tab has nothing" (rather
    // than always burning the same fixed wait either way). A genuinely
    // empty tab burns the FULL waitTimeoutMs every time (there's nothing
    // to resolve early on), which matters once the fallback path below
    // may probe up to 3 tabs in sequence — hence the shorter timeout
    // passed there.
    await page
        .locator("main li")
        .first()
        .waitFor({ timeout: waitTimeoutMs })
        .catch(() => {});

    return page.evaluate(collectActivityInPage).catch(() => []);
}

function buildResult(items) {

    const result = { reactionType: "", postedAgoText: "", summary: "", recentText: "" };

    if (items.length === 0) return result;

    const [mostRecent] = items;

    result.reactionType = detectReactionType(mostRecent.headerText);
    result.postedAgoText = mostRecent.postedAgoText;
    result.recentText = items.map(i => i.fullText).join(" \n ");
    result.summary = [mostRecent.headerText, mostRecent.postedAgoText]
        .filter(Boolean)
        .join(" — ");

    return result;
}

async function getActivity(page, profileUrl) {

    const publicId = profileUrl.match(/\/in\/([^/?#]+)/)?.[1];
    if (!publicId) return buildResult([]);

    const allItems = await loadActivityTab(page, publicId, "all");
    if (allItems.length > 0) {
        return buildResult(allItems);
    }

    // /all/ came back empty — not necessarily true. Check the three
    // specific tabs and use whichever holds the genuinely most recent
    // activity, not just the first one that happens to have content.
    let best = null;
    let bestAgeDays = Infinity;

    for (const tab of FALLBACK_TABS) {
        // Shorter wait here than the initial /all/ check: real content
        // has consistently rendered its first item within ~5s in testing,
        // and this loop can probe up to 3 tabs, so a genuinely-empty one
        // (common — most profiles don't have all three tab types active)
        // shouldn't each burn the full 8s.
        const items = await loadActivityTab(page, publicId, tab, 5000);
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
