# 🐘 PostgreSQL Query Plan Tuning & Index Optimization — Deep-Dive Notebook

> **Project:** [github.com/priteshloke/pg-explain-visualizer-cli](https://github.com/priteshloke/pg-explain-visualizer-cli)  
> **Stack:** Node.js · TypeScript · Pure ESM · PostgreSQL Internals · Commander CLI · node:test  
> **Use:** Master PostgreSQL query planning internals, buffer cache mechanics, zero-downtime indexing, and performance tuning; defend every architectural decision 3 levels deep in Staff/Principal Backend and Database Architect interviews.  
> **Upload directly to NotebookLM as a canonical source.**

**Verified on 2026-09-02:** Strict TypeScript check (`tsc -p tsconfig.json`) → **0 errors**; Automated Test Suite (`npm test`) → **9/9 passing (100% green)** across unit rules and batch benchmark fixtures.

---

## Part 1 — The Mental Model: How PostgreSQL Executes Queries

### 1.1 The Lifecycle of a SQL Query
When an application sends a SQL query to PostgreSQL, it passes through 4 distinct stages:
1. **Parser & Lexer:** Validates SQL syntax and builds a raw parse tree.
2. **Rewriter:** Applies view definitions and row-level security rules.
3. **Planner & Optimizer (The Cost Engine):** Evaluates possible execution trees (Seq Scan vs Index Scan vs Bitmap Index Scan, Nested Loop vs Hash Join vs Merge Join) and selects the path with the lowest estimated **Cost Units**.
4. **Executor:** Executes the selected plan node-by-node and returns rows to the client.

### 1.2 `EXPLAIN` vs `EXPLAIN ANALYZE` vs `BUFFERS`
* `EXPLAIN`: Shows what the planner **predicts** will happen based on table statistics (`pg_statistic`). Zero execution.
* `EXPLAIN (ANALYZE)`: Actually **executes** the query and records exact runtimes (`Actual Total Time`) and row counts (`Actual Rows`).
* `EXPLAIN (ANALYZE, BUFFERS)`: The gold standard. Reports exact memory and disk I/O activity (`Shared Hit Blocks` vs `Shared Read Blocks`).

---

## Part 2 — The 5 Core Database Performance Anti-Patterns

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        POSTGRESQL QUERY PERFORMANCE ANTI-PATTERNS                      │
├──────────────────────────────────────┬──────────┬──────────────────────────────────────┤
│ ANTI-PATTERN                         │ SEVERITY │ ROOT CAUSE & PERFORMANCE IMPACT      │
├──────────────────────────────────────┼──────────┼──────────────────────────────────────┤
│ SEQ_SCAN_ON_LARGE_TABLE              │ CRITICAL │ Missing index; scans 100% of pages   │
│ HASH_JOIN_DISK_SPILL                 │ CRITICAL │ `work_mem` too low; spills to disk   │
│ CARDINALITY_ESTIMATION_SKEW          │ HIGH     │ Stale `pg_statistic` / vacuum lag    │
│ HIGH_FILTER_REMOVAL_RATIO            │ HIGH     │ Unindexed filter predicate           │
│ COLD_BUFFER_READ_RATIO               │ HIGH     │ Cache misses; random disk reads      │
└──────────────────────────────────────┴──────────┴──────────────────────────────────────┘
```

### 2.1 Sequential Scan on Large Tables (`Seq Scan`)
* **What happens:** PostgreSQL reads every page of the table from start to finish. On a table with 5,000,000 rows, this forces millions of page reads and high disk I/O.
* **Tuning Fix:** Create a B-Tree or BRIN index on the filtered column(s).
* **Zero-Downtime Rule:** Always use `CREATE INDEX CONCURRENTLY` in production to prevent acquiring an `ACCESS EXCLUSIVE` table lock that blocks all application reads and writes.

### 2.2 Hash Join Memory Spill to Disk
* **What happens:** When executing a `Hash Join`, PostgreSQL builds an in-memory hash table of the inner relation. If the table size exceeds `work_mem` (default `4MB`), PostgreSQL splits the hash table into multiple batches (`Hash Batches > 1`) and writes temporary overflow files to disk.
* **Tuning Fix:** Increase `work_mem` for the query session:
  ```sql
  SET work_mem = '64MB';
  ```

### 2.3 Cardinality Estimation Skew
* **What happens:** The planner estimates 10 rows (`Plan Rows: 10`), so it chooses a `Nested Loop` join. In reality, 50,000 rows match (`Actual Rows: 50000`). The `Nested Loop` executes 50,000 index lookups instead of a single `Hash Join`, multiplying query latency by $100\times$.
* **Tuning Fix:** Run `ANALYZE <table>;` to refresh table statistics, or increase statistics target:
  ```sql
  ALTER TABLE <table> ALTER COLUMN <col> SET STATISTICS 1000;
  ANALYZE <table>;
  ```

### 2.4 High Filter Removal Ratio
* **What happens:** The database reads 100,000 rows from disk or index pages, but a `Filter` discards 99,000 rows before returning the remaining 1,000 to the client.
* **Tuning Fix:** Include the filtered column in a **Composite Index** or create a **Partial Index**:
  ```sql
  CREATE INDEX CONCURRENTLY idx_orders_pending ON orders (created_at) WHERE status = 'PENDING';
  ```

---

## Part 3 — Interview Defense & Deep Technical Q&A

### Q1: "Why does PostgreSQL sometimes choose a Seq Scan even when an Index exists?"
**Answer:**  
> *"The planner uses cost math. Reading via an index requires random I/O (lookup in B-Tree index page, then lookup in heap page). A sequential scan uses sequential I/O (reading contiguous 8KB disk blocks with OS read-ahead). If a query returns more than ~5–15% of the total table rows, the planner calculates that random I/O from the index is actually slower than scanning the entire table once. This can also happen if `random_page_cost` is set too high (default 4.0 for HDDs; should be tuned to 1.1 for modern NVMe SSDs)."*

### Q2: "What is the difference between Exclusive Time and Total Time in an EXPLAIN tree?"
**Answer:**  
> *"PostgreSQL reports `Actual Total Time` cumulatively for each node, which includes the runtime of all child sub-nodes. In our visualizer, we compute **Exclusive Time** by subtracting child node durations from the parent node. This is the only way to accurately pinpoint the single node responsible for 80% of query execution time."*

### Q3: "What are the risks of `CREATE INDEX CONCURRENTLY`?"
**Answer:**  
> *"Standard `CREATE INDEX` takes an `ACCESS EXCLUSIVE` lock, blocking all reads and writes until completion. `CREATE INDEX CONCURRENTLY` runs in two passes: it takes a `SHARE UPDATE EXCLUSIVE` lock, allowing full reads and writes to proceed concurrently. However, it takes roughly twice as long to build, consumes more CPU, and if it fails (e.g. unique constraint violation), it leaves an `INVALID` index that must be dropped and rebuilt."*

---

## Part 4 — Practice Tuning Exercises

1. **Exercise 1 (Index Synthesis):** Given an EXPLAIN plan with `Seq Scan on orders (Filter: (merchant_id = 4521 AND status = 'SETTLED'))`, generate the optimal composite index DDL.
2. **Exercise 2 (work_mem Tuning):** Calculate the required `work_mem` when an EXPLAIN plan shows `Peak Memory Usage: 32768 kB` with `Hash Batches: 4`.
3. **Exercise 3 (Cache Analysis):** Interpret a plan showing `Shared Hit Blocks: 10, Shared Read Blocks: 15,000` and determine if latency is disk-bound.
