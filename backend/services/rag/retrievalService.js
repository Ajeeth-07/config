/**
 * Retrieval Service - Parent-Child Aware
 *
 * After finding similar child documents, enriches results with parent (LOB)
 * context so the LLM understands the domain the reference patterns come from.
 */

const {
  searchSimilar,
  findSimilarConfigs,
  getStats,
  getParent,
} = require("./vectorStore");
const { RAG_CONFIG } = require("./config");

/**
 * Get context for generating a new input configuration.
 * Now returns parent LOB context alongside child matches.
 *
 * @param {Object} inputRow - Row from mapping sheet
 * @param {Object} options
 * @returns {Promise<Object>} Retrieved context
 */
async function getConfigContext(inputRow, options = {}) {
  const { topK = 5, minSimilarity = RAG_CONFIG.RETRIEVAL.MIN_SIMILARITY } =
    options;

  const similar = await findSimilarConfigs(inputRow, {
    topK,
    minSimilarity,
    lob: options.lob || null,
  });

  if (similar.length === 0) {
    return {
      hasContext: false,
      similarConfigs: [],
      contextText: "",
      parentContext: null,
    };
  }

  // Collect unique parents from results
  const parentIds = new Set();
  similar.forEach((s) => {
    if (s.metadata && s.metadata.parentId) parentIds.add(s.metadata.parentId);
  });

  // Fetch parent context
  const parents = {};
  parentIds.forEach((pid) => {
    const p = getParent(pid);
    if (p) parents[pid] = p;
  });

  // Build context text with LOB header
  let contextText = "";

  // Add parent LOB context section if available
  if (Object.keys(parents).length > 0) {
    contextText += "## LOB Context (Line of Business):\n\n";
    Object.values(parents).forEach((p) => {
      const meta = p.metadata;
      contextText += `- LOB: ${meta.lob} | Insurer: ${meta.insurer} | Product: ${meta.product}\n`;
      contextText += `  Fields: ${meta.fieldCount}`;
      if (meta.fieldCategories && meta.fieldCategories.length > 0) {
        contextText += ` | Categories: ${meta.fieldCategories.join(", ")}`;
      }
      contextText += "\n";
      if (meta.sampleKeywords && meta.sampleKeywords.length > 0) {
        contextText += `  Sample keywords: ${meta.sampleKeywords
          .slice(0, 10)
          .join(", ")}\n`;
      }
    });
    contextText += "\n";
  }

  // Add child matches
  contextText += "## Similar Configurations from Knowledge Base:\n\n";

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
    if (meta.lob) contextText += `- LOB: ${meta.lob}\n`;
    if (config.parent) {
      contextText += `- Parent: ${config.parent.lob}/${config.parent.insurer}/${config.parent.product}\n`;
    }

    contextText += "\n";
  });

  return {
    hasContext: true,
    similarConfigs: similar,
    contextText,
    topMatch: similar[0],
    parentContext: parents,
  };
}

/**
 * Get batch context for multiple input rows
 */
