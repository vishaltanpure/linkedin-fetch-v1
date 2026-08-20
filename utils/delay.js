function random(min, max) {

    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;

}

async function short(page) {

    await page.waitForTimeout(
        random(800, 1500)
    );

}

async function medium(page) {

    await page.waitForTimeout(
        random(1800, 3000)
    );

}

async function long(page) {

    await page.waitForTimeout(
        random(3500, 6000)
    );

}

async function custom(page, min, max) {

    await page.waitForTimeout(
        random(min, max)
    );

}

module.exports = {

    short,

    medium,

    long,

    custom,

    random

};
