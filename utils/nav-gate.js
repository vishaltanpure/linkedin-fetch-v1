/**
 * Limits how many LinkedIn page.goto navigations run at once across
 * concurrent worker tabs. Encoded /in/ACw… URLs are especially heavy:
 * LinkedIn loads a shell then client-redirects to the vanity URL. With
 * concurrency=5 and no gate, five tabs do that together and the headed
 * browser freezes until they settle.
 */

function int(envVar, fallback) {
    const raw = process.env[envVar];
    if (raw === undefined) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createSemaphore(limit) {
    let available = Math.max(1, limit);
    const queue = [];

    async function acquire() {
        if (available > 0) {
            available--;
            return;
        }
        await new Promise(resolve => queue.push(resolve));
    }

    function release() {
        const next = queue.shift();
        if (next) next();
        else available++;
    }

    async function withLock(fn) {
        await acquire();
        try {
            return await fn();
        } finally {
            release();
        }
    }

    return { acquire, release, withLock };
}

// Default 2: keeps some overlap without freezing Chromium on ACw loads.
const profileNavGate = createSemaphore(int("MAX_CONCURRENT_NAVS", 2));

module.exports = {
    createSemaphore,
    profileNavGate
};
