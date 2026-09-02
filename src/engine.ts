/**
 * PostgreSQL EXPLAIN (ANALYZE, BUFFERS) Tuning Engine
 * Pure deterministic static analysis of query execution trees.
 */

import {
  PgAntiPatternException,
  PgIndexRecommendation,
  PgParsedPlanNode,
  PgQueryPlanAuditSummary,
  PgRawExplainResult,
  PgRawPlanNode,
} from './types.js';

let nodeIdCounter = 0;

/** Extract columns from PostgreSQL filter expressions */
function extractColumnsFromFilter(filter?: string): string[] {
  if (!filter) return [];
  // Match column identifier patterns before comparison operators
  const matches = filter.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|>=|<=|>|<|IS|IN|LIKE|ILIKE|ANY)/gi);
  if (!matches) return ['id'];

  const cols = new Set<string>();
  for (const m of matches) {
    const colName = m.trim().split(/\s+/)[0]?.toLowerCase();
    if (colName && !['and', 'or', 'not', 'null', 'true', 'false', 'any'].includes(colName)) {
      cols.add(colName);
    }
  }
  return Array.from(cols).slice(0, 3);
}

/** Recursively parse raw plan node into normalized tree with computed metrics */
function parsePlanNode(
  rawNode: PgRawPlanNode,
  totalExecutionTimeMs: number
): PgParsedPlanNode {
  nodeIdCounter++;
  const nodeId = `node-${nodeIdCounter}`;
  const loops = rawNode['Actual Loops'] ?? 1;
  const actualRowsPerLoop = rawNode['Actual Rows'] ?? rawNode['Plan Rows'] ?? 0;
  const actualTotalRows = actualRowsPerLoop * loops;
  const actualDurationMs = (rawNode['Actual Total Time'] ?? 0) * loops;
  const startupCost = rawNode['Startup Cost'] ?? 0;
  const totalCost = rawNode['Total Cost'] ?? 0;
  const planRows = rawNode['Plan Rows'] ?? 1;

  const sharedHit = rawNode['Shared Hit Blocks'] ?? 0;
  const sharedRead = rawNode['Shared Read Blocks'] ?? 0;
  const totalBuffers = sharedHit + sharedRead;
  const bufferHitRatio = totalBuffers > 0 ? sharedHit / totalBuffers : 1.0;

  const rowsRemovedByFilter = (rawNode['Rows Removed by Filter'] ?? 0) * loops;

  // Parse children first
  const children: PgParsedPlanNode[] = [];
  let childrenDurationMs = 0;
  if (Array.isArray(rawNode.Plans)) {
    for (const childRaw of rawNode.Plans) {
      const childParsed = parsePlanNode(childRaw, totalExecutionTimeMs);
      children.push(childParsed);
      childrenDurationMs += childParsed.actualDurationMs;
    }
  }

  // Exclusive time = duration of this node minus child nodes
  const exclusiveDurationMs = Math.max(0, actualDurationMs - childrenDurationMs);
  const percentageOfTotalTime =
    totalExecutionTimeMs > 0 ? (exclusiveDurationMs / totalExecutionTimeMs) * 100 : 0;

  const isBottleneck =
    percentageOfTotalTime >= 25 || exclusiveDurationMs >= 100 || (rawNode['Node Type'] === 'Seq Scan' && actualTotalRows >= 10000);

  const estimationSkewFactor = planRows > 0 ? actualRowsPerLoop / planRows : 1.0;

  return {
    nodeId,
    nodeType: rawNode['Node Type'],
    relationName: rawNode['Relation Name'],
    alias: rawNode['Alias'],
    indexName: rawNode['Index Name'],
    filter: rawNode['Filter'],
    totalCost,
    startupCost,
    planRows,
    actualRows: actualRowsPerLoop,
    actualLoops: loops,
    actualTotalRows,
    actualDurationMs,
    exclusiveDurationMs,
    percentageOfTotalTime,
    estimationSkewFactor,
    sharedHitBlocks: sharedHit,
    sharedReadBlocks: sharedRead,
    bufferHitRatio,
    rowsRemovedByFilter,
    isBottleneck,
    children,
  };
}

