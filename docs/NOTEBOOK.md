# 🐘 PostgreSQL Query Plan Tuning & Index Optimization — Master Learning Notebook

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

## Part 2 — Cost Engine, Access Methods & Joins Deep Dive

### 2.1 The Three Table Access Methods
1. **Index Scan:** Traverses the B-Tree and immediately fetches the corresponding row from the heap table for every index entry. Best for queries returning very few rows ($<2\%$).
2. **Bitmap Index Scan:** Traverses the index and creates an in-memory bitmap of matching page locations, sorts them by physical disk order, and then reads the heap pages sequentially. This converts random I/O into sequential I/O when fetching multiple matching rows ($2\%–15\%$).
3. **Index Only Scan:** Reads data entirely from the index without touching the heap table at all. Requires that all requested columns exist in the index (via key or `INCLUDE` clause) and heap pages are clean in the **Visibility Map** (maintained by autovacuum).

### 2.2 The Three Join Strategies
1. **Nested Loop Join:** For each row in the outer table, loops through and looks up matching rows in the inner table (usually via an index). Best for small datasets.
2. **Hash Join:** Hashes the smaller relation into memory (`work_mem`) and streams the outer relation against the hash table. Best for large, unsorted equality joins.
3. **Merge Join:** Sorts both tables on the join key (or uses pre-sorted B-Tree indexes) and walks through them simultaneously. Best for large, sorted datasets.

---

## Part 3 — The 5 Core Database Performance Anti-Patterns

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

### 3.1 Sequential Scan on Large Tables (`Seq Scan`)
* **What happens:** PostgreSQL reads every page of the table from start to finish. On a table with 5,000,000 rows, this forces millions of page reads and high disk I/O.
* **Tuning Fix:** Create a B-Tree index on the filtered column(s).
* **Zero-Downtime Rule:** Always use `CREATE INDEX CONCURRENTLY` in production to prevent acquiring an `ACCESS EXCLUSIVE` table lock that blocks all application reads and writes.

### 3.2 Hash Join Memory Spill to Disk
* **What happens:** When executing a `Hash Join`, PostgreSQL builds an in-memory hash table of the inner relation. If the table size exceeds `work_mem` (default `4MB`), PostgreSQL splits the hash table into multiple batches (`Hash Batches > 1`) and writes temporary overflow files to disk.
* **Tuning Fix:** Increase `work_mem` for the query session:
  ```sql
  SET work_mem = '64MB';
  ```

### 3.3 Cardinality Estimation Skew
* **What happens:** The planner estimates 10 rows (`Plan Rows: 10`), so it chooses a `Nested Loop` join. In reality, 50,000 rows match (`Actual Rows: 50000`). The `Nested Loop` executes 50,000 index lookups instead of a single `Hash Join`, multiplying query latency by $100\times$.
* **Tuning Fix:** Run `ANALYZE <table>;` to refresh table statistics, or increase statistics target:
  ```sql
  ALTER TABLE <table> ALTER COLUMN <col> SET STATISTICS 1000;
  ANALYZE <table>;
  ```

### 3.4 High Filter Removal Ratio
* **What happens:** The database reads 100,000 rows from disk or index pages, but a `Filter` discards 99,000 rows before returning the remaining 1,000 to the client.
* **Tuning Fix:** Include the filtered column in a **Composite Index** or create a **Partial Index**:
  ```sql
  CREATE INDEX CONCURRENTLY idx_orders_pending ON orders (created_at) WHERE status = 'PENDING';
  ```

---

## Part 4 — Walking the Code: `pg-explain-visualizer-cli`

### 4.1 Exclusive Time Calculation (`src/engine.ts`)
PostgreSQL reports `Actual Total Time` cumulatively for each node, which includes child nodes. To isolate the true bottleneck, our engine calculates:

$$\text{Exclusive Time} = \text{Node Actual Total Time} - \sum (\text{Child Nodes Actual Total Time})$$

```typescript
const exclusiveDurationMs = Math.max(0, actualDurationMs - childrenDurationMs);
const percentageOfTotalTime = (exclusiveDurationMs / totalExecutionTimeMs) * 100;

const isBottleneck =
  percentageOfTotalTime >= 25 || 
  exclusiveDurationMs >= 100 || 
  (rawNode['Node Type'] === 'Seq Scan' && actualTotalRows >= 10000);
```

### 4.2 Automated Index DDL Synthesis
The engine extracts column names directly from SQL comparison operators in the plan's `Filter` string:

```typescript
function extractColumnsFromFilter(filter?: string): string[] {
  if (!filter) return [];
  const matches = filter.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|>=|<=|>|<|IS|IN|LIKE|ILIKE|ANY)/gi);
  // Parses identifiers and returns clean column names
  ...
}
```

---

## Part 5 — Master Interview Defense & Deep Technical Q&A

### Q1: "Why does PostgreSQL sometimes choose a Seq Scan even when an Index exists?"
**Answer:**  
> *"The planner uses cost math. Reading via an index requires random I/O (lookup in B-Tree index page, then lookup in heap page). A sequential scan uses sequential I/O (reading contiguous 8KB disk blocks with OS read-ahead). If a query returns more than ~5–15% of the total table rows, the planner calculates that random I/O from the index is actually slower than scanning the entire table once. This can also happen if `random_page_cost` is set too high (default 4.0 for HDDs; should be tuned to 1.1 for modern NVMe SSDs)."*

### Q2: "What is the difference between `Shared Hit Blocks`, `Shared Read Blocks`, and `Shared Dirtied Blocks`?"
**Answer:**  
> * **Shared Hit Blocks:** The number of 8KB database pages found directly in RAM inside PostgreSQL's `shared_buffers` cache (zero disk I/O).
> * **Shared Read Blocks:** The number of 8KB pages that were not in `shared_buffers` and had to be read from disk (or OS filesystem cache).
> * **Shared Dirtied Blocks:** Pages modified in memory during query execution that must eventually be written to disk by the background writer or checkpoint process.

### Q3: "Why did your tool recommend `CREATE INDEX CONCURRENTLY` instead of standard `CREATE INDEX`? What are the tradeoffs?"
**Answer:**  
> *"Standard `CREATE INDEX` acquires an `ACCESS EXCLUSIVE` lock on the table, which blocks all reads and writes until completion. On a table with 50 million rows, this causes an application outage.*
> 
> *`CREATE INDEX CONCURRENTLY` uses a **two-pass algorithm** with a `SHARE UPDATE EXCLUSIVE` lock, allowing normal `SELECT`, `INSERT`, `UPDATE`, and `DELETE` queries to run unimpeded.*
> 
> *The tradeoffs: it takes roughly twice as long to build, consumes more CPU/IO, must wait for all concurrent transactions to finish, and cannot run inside a transaction block (`BEGIN ... COMMIT`). If it fails midway (e.g. deadlock or unique violation), it leaves an `INVALID` index in `pg_class` that must be dropped."*

### Q4: "In our EXPLAIN plan we see `Hash Batches: 4` and high latency. What is happening and how do you fix it?"
**Answer:**  
> *"A Hash Join builds an in-memory hash table of the smaller inner relation. If the size of that hash table exceeds the allocated `work_mem` setting (default 4MB), PostgreSQL splits the hash table into multiple batches (`Hash Batches: 4`) and writes temporary overflow chunks to disk.*
> 
> *To fix it, we increase `work_mem` specifically for that transaction or complex query using `SET work_mem = '64MB';`. We must be careful not to set global `work_mem` too high because `work_mem` is allocated **per operator, per connection** ($N_{\text{joins}} \times N_{\text{conn}} \times \text{work\_mem}$)."*

---

## Part 6 — Production Zero-Downtime Playbook

1. **Never run unindexed migrations in production without checking plan cost.**
2. **Tune `random_page_cost` to `1.1` on SSD/NVMe cloud databases.**
3. **Use Partial Indexes for soft-deleted / boolean status tables:**
   ```sql
   CREATE INDEX CONCURRENTLY idx_orders_unsettled ON orders (created_at) WHERE is_settled = false;
   ```
4. **Tune `shared_buffers` to ~25% of total system RAM for dedicated PostgreSQL servers.**

---

## Part 7 — Hands-on Practice Tuning Exercises

1. **Exercise 1 (Index Synthesis):** Given an EXPLAIN plan with `Seq Scan on orders (Filter: (merchant_id = 4521 AND status = 'SETTLED'))`, generate the optimal composite index DDL.
2. **Exercise 2 (work_mem Tuning):** Calculate the required `work_mem` when an EXPLAIN plan shows `Peak Memory Usage: 32768 kB` with `Hash Batches: 4`.
3. **Exercise 3 (Cache Analysis):** Interpret a plan showing `Shared Hit Blocks: 10, Shared Read Blocks: 15,000` and determine if latency is disk-bound.