async function getBatchContext(inputRows, options = {}) {
  const contexts = new Map();
  const batchSize = 20;

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
 * Build RAG-enhanced prompt for the LLM, now with LOB context
 */
function buildRAGPrompt(inputRows, contexts, jsonRef) {
  let prompt = `You are generating input configurations. Use the similar examples from our knowledge base as reference for naming conventions and patterns.\n\n`;

  const hasAnyContext = Array.from(contexts.values()).some((c) => c.hasContext);

  if (hasAnyContext) {
    // Collect unique parent LOB contexts
    const lobContexts = new Map();
    contexts.forEach((ctx) => {
      if (ctx.parentContext) {
        Object.entries(ctx.parentContext).forEach(([pid, p]) => {
          if (!lobContexts.has(pid)) lobContexts.set(pid, p.metadata);
        });
      }
    });

    // Add LOB context section
    if (lobContexts.size > 0) {
      prompt += `## LOB Context:\n`;
      lobContexts.forEach((meta, pid) => {
        prompt += `- ${meta.lob} insurance (${meta.insurer}/${meta.product}): ${meta.fieldCount} fields`;
        if (meta.fieldCategories && meta.fieldCategories.length > 0) {
          prompt += ` in categories: ${meta.fieldCategories.join(", ")}`;
        }
        prompt += "\n";
      });
      prompt += "\n";
    }

    prompt += `## IMPORTANT: Follow these patterns from existing configurations:\n\n`;

    // Collect unique patterns
    const patterns = new Map();

    contexts.forEach((ctx, idx) => {
      if (ctx.hasContext && ctx.topMatch) {
        const meta = ctx.topMatch.metadata;
        const key = meta.keyword;
        if (key && !patterns.has(key)) {
          patterns.set(key, {
            keyword: meta.keyword,
            keywordcaption: meta.keywordcaption,
            keywordtype: meta.keywordtype,
            ismandatory: meta.ismandatory,
            regex: meta.regex,
            insurer: meta.insurer,
            lob: meta.lob || "general",
          });
        }
      }
    });

    const samplePatterns = Array.from(patterns.values()).slice(0, 10);
    prompt += "### Reference Patterns (use similar naming/format):\n";
    prompt += "| Keyword | Caption | Type | Mandatory | LOB | Regex |\n";
    prompt += "|---------|---------|------|-----------|-----|-------|\n";

    samplePatterns.forEach((p) => {
      prompt += `| ${p.keyword} | ${p.keywordcaption} | ${p.keywordtype} | ${
        p.ismandatory
      } | ${p.lob} | ${p.regex || "-"} |\n`;
    });

    prompt += "\n";
  }

  return prompt;
}

/**
 * Check if RAG can provide a direct match (high confidence)
 */
function getDirectMatch(context, threshold = 0.95) {
  if (!context.hasContext || !context.topMatch) return null;

  if (parseFloat(context.topMatch.similarity) >= threshold) {
    return context.topMatch.metadata;
  }

  return null;
}

/**
 * Process rows with RAG enhancement (parent-child aware)
 */
async function processWithRAG(inputRows, options = {}) {
  const { directMatchThreshold = RAG_CONFIG.RETRIEVAL.DIRECT_MATCH_THRESHOLD } =
    options;

  const contexts = await getBatchContext(inputRows, options);

  const directMatches = [];
  const needsLLM = [];
  let totalWithContext = 0;
  let maxSimilarity = 0;
  let minSimilarity = 1;

  // Track parent LOB distribution for debugging
  const parentHits = {};

  inputRows.forEach((row, idx) => {
    const context = contexts.get(idx);

    if (context?.hasContext && context?.topMatch) {
      totalWithContext++;
      const sim = parseFloat(context.topMatch.similarity);
      if (sim > maxSimilarity) maxSimilarity = sim;
      if (sim < minSimilarity) minSimilarity = sim;

      // Track which parents were matched
      if (context.topMatch.metadata?.parentId) {
        const pid = context.topMatch.metadata.parentId;
        parentHits[pid] = (parentHits[pid] || 0) + 1;
      }
    }

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

  // Debug logging
  if (totalWithContext > 0) {
    console.log(
      `    RAG Similarity: ${totalWithContext}/${inputRows.length} rows have KB matches ` +
        `(range: ${minSimilarity.toFixed(3)}-${maxSimilarity.toFixed(3)}, ` +
        `direct threshold: ${directMatchThreshold})`,
    );
    const parentSummary = Object.entries(parentHits)
      .map(([pid, count]) => `${pid}:${count}`)
      .join(", ");
    if (parentSummary) {
      console.log(`    RAG Parents matched: ${parentSummary}`);
    }
  } else {
    console.log(
      `    RAG: No similar configs found in knowledge base for any row in this batch`,
    );
  }

  return {
    directMatches,
    needsLLM,
    contexts,
    stats: {
      total: inputRows.length,
      directMatchCount: directMatches.length,
      needsLLMCount: needsLLM.length,
      totalWithContext,
      maxSimilarity: maxSimilarity.toFixed(4),
      minSimilarity: totalWithContext > 0 ? minSimilarity.toFixed(4) : "N/A",
      ragUtilization:
        ((directMatches.length / inputRows.length) * 100).toFixed(1) + "%",
      parentHits,
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
