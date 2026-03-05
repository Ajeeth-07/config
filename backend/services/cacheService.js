/**
 * Gemini Context Caching Service
 * Handles creation, retrieval, and reuse of cached context.
 *
 * Strategy:
 *  - Cache is reused across requests as long as the underlying jsonRef
 *    hasn't changed (compared via SHA-256 hash).
 *  - TTL (configured in CONFIG.CACHE_TTL_SECONDS) handles natural expiration.
 *  - When jsonRef changes, the old cache is purged early (to save hourly
 *    storage costs) before a new one is created.
 */

const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAICacheManager } = require("@google/generative-ai/server");
const { CONFIG, SYSTEM_INSTRUCTIONS } = require("./config");

// Initialize Gemini clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const cacheManager = new GoogleAICacheManager(process.env.GEMINI_API_KEY);

// In-memory state for cache reuse
let currentCache = null;
let currentCacheHash = null;

/**
 * Compute a SHA-256 hash of the jsonRef to detect content changes
 * @param {Object} jsonRef
 * @returns {string} hex digest
 */
function computeJsonRefHash(jsonRef) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(jsonRef))
    .digest("hex");
}

/**
 * Verify that the current in-memory cache is still alive on the server.
 * Returns false if expired, deleted, or unreachable.
 */
async function isCacheAlive() {
  if (!currentCache) return false;
  try {
    await cacheManager.get(currentCache.name);
    return true;
  } catch {
    // Cache was expired or deleted server-side
    currentCache = null;
    currentCacheHash = null;
    return false;
  }
}

/**
 * Create or retrieve cached content for the AI model.
 * Reuses the existing cache when jsonRef hasn't changed and the cache
 * is still alive. Otherwise purges the stale cache and creates a new one.
 *
 * @param {Object} jsonRef - JSON reference data to cache
 * @param {Object} structuralFingerprint - Structural metadata of mapping file
 * @returns {Object|null} Cache object or null if caching disabled/failed
 */
async function getOrCreateCache(jsonRef, structuralFingerprint) {
  if (!CONFIG.ENABLE_CACHING) {
    return null;
  }

  const newHash = computeJsonRefHash(jsonRef);

  // Reuse existing cache if jsonRef is unchanged and cache is still alive
  if (currentCache && currentCacheHash === newHash) {
    const alive = await isCacheAlive();
    if (alive) {
      console.log(
        `  ♻️  Reusing existing cache: ${currentCache.name} (hash match)`,
      );
      return currentCache;
    }
    console.log("  ⏰ Previous cache expired server-side, will recreate");
  }

  // jsonRef changed — purge old cache early to save storage costs
  if (currentCache && currentCacheHash !== newHash) {
    console.log("  🔄 jsonRef changed — purging old cache early");
    await purgeCache();
  }

  try {
    console.log("  📦 Creating context cache...");

    const cache = await cacheManager.create({
      model: CONFIG.CACHE_MODEL,
      displayName: `input-config-cache-${Date.now()}`,
      systemInstruction: SYSTEM_INSTRUCTIONS,
      contents: [
        {
          role: "user",
          parts: [
            { text: `JSON Reference:\n${JSON.stringify(jsonRef, null, 2)}` },
          ],
        },
      ],
      ttlSeconds: CONFIG.CACHE_TTL_SECONDS,
    });

    console.log(
      `  ✅ Cache created: ${cache.name} (TTL: ${CONFIG.CACHE_TTL_SECONDS}s)`,
    );
    currentCache = cache;
    currentCacheHash = newHash;
    return cache;
  } catch (error) {
    console.log(`  ⚠️  Caching not available: ${error.message}`);
    console.log("  📝 Falling back to non-cached mode");
    return null;
  }
}

/**
 * Get Gemini model - either from cache or regular initialization
 * @param {Object|null} cache - Cache object from getOrCreateCache
 * @returns {Object} Gemini model instance
 */
async function getModel(cache = null) {
  if (cache && CONFIG.ENABLE_CACHING) {
    try {
      return genAI.getGenerativeModelFromCachedContent(cache);
    } catch (error) {
      console.log(`  ⚠️  Could not use cache: ${error.message}`);
    }
  }
  return genAI.getGenerativeModel({ model: CONFIG.MODEL });
}

/**
 * Force-purge the current cache from the server.
 * Use this only when you explicitly need to free storage early
 * (e.g. jsonRef changed). Normal expiration is handled by TTL.
 */
async function purgeCache() {
  if (currentCache) {
    try {
      await cacheManager.delete(currentCache.name);
      console.log(`  🗑️  Cache purged: ${currentCache.name}`);
    } catch (error) {
      // Ignore — cache may already be expired
    }
    currentCache = null;
    currentCacheHash = null;
  }
}

/**
 * Get the current cache reference
 * @returns {Object|null} Current cache object
 */
function getCurrentCache() {
  return currentCache;
}

module.exports = {
  getOrCreateCache,
  getModel,
  purgeCache,
  getCurrentCache,
};
