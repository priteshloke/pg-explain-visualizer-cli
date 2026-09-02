import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditExplainPlan } from '../engine.js';
import { PgRawExplainResult } from '../types.js';

describe('🐘 PostgreSQL EXPLAIN Visualizer & Tuning Engine (Unit Tests)', () => {
  it('detects SEQ_SCAN_ON_LARGE_TABLE_CRITICAL and generates CREATE INDEX CONCURRENTLY DDL', () => {
    const rawPlan: PgRawExplainResult = {
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'transactions',
        'Startup Cost': 0.0,
        'Total Cost': 25000.0,
        'Plan Rows': 50000,
        'Actual Total Time': 185.4,
        'Actual Rows': 50000,
        'Actual Loops': 1,
        'Filter': "(merchant_id = 4521 AND status = 'SETTLED'::text)",
      },
      'Execution Time': 186.2,
    };

    const summary = auditExplainPlan(rawPlan, 'test-seq-scan');

    assert.equal(summary.verdict, 'CRITICAL_BOTTLENECK');
    assert.equal(summary.criticalExceptionsCount, 1);

    const seqEx = summary.exceptions.find(e => e.type === 'SEQ_SCAN_ON_LARGE_TABLE_CRITICAL');
    assert.ok(seqEx, 'Should detect sequential scan on large table');
    assert.equal(seqEx.severity, 'CRITICAL');
    assert.ok(seqEx.sqlRemediation?.includes('CREATE INDEX CONCURRENTLY'));

    assert.ok(summary.indexRecommendations.length >= 1);
    assert.equal(summary.indexRecommendations[0]?.relationName, 'transactions');
  });

  it('detects HASH_JOIN_DISK_SPILL_CRITICAL when hash batches exceed 1 due to work_mem exhaustion', () => {
    const rawPlan: PgRawExplainResult = {
      Plan: {
        'Node Type': 'Hash Join',
        'Startup Cost': 1200.0,
        'Total Cost': 15000.0,
        'Plan Rows': 30000,
        'Actual Total Time': 210.0,
        'Actual Rows': 30000,
        'Actual Loops': 1,
        'Hash Batches': 4,
        'Peak Memory Usage': 16384,
      },
      'Execution Time': 212.0,
    };

    const summary = auditExplainPlan(rawPlan, 'test-hash-spill');

    const spillEx = summary.exceptions.find(e => e.type === 'HASH_JOIN_DISK_SPILL_CRITICAL');
    assert.ok(spillEx, 'Should detect hash join disk spill');
    assert.equal(spillEx.severity, 'CRITICAL');
    assert.ok(spillEx.sqlRemediation?.includes('work_mem'));
  });

  it('detects CARDINALITY_ESTIMATION_SKEW_HIGH when planner row estimate deviates >= 10x from actual', () => {
    const rawPlan: PgRawExplainResult = {
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'orders',
        'Startup Cost': 0.0,
        'Total Cost': 500.0,
        'Plan Rows': 10,
        'Actual Total Time': 45.0,
        'Actual Rows': 5000,
        'Actual Loops': 1,
      },
      'Execution Time': 46.0,
    };

    const summary = auditExplainPlan(rawPlan, 'test-cardinality-skew');

    const skewEx = summary.exceptions.find(e => e.type === 'CARDINALITY_ESTIMATION_SKEW_HIGH');
    assert.ok(skewEx, 'Should detect cardinality skew');
    assert.equal(skewEx.severity, 'HIGH');
    assert.ok(skewEx.sqlRemediation?.includes('ANALYZE orders;'));
  });

  it('approves fast index scan with 100% buffer cache hits with OPTIMAL verdict and 100 score', () => {
    const rawPlan: PgRawExplainResult = {
      Plan: {
        'Node Type': 'Index Scan',
        'Relation Name': 'users',
        'Index Name': 'idx_users_email',
        'Startup Cost': 0.28,
        'Total Cost': 8.30,
        'Plan Rows': 1,
        'Actual Total Time': 0.08,
        'Actual Rows': 1,
        'Actual Loops': 1,
        'Shared Hit Blocks': 3,
        'Shared Read Blocks': 0,
      },
      'Execution Time': 0.12,
    };

    const summary = auditExplainPlan(rawPlan, 'test-optimal-plan');

    assert.equal(summary.verdict, 'OPTIMAL');
    assert.equal(summary.healthScore, 100);
    assert.equal(summary.exceptions.length, 0);
    assert.equal(summary.criticalExceptionsCount, 0);
    assert.equal(summary.overallBufferHitRatio, 1.0);
  });
});