/** Recursively inspect nodes for anti-patterns and generate recommendations */
function auditNode(
  node: PgParsedPlanNode,
  rawNodeMap: Map<string, PgRawPlanNode>,
  exceptions: PgAntiPatternException[],
  recommendations: PgIndexRecommendation[]
): void {
  const raw = rawNodeMap.get(node.nodeId);

  // 1. Sequential Scan on Large Relation
  if (
    node.nodeType === 'Seq Scan' &&
    (node.actualTotalRows >= 10000 || node.exclusiveDurationMs >= 40)
  ) {
    const rel = node.relationName || 'unknown_table';
    const filterCols = extractColumnsFromFilter(node.filter);
    const indexName = `idx_${rel}_${filterCols.join('_') || 'lookup'}`;

    const ddl = `CREATE INDEX CONCURRENTLY ${indexName} ON ${rel} (${filterCols.join(', ') || 'id'});`;

    exceptions.push({
      id: `EXC-SEQ-${node.nodeId}`,
      nodeId: node.nodeId,
      type: 'SEQ_SCAN_ON_LARGE_TABLE_CRITICAL',
      severity: 'CRITICAL',
      nodeType: node.nodeType,
      relationName: rel,
      explanation: `Sequential scan executed over ${node.actualTotalRows.toLocaleString()} rows in table '${rel}', consuming ${node.exclusiveDurationMs.toFixed(1)}ms (${node.percentageOfTotalTime.toFixed(1)}% of total query runtime).`,
      metricEvidence: `Rows Scanned: ${node.actualTotalRows.toLocaleString()} | Exclusive Time: ${node.exclusiveDurationMs.toFixed(1)}ms | Filter: ${node.filter || 'None'}`,
      recommendedAction: `Create a composite B-Tree index to convert sequential table scan into high-speed index lookup.`,
      sqlRemediation: ddl,
    });

    recommendations.push({
      relationName: rel,
      suggestedIndexName: indexName,
      columns: filterCols,
      filterCondition: node.filter,
      estimatedSpeedup: '10x - 50x latency reduction',
      ddlStatement: ddl,
      rationale: `Replaces full table scan on ${rel} with indexed logarithmic seek.`,
    });
  }

  // 2. High Filter Removal Ratio
  if (
    node.rowsRemovedByFilter > 0 &&
    node.actualTotalRows > 1000 &&
    node.rowsRemovedByFilter / (node.rowsRemovedByFilter + node.actualTotalRows) >= 0.75
  ) {
    const rel = node.relationName || 'table';
    exceptions.push({
      id: `EXC-FLT-${node.nodeId}`,
      nodeId: node.nodeId,
      type: 'HIGH_FILTER_REMOVAL_RATIO_HIGH',
      severity: 'HIGH',
      nodeType: node.nodeType,
      relationName: rel,
      explanation: `PostgreSQL discarded ${node.rowsRemovedByFilter.toLocaleString()} rows out of ${(node.rowsRemovedByFilter + node.actualTotalRows).toLocaleString()} scanned rows after reading from disk/memory.`,
      metricEvidence: `Discard Ratio: ${((node.rowsRemovedByFilter / (node.rowsRemovedByFilter + node.actualTotalRows)) * 100).toFixed(1)}% | Filter: ${node.filter || 'N/A'}`,
      recommendedAction: `Include the filtered column(s) in the index predicate to eliminate post-read filtering.`,
    });
  }

  // 3. Cardinality Estimation Skew (Stale Statistics / Autovacuum Lag)
  if (
    node.actualRows >= 100 &&
    (node.estimationSkewFactor >= 10.0 || node.estimationSkewFactor <= 0.1)
  ) {
    const rel = node.relationName || 'relation';
    exceptions.push({
      id: `EXC-SKEW-${node.nodeId}`,
      nodeId: node.nodeId,
      type: 'CARDINALITY_ESTIMATION_SKEW_HIGH',
      severity: 'HIGH',
      nodeType: node.nodeType,
      relationName: rel,
      explanation: `Planner estimated ${node.planRows.toLocaleString()} rows but execution processed ${node.actualRows.toLocaleString()} rows (${node.estimationSkewFactor.toFixed(1)}x skew factor), causing suboptimal join strategy selection.`,
      metricEvidence: `Estimated: ${node.planRows} vs Actual: ${node.actualRows} (Skew: ${node.estimationSkewFactor.toFixed(2)}x)`,
      recommendedAction: `Execute ANALYZE ${rel}; to update PostgreSQL optimizer table statistics.`,
      sqlRemediation: `ANALYZE ${rel};`,
    });
  }

  // 4. Hash Join Memory Spill (work_mem exhaustion)
  if (raw && (raw['Hash Batches'] ?? 1) > 1) {
    const batches = raw['Hash Batches'];
    const peakMem = raw['Peak Memory Usage'] ?? 0;
    exceptions.push({
      id: `EXC-MEM-${node.nodeId}`,
      nodeId: node.nodeId,
      type: 'HASH_JOIN_DISK_SPILL_CRITICAL',
      severity: 'CRITICAL',
      nodeType: node.nodeType,
      explanation: `Hash join exceeded allocated work_mem and spilled across ${batches} disk batches (Peak RAM: ${peakMem} kB), causing high temporary file I/O latency.`,
      metricEvidence: `Hash Batches: ${batches} (Spilled to disk) | Peak RAM: ${peakMem} kB`,
      recommendedAction: `Increase work_mem for this session or query: SET work_mem = '64MB';`,
      sqlRemediation: `SET work_mem = '64MB';`,
    });
  }

  // 5. Cold Buffer Disk Read Ratio
  if (node.sharedHitBlocks + node.sharedReadBlocks >= 500 && node.bufferHitRatio < 0.8) {
    exceptions.push({
      id: `EXC-BUF-${node.nodeId}`,
      nodeId: node.nodeId,
      type: 'COLD_BUFFER_READ_RATIO_HIGH',
      severity: 'HIGH',
      nodeType: node.nodeType,
      relationName: node.relationName,
      explanation: `Query suffered cold buffer cache misses with a low hit ratio of ${(node.bufferHitRatio * 100).toFixed(1)}% (${node.sharedReadBlocks.toLocaleString()} disk reads vs ${node.sharedHitBlocks.toLocaleString()} cache hits).`,
      metricEvidence: `Buffer Hit Ratio: ${(node.bufferHitRatio * 100).toFixed(1)}% (Read: ${node.sharedReadBlocks} blocks)`,
      recommendedAction: `Consider increasing shared_buffers or warming up table cache before high-traffic workloads.`,
    });
  }

  // Traverse children
  for (const child of node.children) {
    auditNode(child, rawNodeMap, exceptions, recommendations);
  }
}

