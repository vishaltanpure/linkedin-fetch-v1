async function retry(fn, options = {}) {

    const retries = options.retries || 3;

    const delay = options.delay || 2000;

    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {

        try {

            return await fn();

        }
        catch (error) {

            lastError = error;

            console.log(
                `Retry ${attempt}/${retries}`
            );

            if (attempt < retries) {

                await new Promise(resolve =>
                    setTimeout(resolve, delay)
                );

            }

        }

    }

    throw lastError;

}

module.exports = {

    retry

};
