/**
 * Gemini Context Caching Service
 * Handles creation, retrieval, and cleanup of cached context
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAICacheManager } = require("@google/generative-ai/server");
const { CONFIG, SYSTEM_INSTRUCTIONS } = require("./config");

// Initialize Gemini clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const cacheManager = new GoogleAICacheManager(process.env.GEMINI_API_KEY);

// In-memory cache reference for current session
let currentCache = null;

/**
 * Create or retrieve cached content for the AI model
 * @param {Object} jsonRef - JSON reference data to cache
 * @param {Object} structuralFingerprint - Structural metadata of mapping file
 * @returns {Object|null} Cache object or null if caching disabled/failed
 */
async function getOrCreateCache(jsonRef, structuralFingerprint) {
  if (!CONFIG.ENABLE_CACHING) {
    return null;
  }

  try {
    // Create cache content with system instructions and JSON reference
    const cacheContent = `${SYSTEM_INSTRUCTIONS}

## JSON API Reference (for field path mapping):
${JSON.stringify(jsonRef, null, 2)}

## Structural Overview:
${JSON.stringify(
  Object.entries(structuralFingerprint).map(([sheet, fp]) => ({
    sheet,
    columnCount: fp.columns.length,
    clusters: Object.entries(fp.clusters)
      .filter(([_, cols]) => cols.length > 0)
      .map(([name, cols]) => `${name}: ${cols.length}`),
  })),
  null,
  2,
)}`;

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
 * Clean up cache when processing is complete
 */
async function cleanupCache() {
  if (currentCache) {
    try {
      await cacheManager.delete(currentCache.name);
      console.log("  🗑️  Cache cleaned up");
      currentCache = null;
    } catch (error) {
      // Ignore cleanup errors
    }
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
  cleanupCache,
  getCurrentCache,
};
