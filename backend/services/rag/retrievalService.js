/**
 * Retrieval Service
 * Handles intelligent retrieval of similar configurations for RAG
 */

const {
  searchSimilar,
  findSimilarConfigs,
  getStats,
} = require("./vectorStore");
const { embedText, cosineSimilarity } = require("./embeddingService");
const { RAG_CONFIG } = require("./config");

/**
 * Get context for generating a new input configuration
 * Given an input row from a mapping sheet, find similar existing configs
 * Uses semantic search - "First name" matches "First Name", "Name", etc.
 * @param {Object} inputRow - Row from mapping sheet
 * @param {Object} options - Retrieval options
 * @returns {Promise<Object>} Retrieved context with similar configs
 */
async function getConfigContext(inputRow, options = {}) {
  const { topK = 5, minSimilarity = RAG_CONFIG.RETRIEVAL.MIN_SIMILARITY } =
    options;

  // Find similar configurations
  const similar = await findSimilarConfigs(inputRow, {
    topK,
    minSimilarity,
  });

  if (similar.length === 0) {
    return {
      hasContext: false,
      similarConfigs: [],
      contextText: "",
    };
  }

  // Build context text for LLM
  let contextText = "## Similar Configurations from Knowledge Base:\n\n";

  similar.forEach((config, idx) => {
    contextText += `### Example ${idx + 1} (Similarity: ${
      config.similarity
    }):\n`;
    const meta = config.metadata;

    contextText += `- Keyword: ${meta.keyword}\n`;
    contextText += `- Caption: ${meta.keywordcaption}\n`;
    contextText += `- Type: ${meta.keywordtype}\n`;
    contextText += `- Mandatory: ${meta.ismandatory}\n`;

    if (meta.regex) contextText += `- Regex: ${meta.regex}\n`;
    if (meta.minlength) contextText += `- MinLength: ${meta.minlength}\n`;
    if (meta.maxlength) contextText += `- MaxLength: ${meta.maxlength}\n`;
    if (meta.insurer) contextText += `- Insurer: ${meta.insurer}\n`;

    contextText += "\n";
  });

  return {
    hasContext: true,
    similarConfigs: similar,
    contextText,
    topMatch: similar[0],
  };
}

/**
 * Get batch context for multiple input rows
 * Optimized for processing many rows at once
 * @param {Object[]} inputRows - Array of input rows
 * @param {Object} options - Retrieval options
 * @returns {Promise<Map>} Map of row index to context
 */
async function getBatchContext(inputRows, options = {}) {
  const contexts = new Map();

  // Process in parallel with some concurrency control
  const batchSize = 10;

  for (let i = 0; i < inputRows.length; i += batchSize) {
    const batch = inputRows.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map((row, batchIdx) =>
        getConfigContext(row, options)
          .then((ctx) => ({ index: i + batchIdx, context: ctx }))
          .catch(() => ({
            index: i + batchIdx,
            context: { hasContext: false },
          })),
      ),
    );

    batchResults.forEach(({ index, context }) => {
      contexts.set(index, context);
    });
  }

  return contexts;
}

/**
 * Build RAG-enhanced prompt for the LLM
 * @param {Object[]} inputRows - Input rows to process
 * @param {Map} contexts - Retrieved contexts for each row
 * @param {Object} jsonRef - JSON reference for field paths
 * @returns {string} Enhanced prompt with RAG context
 */
function buildRAGPrompt(inputRows, contexts, jsonRef) {
  let prompt = `You are generating input configurations. Use the similar examples from our knowledge base as reference for naming conventions and patterns.\n\n`;

  // Add context from RAG
  const hasAnyContext = Array.from(contexts.values()).some((c) => c.hasContext);

  if (hasAnyContext) {
    prompt += `## IMPORTANT: Follow these patterns from existing configurations:\n\n`;

    // Collect unique patterns
    const patterns = new Map();

    contexts.forEach((ctx, idx) => {
      if (ctx.hasContext && ctx.topMatch) {
        const meta = ctx.topMatch.metadata;
        const inputRow = inputRows[idx];

        // Extract pattern: original field name -> keyword format
        const key = meta.keyword;
        if (key && !patterns.has(key)) {
          patterns.set(key, {
            keyword: meta.keyword,
            keywordcaption: meta.keywordcaption,
            keywordtype: meta.keywordtype,
            ismandatory: meta.ismandatory,
            regex: meta.regex,
            insurer: meta.insurer,
          });
        }
      }
    });

    // Show sample patterns
    const samplePatterns = Array.from(patterns.values()).slice(0, 10);
    prompt += "### Reference Patterns (use similar naming/format):\n";
    prompt += "| Keyword | Caption | Type | Mandatory | Regex |\n";
    prompt += "|---------|---------|------|-----------|-------|\n";

    samplePatterns.forEach((p) => {
      prompt += `| ${p.keyword} | ${p.keywordcaption} | ${p.keywordtype} | ${
        p.ismandatory
      } | ${p.regex || "-"} |\n`;
    });

    prompt += "\n";
  }

  return prompt;
}

/**
 * Check if RAG can provide a direct match (high confidence)
 * If similarity is very high, we might skip LLM altogether
 * @param {Object} context - Retrieved context
 * @param {number} threshold - Confidence threshold (default 0.95)
 * @returns {Object|null} Direct match config or null
 */
function getDirectMatch(context, threshold = 0.95) {
  if (!context.hasContext || !context.topMatch) {
    return null;
  }

  if (parseFloat(context.topMatch.similarity) >= threshold) {
    // High confidence match - can use directly
    return context.topMatch.metadata;
  }

  return null;
}

/**
 * Process rows with RAG enhancement
 * Returns configs that can be used directly vs those needing LLM
 * Uses SEMANTIC similarity - "pan card" from Kotak should match "pan no" from IPRU
 * @param {Object[]} inputRows - Rows to process
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Direct matches and rows needing LLM
 */
async function processWithRAG(inputRows, options = {}) {
  // Use config threshold - lower for cross-insurer semantic matching
  const { directMatchThreshold = RAG_CONFIG.RETRIEVAL.DIRECT_MATCH_THRESHOLD } =
    options;

  // Get contexts for all rows
  const contexts = await getBatchContext(inputRows, options);

  const directMatches = [];
  const needsLLM = [];

  inputRows.forEach((row, idx) => {
    const context = contexts.get(idx);
    const directMatch = getDirectMatch(context, directMatchThreshold);

    if (directMatch) {
      directMatches.push({
        rowIndex: idx,
        config: directMatch,
        similarity: context.topMatch.similarity,
        source: "rag_direct",
      });
    } else {
      needsLLM.push({
        rowIndex: idx,
        row,
        context,
      });
    }
  });

  return {
    directMatches,
    needsLLM,
    contexts,
    stats: {
      total: inputRows.length,
      directMatchCount: directMatches.length,
      needsLLMCount: needsLLM.length,
      ragUtilization:
        ((directMatches.length / inputRows.length) * 100).toFixed(1) + "%",
    },
  };
}

/**
 * Get knowledge base statistics
 */
async function getKnowledgeBaseStats() {
  return getStats();
}

module.exports = {
  getConfigContext,
  getBatchContext,
  buildRAGPrompt,
  getDirectMatch,
  processWithRAG,
  getKnowledgeBaseStats,
};
