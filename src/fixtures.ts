/**
 * PostgreSQL EXPLAIN (ANALYZE, BUFFERS) Benchmark Fixtures
 * Realistic execution plans exercising sequential scans, memory spills, skew, and clean indexes.
 */

import { PgRawExplainResult } from './types.js';

// 1. Slow Unindexed Sequential Scan on Orders Table (245ms, 120,000 rows)
export const MOCK_SLOW_SEQ_SCAN_PLAN: PgRawExplainResult = {
  Plan: {
    'Node Type': 'Seq Scan',
    'Relation Name': 'orders',
    'Schema': 'public',
    'Alias': 'o',
    'Startup Cost': 0.0,
    'Total Cost': 14850.0,
    'Plan Rows': 8500,
    'Plan Width': 128,
    'Actual Startup Time': 0.045,
    'Actual Total Time': 245.8,
    'Actual Rows': 8420,
    'Actual Loops': 1,
    'Shared Hit Blocks': 240,
    'Shared Read Blocks': 12500,
    'Filter': "(status = 'PENDING'::text AND created_at >= '2026-01-01'::date)",
    'Rows Removed by Filter': 111580,
  },
  'Planning Time': 1.45,
  'Execution Time': 247.3,
};

// 2. Hash Join with work_mem Disk Spill (4 Batches, Temp I/O)
export const MOCK_HASH_JOIN_DISK_SPILL_PLAN: PgRawExplainResult = {
  Plan: {
    'Node Type': 'Hash Join',
    'Join Type': 'Inner',
    'Startup Cost': 4500.0,
    'Total Cost': 18900.0,
    'Plan Rows': 45000,
    'Plan Width': 256,
    'Actual Startup Time': 35.2,
    'Actual Total Time': 310.5,
    'Actual Rows': 42100,
    'Actual Loops': 1,
    'Hash Cond': '(o.customer_id = c.id)',
    'Hash Batches': 4,
    'Hash Buckets': 16384,
    'Peak Memory Usage': 32768,
    'Plans': [
      {
        'Node Type': 'Seq Scan',
        'Relation Name': 'orders',
        'Alias': 'o',
        'Startup Cost': 0.0,
        'Total Cost': 8500.0,
        'Plan Rows': 45000,
        'Actual Startup Time': 0.03,
        'Actual Total Time': 85.4,
        'Actual Rows': 45000,
        'Actual Loops': 1,
        'Shared Hit Blocks': 1200,
        'Shared Read Blocks': 450,
      },
      {
        'Node Type': 'Hash',
        'Startup Cost': 3200.0,
        'Total Cost': 3200.0,
        'Plan Rows': 25000,
        'Actual Startup Time': 34.8,
        'Actual Total Time': 34.8,
        'Actual Rows': 25000,
        'Actual Loops': 1,
        'Plans': [
          {
            'Node Type': 'Seq Scan',
            'Relation Name': 'customers',
            'Alias': 'c',
            'Startup Cost': 0.0,
            'Total Cost': 3200.0,
            'Plan Rows': 25000,
            'Actual Startup Time': 0.02,
            'Actual Total Time': 28.2,
            'Actual Rows': 25000,
            'Actual Loops': 1,
            'Shared Hit Blocks': 850,
            'Shared Read Blocks': 120,
          },
        ],
      },
    ],
  },
  'Planning Time': 2.1,
  'Execution Time': 314.2,
};

// 3. Stale Statistics / Cardinality Estimation Skew (Estimated 20 rows vs Actual 15,000 rows)
export const MOCK_CARDINALITY_SKEW_PLAN: PgRawExplainResult = {
  Plan: {
    'Node Type': 'Seq Scan',
    'Relation Name': 'audit_logs',
    'Alias': 'al',
    'Startup Cost': 0.0,
    'Total Cost': 1200.0,
    'Plan Rows': 20,
    'Actual Startup Time': 0.05,
    'Actual Total Time': 68.4,
    'Actual Rows': 15200,
    'Actual Loops': 1,
    'Filter': "(severity = 'CRITICAL'::text)",
    'Rows Removed by Filter': 54000,
  },
  'Planning Time': 0.8,
  'Execution Time': 70.1,
};

// 4. Optimal Fast B-Tree Index Scan (1.2ms, 100% Buffer Cache Hit)
export const MOCK_OPTIMAL_INDEX_SCAN_PLAN: PgRawExplainResult = {
  Plan: {
    'Node Type': 'Index Scan',
    'Relation Name': 'orders',
    'Index Name': 'idx_orders_customer_id',
    'Alias': 'o',
    'Startup Cost': 0.42,
    'Total Cost': 8.44,
    'Plan Rows': 4,
    'Plan Width': 64,
    'Actual Startup Time': 0.021,
    'Actual Total Time': 1.15,
    'Actual Rows': 4,
    'Actual Loops': 1,
    'Index Cond': '(customer_id = 98124)',
    'Shared Hit Blocks': 4,
    'Shared Read Blocks': 0,
  },
  'Planning Time': 0.35,
  'Execution Time': 1.22,
};

export const MOCK_EXPLAIN_PLANS = [
  { name: 'Slow Unindexed Scan on Orders (245ms)', plan: MOCK_SLOW_SEQ_SCAN_PLAN },
  { name: 'Hash Join with work_mem Disk Spill', plan: MOCK_HASH_JOIN_DISK_SPILL_PLAN },
  { name: 'Cardinality Skew on Audit Logs', plan: MOCK_CARDINALITY_SKEW_PLAN },
  { name: 'Optimal Index Scan on Orders (1.2ms)', plan: MOCK_OPTIMAL_INDEX_SCAN_PLAN },
];
