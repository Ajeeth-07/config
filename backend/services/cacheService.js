/**
 * Gemini Context Caching Service
 * Handles creation, retrieval, and reuse of cached context.
 *
 * Concurrency-safe design:
 *  - Each unique jsonRef (identified by SHA-256 hash) gets its own isolated
 *    cache entry in a Map, so concurrent requests with different payloads
 *    never interfere with each other.
 *  - Requests with the same jsonRef share and reuse a single cache.
 *  - TTL (configured in CONFIG.CACHE_TTL_SECONDS) handles natural expiration.
 *  - Stale entries are swept from the Map on every getOrCreateCache() call
 *    to prevent unbounded memory growth.
 */

const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAICacheManager } = require("@google/generative-ai/server");
const { CONFIG, SYSTEM_INSTRUCTIONS } = require("./config");

// Initialize Gemini clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const cacheManager = new GoogleAICacheManager(process.env.GEMINI_API_KEY);

/**
 * Map of active caches, keyed by jsonRef SHA-256 hash.
 * Value: { cache: Object, createdAt: number }
 *
 * This allows multiple concurrent requests with different jsonRef payloads
 * to each have their own independent cache without overwriting each other.
 * @type {Map<string, { cache: Object, createdAt: number }>}
 */
const cacheStore = new Map();

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
 * Verify that a specific cache entry is still alive on the server.
 * If expired/deleted server-side, removes it from the local Map.
 * @param {string} hash - The jsonRef hash key
 * @returns {boolean}
 */
async function isCacheAlive(hash) {
  const entry = cacheStore.get(hash);
  if (!entry) return false;
  try {
    await cacheManager.get(entry.cache.name);
    return true;
  } catch {
    // Cache was expired or deleted server-side
    cacheStore.delete(hash);
    return false;
  }
}

/**
 * Remove Map entries whose TTL has likely elapsed (local clock estimate).
 * This is a lightweight sweep to prevent unbounded Map growth; the real
 * source of truth is the Gemini server, checked in isCacheAlive().
 */
function sweepExpiredEntries() {
  const now = Date.now();
  const ttlMs = CONFIG.CACHE_TTL_SECONDS * 1000;
  for (const [hash, entry] of cacheStore) {
    if (now - entry.createdAt > ttlMs) {
      console.log(`  🧹 Sweeping expired cache entry (hash: ${hash.slice(0, 8)}…)`);
      cacheStore.delete(hash);
    }
  }
}

/**
 * Create or retrieve cached content for the AI model.
 * Concurrent-safe: each unique jsonRef gets its own cache entry.
 * Requests with the same jsonRef reuse the existing cache if it's still alive.
 *
 * @param {Object} jsonRef - JSON reference data to cache
 * @param {Object} structuralFingerprint - Structural metadata of mapping file
 * @returns {Object|null} Cache object or null if caching disabled/failed
 */
async function getOrCreateCache(jsonRef, structuralFingerprint) {
  if (!CONFIG.ENABLE_CACHING) {
    return null;
  }

  // Sweep locally-expired entries to keep the Map bounded
  sweepExpiredEntries();

  const hash = computeJsonRefHash(jsonRef);

  // Reuse existing cache if this jsonRef has one and it's still alive
  if (cacheStore.has(hash)) {
    const alive = await isCacheAlive(hash);
    if (alive) {
      const entry = cacheStore.get(hash);
      console.log(
        `  ♻️  Reusing existing cache: ${entry.cache.name} (hash: ${hash.slice(0, 8)}…)`,
      );
      return entry.cache;
    }
    console.log("  ⏰ Previous cache expired server-side, will recreate");
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
    cacheStore.set(hash, { cache, createdAt: Date.now() });
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
 * Force-purge a specific cache by its jsonRef, or purge ALL caches.
 * Use when you explicitly need to free storage early.
 * Normal expiration is handled by TTL — you rarely need this.
 *
 * @param {Object} [jsonRef] - If provided, purges only that jsonRef's cache.
 *                             If omitted, purges all cached entries.
 */
async function purgeCache(jsonRef) {
  if (jsonRef) {
    // Purge a specific entry
    const hash = computeJsonRefHash(jsonRef);
    const entry = cacheStore.get(hash);
    if (entry) {
      try {
        await cacheManager.delete(entry.cache.name);
        console.log(`  🗑️  Cache purged: ${entry.cache.name}`);
      } catch {
        // Ignore — cache may already be expired
      }
      cacheStore.delete(hash);
    }
  } else {
    // Purge all entries
    for (const [hash, entry] of cacheStore) {
      try {
        await cacheManager.delete(entry.cache.name);
        console.log(`  🗑️  Cache purged: ${entry.cache.name}`);
      } catch {
        // Ignore — cache may already be expired
      }
    }
    cacheStore.clear();
  }
}

/**
 * Get the number of active cache entries (for diagnostics)
 * @returns {number}
 */
function getCacheCount() {
  return cacheStore.size;
}

module.exports = {
  getOrCreateCache,
  getModel,
  purgeCache,
  getCacheCount,
};