/** Flatten raw nodes into map for direct property access */
function buildRawMap(rawNode: PgRawPlanNode, map: Map<string, PgRawPlanNode>, counter = { id: 1 }): void {
  const currentId = `node-${counter.id}`;
  counter.id++;
  map.set(currentId, rawNode);
  if (Array.isArray(rawNode.Plans)) {
    for (const child of rawNode.Plans) {
      buildRawMap(child, map, counter);
    }
  }
}

/** Recursively sum buffer metrics across all nodes */
function sumBuffers(node: PgParsedPlanNode): { hit: number; read: number } {
  let hit = node.sharedHitBlocks;
  let read = node.sharedReadBlocks;
  for (const child of node.children) {
    const childBuf = sumBuffers(child);
    hit += childBuf.hit;
    read += childBuf.read;
  }
  return { hit, read };
}

/**
 * Main Audit Function: Ingests raw JSON explain output and produces comprehensive tuning scorecard.
 */
export function auditExplainPlan(
  rawInput: PgRawExplainResult | PgRawExplainResult[] | PgRawPlanNode | string,
  queryId = 'query-plan-audit'
): PgQueryPlanAuditSummary {
  nodeIdCounter = 0;
  let parsedJson: any = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;

  let explainResult: PgRawExplainResult;
  if (Array.isArray(parsedJson)) {
    explainResult = parsedJson[0] as PgRawExplainResult;
  } else if ('Plan' in parsedJson) {
    explainResult = parsedJson as PgRawExplainResult;
  } else {
    explainResult = { Plan: parsedJson as PgRawPlanNode };
  }

  const rawPlanRoot = explainResult.Plan;
  const executionTimeMs =
    explainResult['Execution Time'] ??
    ((rawPlanRoot['Actual Total Time'] ?? 0) * (rawPlanRoot['Actual Loops'] ?? 1));
  const planningTimeMs = explainResult['Planning Time'] ?? 0;

  // Build raw map
  const rawMap = new Map<string, PgRawPlanNode>();
  buildRawMap(rawPlanRoot, rawMap);

  // Parse tree
  nodeIdCounter = 0;
  const rootNode = parsePlanNode(rawPlanRoot, executionTimeMs);

  const exceptions: PgAntiPatternException[] = [];
  const recommendations: PgIndexRecommendation[] = [];

  auditNode(rootNode, rawMap, exceptions, recommendations);

  const totalBuf = sumBuffers(rootNode);
  const overallBufferHitRatio =
    totalBuf.hit + totalBuf.read > 0 ? totalBuf.hit / (totalBuf.hit + totalBuf.read) : 1.0;

  // Deduct penalty points
  const criticalCount = exceptions.filter(e => e.severity === 'CRITICAL').length;
  const highCount = exceptions.filter(e => e.severity === 'HIGH').length;

  let healthScore = 100;
  healthScore -= criticalCount * 30;
  healthScore -= highCount * 15;
  healthScore = Math.max(0, healthScore);

  let verdict: 'OPTIMAL' | 'NEEDS_OPTIMIZATION' | 'CRITICAL_BOTTLENECK' = 'OPTIMAL';
  if (criticalCount > 0 || healthScore < 50) {
    verdict = 'CRITICAL_BOTTLENECK';
  } else if (highCount > 0 || healthScore < 85) {
    verdict = 'NEEDS_OPTIMIZATION';
  }

  return {
    queryId,
    planningTimeMs,
    executionTimeMs,
    totalCost: rootNode.totalCost,
    totalSharedHitBlocks: totalBuf.hit,
    totalSharedReadBlocks: totalBuf.read,
    overallBufferHitRatio,
    healthScore,
    verdict,
    criticalExceptionsCount: criticalCount,
    highExceptionsCount: highCount,
    rootNode,
    exceptions,
    indexRecommendations: recommendations,
  };
}
