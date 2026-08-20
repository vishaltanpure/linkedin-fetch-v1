/**
 * Races a promise against a timeout. Playwright has no true cancellation
 * for an in-flight page.goto/evaluate, so a timeout here doesn't stop the
 * underlying work — the caller is expected to treat the owning page as
 * compromised and recycle it (close + reopen) rather than reuse it, to
 * avoid a stale in-flight operation colliding with the next job.
 */
function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message || `Timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
