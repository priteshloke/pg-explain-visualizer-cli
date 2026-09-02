import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditExplainPlan } from '../engine.js';
import {
  MOCK_SLOW_SEQ_SCAN_PLAN,
  MOCK_HASH_JOIN_DISK_SPILL_PLAN,
  MOCK_CARDINALITY_SKEW_PLAN,
  MOCK_OPTIMAL_INDEX_SCAN_PLAN,
  MOCK_EXPLAIN_PLANS,
} from '../fixtures.js';

describe('🐘 PostgreSQL EXPLAIN Benchmark Fixtures (Batch Suite)', () => {
  it('correctly evaluates slow unindexed sequential scan fixture and identifies missing index', () => {
    const summary = auditExplainPlan(MOCK_SLOW_SEQ_SCAN_PLAN, 'orders-seq-scan');
    assert.equal(summary.verdict, 'CRITICAL_BOTTLENECK');
    assert.ok(summary.exceptions.some(e => e.type === 'SEQ_SCAN_ON_LARGE_TABLE_CRITICAL'));
    assert.ok(summary.indexRecommendations.length > 0);
  });

  it('correctly audits hash join disk spill fixture and flags work_mem memory exhaustion', () => {
    const summary = auditExplainPlan(MOCK_HASH_JOIN_DISK_SPILL_PLAN, 'hash-join-spill');
    assert.equal(summary.verdict, 'CRITICAL_BOTTLENECK');
    assert.ok(summary.exceptions.some(e => e.type === 'HASH_JOIN_DISK_SPILL_CRITICAL'));
  });

  it('correctly identifies cardinality skew on stale table stats', () => {
    const summary = auditExplainPlan(MOCK_CARDINALITY_SKEW_PLAN, 'audit-logs-skew');
    assert.ok(summary.exceptions.some(e => e.type === 'CARDINALITY_ESTIMATION_SKEW_HIGH'));
  });

  it('approves optimal index scan with 100% buffer hit ratio and zero exceptions', () => {
    const summary = auditExplainPlan(MOCK_OPTIMAL_INDEX_SCAN_PLAN, 'orders-index-scan');
    assert.equal(summary.verdict, 'OPTIMAL');
    assert.equal(summary.healthScore, 100);
    assert.equal(summary.exceptions.length, 0);
  });

  it('processes full suite of 4 benchmark plans without errors', () => {
    const summaries = MOCK_EXPLAIN_PLANS.map(f => auditExplainPlan(f.plan, f.name));
    assert.equal(summaries.length, 4);
  });
});
