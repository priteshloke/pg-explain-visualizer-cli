#!/usr/bin/env node
/**
 * PostgreSQL EXPLAIN (ANALYZE, BUFFERS) CLI Visualizer
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditExplainPlan } from './engine.js';
import { MOCK_EXPLAIN_PLANS } from './fixtures.js';
import {
  formatPlanAuditTerminalReport,
  generatePlanAuditHtmlReport,
} from './reporter.js';

const program = new Command();

program
  .name('pg-explain')
  .description('PostgreSQL EXPLAIN (ANALYZE, BUFFERS) Visualizer, Bottleneck Detector & Index Advisor')
  .option('-i, --input <path>', 'Path to PostgreSQL EXPLAIN JSON output file')
  .option('--demo', 'Run audit against built-in slow query and memory spill benchmark fixtures', false)
  .option('-o, --output <path>', 'Path to export interactive standalone HTML audit report')
  .option('--json', 'Output structured audit metrics as raw JSON', false)
  .action(async (options) => {
    let summaries = [];

    if (options.demo) {
      summaries = MOCK_EXPLAIN_PLANS.map(f => auditExplainPlan(f.plan, f.name));
    } else if (options.input) {
      const p = resolve(process.cwd(), options.input);
      if (!existsSync(p)) {
        console.error(`❌ Input file not found: ${p}`);
        process.exit(1);
      }
      const rawContent = readFileSync(p, 'utf-8');
      const summary = auditExplainPlan(rawContent, options.input);
      summaries = [summary];
    } else {
      console.error('❌ Provide an input file via -i <explain.json> or run with --demo');
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(summaries, null, 2));
      return;
    }

    for (const s of summaries) {
      console.log(formatPlanAuditTerminalReport(s));
      console.log('');
    }

    if (options.output) {
      const outPath = resolve(process.cwd(), options.output);
      const combinedHtml = summaries.map(s => generatePlanAuditHtmlReport(s)).join('\n<!-- NEXT REPORT -->\n');
      writeFileSync(outPath, combinedHtml, 'utf-8');
      console.log(`\n📄 Interactive HTML report generated at: ${outPath}`);
    }
  });

program.parse(process.argv);
