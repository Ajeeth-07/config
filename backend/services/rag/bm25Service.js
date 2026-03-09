/**
 * BM25 Scoring Service
 *
 * Implements the Okapi BM25 algorithm for keyword-based scoring.
 * Used alongside vector cosine similarity in hybrid search:
 *   final_score = α × cosine_similarity + (1-α) × bm25_score
 *
 * BM25 formula per query term qi:
 *   score(D,Q) = Σ IDF(qi) × (f(qi,D) × (k1+1)) / (f(qi,D) + k1 × (1 - b + b × |D|/avgdl))
 *
 * Where:
 *   f(qi,D)  = term frequency of qi in document D
 *   |D|      = document length (in tokens)
 *   avgdl    = average document length across corpus
 *   k1       = term frequency saturation parameter (default 1.2)
 *   b        = length normalization parameter (default 0.75)
 *   IDF(qi)  = ln((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
 *   N        = total documents in corpus
 *   n(qi)    = number of documents containing qi
 */

const { RAG_CONFIG } = require("./config");

// ---------------------------------------------------------------------------
// BM25 parameters
// ---------------------------------------------------------------------------
const BM25_K1 = 1.2;    // Term frequency saturation — higher = TF matters more
const BM25_B = 0.75;    // Length normalization — 0=no normalization, 1=full

// ---------------------------------------------------------------------------
// Index state — rebuilt when corpus changes
// ---------------------------------------------------------------------------
let indexState = {
  built: false,
  docCount: 0,            // N — total documents
  avgDocLength: 0,        // avgdl
  docLengths: [],         // |D| per document
  docTermFreqs: [],       // tf(t,D) per document — Map<term, freq>
  idf: new Map(),         // IDF per term
  buildVersion: 0,        // increments on rebuild
};

// ---------------------------------------------------------------------------
// Tokenizer — keeps it simple and fast
// ---------------------------------------------------------------------------

/**
 * Tokenize text into lowercase terms, stripping punctuation.
 * Splits on pipes (|), colons, commas, whitespace — matching the
 * searchable text format: "Label: Annual Premium | Field: premium_amount"
 *
 * @param {string} text
 * @returns {string[]} Array of lowercase tokens
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")   // strip special chars except underscore
    .split(/\s+/)                      // split on whitespace
    .filter((t) => t.length >= 2);     // drop single-char tokens
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

/**
 * Build (or rebuild) the BM25 index from a corpus of document strings.
 * Call this whenever the child store changes (after ingest / delete).
 *
 * @param {string[]} documents - Array of searchable text strings (childStore.documents)
 */
function buildIndex(documents) {
  const N = documents.length;
  if (N === 0) {
    indexState = { built: false, docCount: 0, avgDocLength: 0, docLengths: [], docTermFreqs: [], idf: new Map(), buildVersion: indexState.buildVersion + 1 };
    return;
  }

  const docLengths = new Array(N);
  const docTermFreqs = new Array(N);
  const termDocCount = new Map(); // n(qi) — how many docs contain each term
  let totalLength = 0;

  for (let i = 0; i < N; i++) {
    const tokens = tokenize(documents[i]);
    docLengths[i] = tokens.length;
    totalLength += tokens.length;

    // Count term frequencies for this document
    const tf = new Map();
    const seenTerms = new Set();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
      seenTerms.add(token);
    }
    docTermFreqs[i] = tf;

    // Track document frequency for IDF
    for (const term of seenTerms) {
      termDocCount.set(term, (termDocCount.get(term) || 0) + 1);
    }
  }

  // Compute IDF for each term
  const idf = new Map();
  for (const [term, docFreq] of termDocCount) {
    // Okapi BM25 IDF variant — always non-negative
    idf.set(term, Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1));
  }

  indexState = {
    built: true,
    docCount: N,
    avgDocLength: totalLength / N,
    docLengths,
    docTermFreqs,
    idf,
    buildVersion: indexState.buildVersion + 1,
  };

  console.log(
    `BM25 index built: ${N} documents, ${idf.size} unique terms, avg length ${indexState.avgDocLength.toFixed(1)} tokens`,
  );
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute BM25 score for a single document against a query.
 *
 * @param {string[]} queryTokens - Tokenized query
 * @param {number} docIndex - Index into the corpus
 * @returns {number} Raw BM25 score (unbounded, ≥ 0)
 */
function scoreDocument(queryTokens, docIndex) {
  if (!indexState.built || docIndex >= indexState.docCount) return 0;

  const tf = indexState.docTermFreqs[docIndex];
  const docLen = indexState.docLengths[docIndex];
  const avgdl = indexState.avgDocLength;
  let score = 0;

  for (const qi of queryTokens) {
    const termIdf = indexState.idf.get(qi);
    if (termIdf === undefined) continue; // term not in corpus

    const termFreq = tf.get(qi) || 0;
    if (termFreq === 0) continue;

    // BM25 term score
    const numerator = termFreq * (BM25_K1 + 1);
    const denominator = termFreq + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgdl));
    score += termIdf * (numerator / denominator);
  }

  return score;
}

/**
 * Score all documents against a query and return raw BM25 scores.
 * Scores are normalized to [0, 1] by dividing by the max score,
 * so they can be combined with cosine similarity on the same scale.
 *
 * @param {string} query - Raw query string
 * @param {number[]} candidateIndices - Optional: only score these document indices
 * @returns {Map<number, number>} Map of docIndex → normalized BM25 score [0, 1]
 */
function scoreBatch(query, candidateIndices = null) {
  const scores = new Map();
  if (!indexState.built) return scores;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return scores;

  const indices = candidateIndices || Array.from({ length: indexState.docCount }, (_, i) => i);

  let maxScore = 0;

  // First pass: compute raw scores
  for (const idx of indices) {
    const rawScore = scoreDocument(queryTokens, idx);
    if (rawScore > 0) {
      scores.set(idx, rawScore);
      if (rawScore > maxScore) maxScore = rawScore;
    }
  }

  // Normalize to [0, 1] so BM25 is on the same scale as cosine similarity
  if (maxScore > 0) {
    for (const [idx, rawScore] of scores) {
      scores.set(idx, rawScore / maxScore);
    }
  }

  return scores;
}

/**
 * Check if the index needs rebuilding (e.g., corpus size changed)
 * @param {number} currentDocCount - Current number of documents in the store
 * @returns {boolean}
 */
function needsRebuild(currentDocCount) {
  return !indexState.built || indexState.docCount !== currentDocCount;
}

/**
 * Get BM25 index stats for monitoring
 */
function getBM25Stats() {
  return {
    built: indexState.built,
    docCount: indexState.docCount,
    uniqueTerms: indexState.idf.size,
    avgDocLength: indexState.avgDocLength.toFixed(1),
    buildVersion: indexState.buildVersion,
  };
}

module.exports = {
  tokenize,
  buildIndex,
  scoreBatch,
  needsRebuild,
  getBM25Stats,
};
