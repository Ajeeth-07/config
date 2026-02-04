/**
 * Utility helper functions
 */

const { CONFIG } = require("../config");

/**
 * Sleep utility - pause execution for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get current date in YYYY-MM-DD format
 * @returns {string} Current date formatted as YYYY-MM-DD
 */
function getCurrentDate() {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} initialDelay - Initial delay in milliseconds
 */
async function retryWithBackoff(
  fn,
  maxRetries = CONFIG.MAX_RETRIES,
  initialDelay = CONFIG.INITIAL_RETRY_DELAY_MS,
) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if it's a quota/rate limit error
      const isRateLimitError =
        error.message?.includes("429") ||
        error.message?.includes("quota") ||
        error.message?.includes("Too Many Requests");

      if (isRateLimitError && attempt < maxRetries) {
        // Extract retry delay from error if available
        const retryMatch = error.message?.match(/retry in (\d+\.?\d*)s/i);
        let waitTime = retryMatch
          ? parseFloat(retryMatch[1]) * 1000
          : initialDelay * Math.pow(2, attempt);

        console.log(
          `    ⏳ Rate limited. Waiting ${(waitTime / 1000).toFixed(
            1,
          )}s before retry ${attempt + 1}/${maxRetries}...`,
        );
        await sleep(waitTime);
      } else if (!isRateLimitError) {
        // Non-rate-limit error, don't retry
        throw error;
      }
    }
  }

  throw lastError;
}

module.exports = {
  sleep,
  getCurrentDate,
  retryWithBackoff,
};
