const Delay = require("./delay");

/**
 * Gentle incremental scroll.
 *
 * The old `window.scrollTo(0, scrollHeight)` jump defeated LinkedIn's
 * IntersectionObserver-based lazy mounting: middle sections never dwelt
 * in the viewport long enough to mount. This scrolls in small steps so
 * every lazy row gets a chance to render, then returns to the top.
 */
async function gentle(page) {

    await page.evaluate(async () => {
        await new Promise(resolve => {
            let y = 0;
            const step = 500;
            const timer = setInterval(() => {
                window.scrollBy(0, step);
                y += step;
                if (y >= document.body.scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    });

    await Delay.short(page);

    await page.evaluate(() => window.scrollTo(0, 0));

    await Delay.short(page);
}

// Kept for callers that still need a hard scroll to the bottom.
async function toBottom(page) {

    let previousHeight = 0;

    for (let i = 0; i < 30; i++) {

        const currentHeight = await page.evaluate(
            () => document.body.scrollHeight
        );

        if (currentHeight === previousHeight) break;

        previousHeight = currentHeight;

        await page.evaluate(() => window.scrollBy(0, window.innerHeight));

        await Delay.short(page);
    }
}

async function toTop(page) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await Delay.short(page);
}

module.exports = {
    gentle,
    toBottom,
    toTop
};
