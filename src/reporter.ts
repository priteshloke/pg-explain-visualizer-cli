/**
 * PostgreSQL EXPLAIN (ANALYZE, BUFFERS) Visualizer
 * Terminal ASCII tree formatter and standalone interactive HTML report generator.
 */

import { PgParsedPlanNode, PgQueryPlanAuditSummary } from './types.js';

function renderAsciiTree(node: PgParsedPlanNode, depth = 0, isLast = true, prefix = ''): string[] {
  const lines: string[] = [];
  const connector = depth === 0 ? '' : isLast ? '└── ' : '├── ';
  const currentPrefix = prefix + connector;

  const bottleneckTag = node.isBottleneck ? ' 🚨 [BOTTLENECK]' : '';
  const rel = node.relationName ? ` on ${node.relationName}` : '';
  const idx = node.indexName ? ` using ${node.indexName}` : '';
  const time = `${node.actualDurationMs.toFixed(1)}ms (${node.percentageOfTotalTime.toFixed(1)}% exclusive)`;
  const rows = `${node.actualTotalRows.toLocaleString()} rows`;

  lines.push(`${currentPrefix}${node.nodeType}${rel}${idx} — ${time}, ${rows}${bottleneckTag}`);

  if (node.filter) {
    const childIndent = prefix + (depth === 0 ? '   ' : isLast ? '    ' : '│   ');
    lines.push(`${childIndent}Filter: ${node.filter}`);
  }

  const nextPrefix = prefix + (depth === 0 ? '' : isLast ? '    ' : '│   ');
  node.children.forEach((child, idx) => {
    const childIsLast = idx === node.children.length - 1;
    lines.push(...renderAsciiTree(child, depth + 1, childIsLast, nextPrefix));
  });

  return lines;
}

export function formatPlanAuditTerminalReport(summary: PgQueryPlanAuditSummary): string {
  const lines: string[] = [];
  lines.push('================================================================');
  lines.push('🐘 POSTGRESQL EXPLAIN (ANALYZE, BUFFERS) PERFORMANCE AUDIT');
  lines.push('================================================================');
  lines.push(`Query Plan ID:       ${summary.queryId}`);
  lines.push(`Execution Time:      ${summary.executionTimeMs.toFixed(2)} ms`);
  lines.push(`Planning Time:       ${summary.planningTimeMs.toFixed(2)} ms`);
  lines.push(`Estimated Cost:      ${summary.totalCost.toFixed(2)}`);
  lines.push(`Buffer Cache Hit:    ${(summary.overallBufferHitRatio * 100).toFixed(1)}% (${summary.totalSharedHitBlocks.toLocaleString()} hits / ${summary.totalSharedReadBlocks.toLocaleString()} disk reads)`);
  lines.push(`Health Score:        ${summary.healthScore} / 100`);
  lines.push(`Optimization State:  ${summary.verdict}`);
  lines.push('================================================================\n');

  lines.push('QUERY EXECUTION PLAN TREE:');
  lines.push('────────────────────────────────────────────────────────────────');
  lines.push(...renderAsciiTree(summary.rootNode));
  lines.push('────────────────────────────────────────────────────────────────\n');

  if (summary.exceptions.length === 0) {
    lines.push('✅ Query Plan is Optimal: Zero table scans on large relations, 100% cache hits, accurate cardinality.');
    return lines.join('\n');
  }

  lines.push('IDENTIFIED PERFORMANCE BOTTLENECKS & ANTI-PATTERNS:');
  lines.push('────────────────────────────────────────────────────────────────');
  summary.exceptions.forEach((e, idx) => {
    lines.push(`[${e.severity}] #${idx + 1} ${e.type} (${e.nodeType})`);
    lines.push(`   Evidence: ${e.metricEvidence}`);
    lines.push(`   Impact:   ${e.explanation}`);
    lines.push(`   Fix:      ${e.recommendedAction}`);
    if (e.sqlRemediation) {
      lines.push(`   SQL:      ${e.sqlRemediation}`);
    }
    lines.push('────────────────────────────────────────────────────────────────');
  });

  if (summary.indexRecommendations.length > 0) {
    lines.push('\nRECOMMENDED ZERO-DOWNTIME INDEX DDL:');
    lines.push('────────────────────────────────────────────────────────────────');
    summary.indexRecommendations.forEach((rec, idx) => {
      lines.push(`-- Recommendation #${idx + 1}: ${rec.estimatedSpeedup}`);
      lines.push(`-- Rationale: ${rec.rationale}`);
      lines.push(`${rec.ddlStatement}\n`);
    });
  }

  return lines.join('\n');
}

