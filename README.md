# PostgreSQL EXPLAIN Visualizer & Tuning Advisor 🐘⚡

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%20ESM-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/priteshloke/pg-explain-visualizer-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/priteshloke/pg-explain-visualizer-cli/actions/workflows/ci.yml)

> **Deterministic PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` execution plan visualizer, bottleneck detector, and zero-downtime index advisor.**  
> Transforms nested, multi-thousand-line JSON execution plans into actionable terminal ASCII trees, buffer cache insights, and copy-paste `CREATE INDEX CONCURRENTLY` DDL.

---

## 📌 The Problem: Why EXPLAIN Plans Are Hard to Read

Production PostgreSQL queries degrade silently when table sizes cross hundreds of thousands of rows. Inspecting raw `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` outputs is painful:

1. **Hidden Sequential Scans:** Full table scans buried inside deeply nested subqueries or CTEs.
2. **Buffer Cache Starvation:** High `Shared Read Blocks` forcing slow random disk I/O instead of hitting `shared_buffers` RAM.
3. **`work_mem` Disk Spills:** Hash Joins and Sorts spilling to temporary disk batches because `work_mem` was sized too small.
4. **Cardinality Skew:** Huge gaps between planner estimates (`Plan Rows`) and reality (`Actual Rows`) caused by stale table statistics or autovacuum lag.

**`pg-explain-visualizer-cli`** parses the plan tree, isolates exclusive node runtimes, highlights bottlenecks, and writes the exact zero-downtime index creation DDL.

---

## 🏗️ Architecture & Analysis Pipeline

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                    POSTGRESQL QUERY PLAN VISUALIZATION PIPELINE                        │
├──────────────────────────┬───────────────────────────┬─────────────────────────────────┤
│ 📥 PLAN INGESTION        │ 🔬 BOTTLENECK FORENSICS   │ 🚀 ACTIONABLE TUNING OUTPUT     │
├──────────────────────────┼───────────────────────────┼─────────────────────────────────┤
│ • EXPLAIN (ANALYZE,      │ • Exclusive Runtime Math  │ • Visual Terminal ASCII Tree    │
│   BUFFERS, FORMAT JSON)  │ • Buffer Cache Hit Ratio  │ • 0–100 Plan Health Score       │
│ • Raw JSON / Text Tree   │ • Cardinality Skew Metric │ • CREATE INDEX CONCURRENTLY DDL │
│ • Multi-Node Subqueries  │ • Hash Spill Detection    │ • Standalone Interactive HTML   │
└──────────────────────────┴───────────────────────────┴─────────────────────────────────┘
```

---

## ⚡ Detected Performance Anti-Patterns

| Anti-Pattern | Severity | Trigger Threshold | Recommended Action |
|---|---|---|---|
| `SEQ_SCAN_ON_LARGE_TABLE_CRITICAL` | `CRITICAL` | Seq scan on $\ge 10,000$ rows or $\ge 40\text{ms}$ | Auto-generates `CREATE INDEX CONCURRENTLY` |
| `HASH_JOIN_DISK_SPILL_CRITICAL` | `CRITICAL` | `Hash Batches > 1` (temp file I/O) | Increases session `work_mem` |
| `HIGH_FILTER_REMOVAL_RATIO_HIGH` | `HIGH` | $\ge 75\%$ of scanned rows discarded | Adds filtered columns to index predicate |
| `CARDINALITY_ESTIMATION_SKEW_HIGH` | `HIGH` | Actual vs Estimated rows skew $\ge 10\times$ | Suggests `ANALYZE <table>;` |
| `COLD_BUFFER_READ_RATIO_HIGH` | `HIGH` | Buffer cache hit ratio $< 80\%$ | Cache warming / `shared_buffers` tuning |
| `SAFE_OPTIMAL_PLAN` | `INFO` | Pure index scans, 100% cache hits | No action required |

---

## 🚀 Quickstart

### Prerequisites
- Node.js v20.x or higher
- npm

### Installation
```bash
# Clone repository
git clone https://github.com/priteshloke/pg-explain-visualizer-cli.git
cd pg-explain-visualizer-cli

# Install dependencies
npm install
```

### Run Demo Benchmarks
Analyze 4 built-in plans (Sequential Scan, Hash Spill, Cardinality Skew, and Optimal Index Scan):
```bash
npm run demo
```

### Analyze Your Own PostgreSQL Query Plan
Export your query plan from `psql` or pgAdmin:
```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT * FROM orders WHERE status = 'PENDING' AND created_at >= '2026-01-01';
```

Save the JSON output to `plan.json` and run:
```bash
# Visual Terminal Report
npx tsx src/cli.ts -i plan.json

# Generate Standalone Interactive HTML Report
npx tsx src/cli.ts -i plan.json -o audit-report.html
```

---

## 🧪 Automated Test Suite

```bash
npm test
```

```
✔ detects SEQ_SCAN_ON_LARGE_TABLE_CRITICAL and generates CREATE INDEX CONCURRENTLY DDL
✔ detects HASH_JOIN_DISK_SPILL_CRITICAL when hash batches exceed 1
✔ detects CARDINALITY_ESTIMATION_SKEW_HIGH when planner row estimate deviates >= 10x
✔ approves fast index scan with 100% buffer cache hits with OPTIMAL verdict
✔ processes full suite of benchmark plans without errors
```

---

## 🧑‍💻 Author

**Pritesh Loke**  
- GitHub: [@priteshloke](https://github.com/priteshloke)  
- 19 Years Software Engineering, Database Optimization & Systems Architecture

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
