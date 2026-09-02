/**
 * PostgreSQL EXPLAIN (ANALYZE, BUFFERS) Visualizer & Tuning Advisor
 * Types and schema definitions.
 */

export type PgSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type PgAntiPatternType =
  | 'SEQ_SCAN_ON_LARGE_TABLE_CRITICAL'       // Sequential scan on large relation (>10k rows or >50ms)
  | 'CARDINALITY_ESTIMATION_SKEW_HIGH'       // Actual vs estimated rows mismatch >= 10x (stale stats)
  | 'HASH_JOIN_DISK_SPILL_CRITICAL'          // Hash batches > 1 (work_mem exhaustion / temp files)
  | 'HIGH_FILTER_REMOVAL_RATIO_HIGH'         // >80% rows discarded by filter (missing index)
  | 'COLD_BUFFER_READ_RATIO_HIGH'            // Buffer cache hit ratio < 80% (heavy disk I/O)
  | 'SAFE_OPTIMAL_PLAN';

export interface PgRawPlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Schema'?: string;
  'Alias'?: string;
  'Startup Cost': number;
  'Total Cost': number;
  'Plan Rows': number;
  'Plan Width'?: number;
  'Actual Startup Time'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'Shared Dirtied Blocks'?: number;
  'Shared Written Blocks'?: number;
  'Local Hit Blocks'?: number;
  'Local Read Blocks'?: number;
  'Filter'?: string;
  'Rows Removed by Filter'?: number;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Hash Cond'?: string;
  'Join Type'?: string;
  'Hash Batches'?: number;
  'Hash Buckets'?: number;
  'Peak Memory Usage'?: number; // in kB
  'Plans'?: PgRawPlanNode[];
  [key: string]: any;
}

export interface PgRawExplainResult {
  Plan: PgRawPlanNode;
  'Planning Time'?: number;
  'Execution Time'?: number;
  'Planning'?: {
    'Shared Hit Blocks'?: number;
    'Shared Read Blocks'?: number;
  };
  'Triggers'?: any[];
  [key: string]: any;
}

export interface PgParsedPlanNode {
  nodeId: string;
  nodeType: string;
  relationName?: string;
  alias?: string;
  indexName?: string;
  filter?: string;
  totalCost: number;
  startupCost: number;
  planRows: number;
  actualRows: number;
  actualLoops: number;
  actualTotalRows: number;
  actualDurationMs: number;
  exclusiveDurationMs: number;
  percentageOfTotalTime: number;
  estimationSkewFactor: number;
  sharedHitBlocks: number;
  sharedReadBlocks: number;
  bufferHitRatio: number;
  rowsRemovedByFilter: number;
  isBottleneck: boolean;
  children: PgParsedPlanNode[];
}

export interface PgAntiPatternException {
  id: string;
  nodeId: string;
  type: PgAntiPatternType;
  severity: PgSeverity;
  nodeType: string;
  relationName?: string;
  explanation: string;
  metricEvidence: string;
  recommendedAction: string;
  sqlRemediation?: string;
}

export interface PgIndexRecommendation {
  relationName: string;
  suggestedIndexName: string;
  columns: string[];
  filterCondition?: string;
  estimatedSpeedup: string;
  ddlStatement: string;
  rationale: string;
}

export interface PgQueryPlanAuditSummary {
  queryId: string;
  planningTimeMs: number;
  executionTimeMs: number;
  totalCost: number;
  totalSharedHitBlocks: number;
  totalSharedReadBlocks: number;
  overallBufferHitRatio: number;
  healthScore: number; // 0 - 100
  verdict: 'OPTIMAL' | 'NEEDS_OPTIMIZATION' | 'CRITICAL_BOTTLENECK';
  criticalExceptionsCount: number;
  highExceptionsCount: number;
  rootNode: PgParsedPlanNode;
  exceptions: PgAntiPatternException[];
  indexRecommendations: PgIndexRecommendation[];
}