export function generatePlanAuditHtmlReport(summary: PgQueryPlanAuditSummary): string {
  const statusColor =
    summary.verdict === 'OPTIMAL' ? '#22c55e' : summary.verdict === 'NEEDS_OPTIMIZATION' ? '#eab308' : '#ef4444';

  const asciiTree = renderAsciiTree(summary.rootNode).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PostgreSQL Plan Audit: ${summary.queryId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0b0f19; color: #f8fafc; padding: 32px; }
    .container { max-width: 1040px; margin: 0 auto; background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 32px; }
    h1 { color: #38bdf8; margin-top: 0; font-size: 24px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
    .kpi { background: #0b0f19; padding: 18px; border-radius: 8px; border-left: 4px solid #38bdf8; }
    .kpi-val { font-size: 24px; font-weight: bold; color: #f1f5f9; }
    .kpi-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; margin-top: 4px; }
    .tree-box { background: #030712; border: 1px solid #1e293b; border-radius: 8px; padding: 20px; font-family: monospace; font-size: 13px; line-height: 1.6; overflow-x: auto; color: #93c5fd; }
    .alert-card { background: #1e1b4b; border: 1px solid #4338ca; border-radius: 8px; padding: 18px; margin-bottom: 16px; }
    .sql-box { background: #030712; padding: 12px; border-radius: 6px; font-family: monospace; color: #4ade80; margin-top: 8px; border: 1px solid #15803d; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐘 PostgreSQL Query Plan Performance Audit</h1>
    <div style="font-size: 13px; color: #94a3b8; margin-bottom: 20px;">Query Target: <b>${summary.queryId}</b> | Optimization Status: <span style="color:${statusColor}; font-weight:bold;">${summary.verdict}</span></div>

    <div class="kpi-grid">
      <div class="kpi" style="border-color:${statusColor};">
        <div class="kpi-val">${summary.healthScore} / 100</div>
        <div class="kpi-label">Plan Health Score</div>
      </div>
      <div class="kpi">
        <div class="kpi-val">${summary.executionTimeMs.toFixed(1)} ms</div>
        <div class="kpi-label">Execution Time</div>
      </div>
      <div class="kpi">
        <div class="kpi-val">${(summary.overallBufferHitRatio * 100).toFixed(1)}%</div>
        <div class="kpi-label">Buffer Cache Hit Ratio</div>
      </div>
      <div class="kpi">
        <div class="kpi-val">${summary.criticalExceptionsCount}</div>
        <div class="kpi-label">Critical Bottlenecks</div>
      </div>
    </div>

    <h3>Execution Plan Tree</h3>
    <pre class="tree-box">${asciiTree}</pre>

    ${
      summary.exceptions.length > 0
        ? `<h3>Identified Bottlenecks (${summary.exceptions.length})</h3>` +
          summary.exceptions
            .map(
              e => `
        <div class="alert-card" style="border-color: ${e.severity === 'CRITICAL' ? '#ef4444' : '#eab308'}; background: #0f172a;">
          <div style="font-weight:bold; color: ${e.severity === 'CRITICAL' ? '#f87171' : '#facc15'};">[${e.severity}] ${e.type} (${e.nodeType})</div>
          <div style="margin-top: 8px; font-size: 13px; color: #cbd5e1;">${e.explanation}</div>
          <div style="margin-top: 4px; font-size: 12px; color: #94a3b8;"><b>Evidence:</b> ${e.metricEvidence}</div>
          ${e.sqlRemediation ? `<div class="sql-box">${e.sqlRemediation}</div>` : ''}
        </div>`
            )
            .join('')
        : '<p style="color:#4ade80;">✅ Clean Query Plan: No sequential table scans, memory spills, or cardinality skew detected.</p>'
    }

    ${
      summary.indexRecommendations.length > 0
        ? `<h3>Zero-Downtime Index Recommendations</h3>` +
          summary.indexRecommendations
            .map(
              rec => `
        <div style="background:#0f172a; border: 1px solid #10b981; border-radius: 8px; padding: 18px; margin-bottom: 16px;">
          <div style="color: #34d399; font-weight:bold;">⚡ ${rec.suggestedIndexName} (${rec.estimatedSpeedup})</div>
          <div style="font-size: 13px; color: #94a3b8; margin: 6px 0;">${rec.rationale}</div>
          <div class="sql-box">${rec.ddlStatement}</div>
        </div>`
            )
            .join('')
        : ''
    }
  </div>
</body>
</html>`;
}
