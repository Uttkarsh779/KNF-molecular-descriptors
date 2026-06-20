"""
database.py — SQLite persistence layer for KNF Studio.

Database lives at: %LOCALAPPDATA%/KNFStudio/nciforge.db
All runs and per-file results are stored permanently so that:
  - The Results page shows every molecule processed across all time.
  - SNCI_Norm and SCDI_Norm are min-max normalised globally after every run.
"""

import json
import os
import sqlite3
import statistics
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# DB path
# ---------------------------------------------------------------------------

def _db_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    folder = base / "KNFStudio"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "nciforge.db"


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(str(_db_path()), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'processing',
    config_json     TEXT,
    created_at      TEXT,
    started_at      TEXT,
    completed_at    TEXT,
    total_files     INTEGER DEFAULT 0,
    completed_files INTEGER DEFAULT 0,
    success_files   INTEGER DEFAULT 0,
    failed_files    INTEGER DEFAULT 0,
    stopped_files   INTEGER DEFAULT 0,
    elapsed_ms      INTEGER DEFAULT 0,
    output_directory TEXT
);

CREATE TABLE IF NOT EXISTS results (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL,
    file_name           TEXT NOT NULL,
    f1                  REAL DEFAULT 0,
    f2                  REAL DEFAULT 0,
    f3                  REAL DEFAULT 0,
    f4                  REAL DEFAULT 0,
    f5                  REAL DEFAULT 0,
    f6                  REAL DEFAULT 0,
    f7                  REAL DEFAULT 0,
    f8                  REAL DEFAULT 0,
    f9                  REAL DEFAULT 0,
    f2_defined          INTEGER DEFAULT 1,
    SNCI                REAL DEFAULT 0,
    SCDI                REAL DEFAULT 0,
    SCDI_variance       REAL DEFAULT 0,
    SNCI_Norm           REAL DEFAULT 0,
    SCDI_Norm           REAL DEFAULT 0,
    quadrant            TEXT DEFAULT 'Q1',
    KUID_raw            TEXT,
    KUID                TEXT,
    KUID_Cluster        TEXT,
    KUID_Intensive_raw  TEXT,
    KUID_Intensive      TEXT,
    KUID_Intensive_Cluster TEXT,
    KUID_prefix2        TEXT,
    KUID_prefix4        TEXT,
    KUID_prefix6        TEXT,
    status              TEXT DEFAULT 'success',
    FOREIGN KEY (run_id) REFERENCES runs(id)
);
"""


def init_db() -> None:
    """Create tables if they do not exist."""
    with _conn() as con:
        con.executescript(_SCHEMA)
        con.execute("UPDATE results SET SCDI = SCDI_variance WHERE SCDI = 0 AND SCDI_variance != 0")


def is_empty() -> bool:
    with _conn() as con:
        row = con.execute("SELECT COUNT(*) FROM runs").fetchone()
        return row[0] == 0


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------

def save_run(run: dict) -> None:
    sql = """
    INSERT OR REPLACE INTO runs
        (id, name, status, config_json, created_at, started_at, completed_at,
         total_files, completed_files, success_files, failed_files,
         stopped_files, elapsed_ms, output_directory)
    VALUES
        (:id, :name, :status, :config_json, :created_at, :started_at, :completed_at,
         :total_files, :completed_files, :success_files, :failed_files,
         :stopped_files, :elapsed_ms, :output_directory)
    """
    with _conn() as con:
        con.execute(sql, {
            "id":               run["id"],
            "name":             run.get("name", ""),
            "status":           run.get("status", "processing"),
            "config_json":      json.dumps(run.get("config", {})),
            "created_at":       run.get("createdAt"),
            "started_at":       run.get("startedAt"),
            "completed_at":     run.get("completedAt"),
            "total_files":      run.get("totalFiles", 0),
            "completed_files":  run.get("completedFiles", 0),
            "success_files":    run.get("successFiles", 0),
            "failed_files":     run.get("failedFiles", 0),
            "stopped_files":    run.get("stoppedFiles", 0),
            "elapsed_ms":       run.get("elapsedMs", 0),
            "output_directory": run.get("config", {}).get("outputDirectory") if isinstance(run.get("config"), dict) else None,
        })


def update_run_status(run_id: str, updates: dict) -> None:
    fields = {
        "status":           updates.get("status"),
        "completed_at":     updates.get("completedAt"),
        "completed_files":  updates.get("completedFiles"),
        "success_files":    updates.get("successFiles"),
        "failed_files":     updates.get("failedFiles"),
        "stopped_files":    updates.get("stoppedFiles"),
        "elapsed_ms":       updates.get("elapsedMs"),
    }
    set_parts = [f"{k} = :{k}" for k, v in fields.items() if v is not None]
    if not set_parts:
        return
    sql = f"UPDATE runs SET {', '.join(set_parts)} WHERE id = :run_id"
    params = {k: v for k, v in fields.items() if v is not None}
    params["run_id"] = run_id
    with _conn() as con:
        con.execute(sql, params)


def get_all_runs() -> list[dict]:
    with _conn() as con:
        rows = con.execute("SELECT * FROM runs ORDER BY created_at DESC").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["config"] = json.loads(d.pop("config_json") or "{}")
        except Exception:
            d["config"] = {}
        # Remap snake_case → camelCase for frontend
        result.append({
            "id":             d["id"],
            "name":           d["name"],
            "status":         d["status"],
            "config":         d["config"],
            "createdAt":      d["created_at"],
            "startedAt":      d["started_at"],
            "completedAt":    d["completed_at"],
            "totalFiles":     d["total_files"],
            "completedFiles": d["completed_files"],
            "successFiles":   d["success_files"],
            "failedFiles":    d["failed_files"],
            "stoppedFiles":   d["stopped_files"],
            "elapsedMs":      d["elapsed_ms"],
            "throughput":     0,
            "files":          [],
        })
    return result


def get_run_by_id(run_id: str) -> dict | None:
    runs = get_all_runs()
    return next((r for r in runs if r["id"] == run_id), None)


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

def save_result(result: dict) -> None:
    sql = """
    INSERT OR REPLACE INTO results
        (id, run_id, file_name, f1, f2, f3, f4, f5, f6, f7, f8, f9,
         f2_defined, SNCI, SCDI, SCDI_variance, SNCI_Norm, SCDI_Norm, quadrant,
         KUID_raw, KUID, KUID_Cluster, KUID_Intensive_raw, KUID_Intensive,
         KUID_Intensive_Cluster, KUID_prefix2, KUID_prefix4, KUID_prefix6, status)
    VALUES
        (:id, :run_id, :file_name, :f1, :f2, :f3, :f4, :f5, :f6, :f7, :f8, :f9,
         :f2_defined, :SNCI, :SCDI, :SCDI_variance, :SNCI_Norm, :SCDI_Norm, :quadrant,
         :KUID_raw, :KUID, :KUID_Cluster, :KUID_Intensive_raw, :KUID_Intensive,
         :KUID_Intensive_Cluster, :KUID_prefix2, :KUID_prefix4, :KUID_prefix6, :status)
    """
    with _conn() as con:
        con.execute(sql, {
            "id":                    result.get("id", ""),
            "run_id":                result.get("runId", ""),
            "file_name":             result.get("fileName", ""),
            "f1":                    result.get("f1", 0.0),
            "f2":                    result.get("f2", 0.0),
            "f3":                    result.get("f3", 0.0),
            "f4":                    result.get("f4", 0.0),
            "f5":                    result.get("f5", 0.0),
            "f6":                    result.get("f6", 0.0),
            "f7":                    result.get("f7", 0.0),
            "f8":                    result.get("f8", 0.0),
            "f9":                    result.get("f9", 0.0),
            "f2_defined":            1 if result.get("f2_defined", True) else 0,
            "SNCI":                  result.get("SNCI", 0.0),
            "SCDI":                  result.get("SCDI", 0.0),
            "SCDI_variance":         result.get("SCDI_variance", 0.0),
            "SNCI_Norm":             result.get("SNCI_Norm", 0.0),
            "SCDI_Norm":             result.get("SCDI_Norm", 0.0),
            "quadrant":              result.get("quadrant", "Q1"),
            "KUID_raw":              result.get("KUID_raw"),
            "KUID":                  result.get("KUID"),
            "KUID_Cluster":          result.get("KUID_Cluster"),
            "KUID_Intensive_raw":    result.get("KUID_Intensive_raw"),
            "KUID_Intensive":        result.get("KUID_Intensive"),
            "KUID_Intensive_Cluster":result.get("KUID_Intensive_Cluster"),
            "KUID_prefix2":          result.get("KUID_prefix2"),
            "KUID_prefix4":          result.get("KUID_prefix4"),
            "KUID_prefix6":          result.get("KUID_prefix6"),
            "status":                result.get("status", "success"),
        })


def get_all_results() -> list[dict]:
    with _conn() as con:
        rows = con.execute("SELECT * FROM results ORDER BY run_id, file_name").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        out.append({
            "id":                    d["id"],
            "runId":                 d["run_id"],
            "fileName":              d["file_name"],
            "f1":                    d["f1"],
            "f2":                    d["f2"],
            "f3":                    d["f3"],
            "f4":                    d["f4"],
            "f5":                    d["f5"],
            "f6":                    d["f6"],
            "f7":                    d["f7"],
            "f8":                    d["f8"],
            "f9":                    d["f9"],
            "f2_defined":            bool(d["f2_defined"]),
            "SNCI":                  d["SNCI"],
            "SCDI":                  d["SCDI"],
            "SCDI_variance":         d["SCDI_variance"],
            "SNCI_Norm":             d["SNCI_Norm"],
            "SCDI_Norm":             d["SCDI_Norm"],
            "quadrant":              d["quadrant"],
            "KUID_raw":              d["KUID_raw"],
            "KUID":                  d["KUID"],
            "KUID_Cluster":          d["KUID_Cluster"],
            "KUID_Intensive_raw":    d["KUID_Intensive_raw"],
            "KUID_Intensive":        d["KUID_Intensive"],
            "KUID_Intensive_Cluster":d["KUID_Intensive_Cluster"],
            "KUID_prefix2":          d["KUID_prefix2"],
            "KUID_prefix4":          d["KUID_prefix4"],
            "KUID_prefix6":          d["KUID_prefix6"],
            "status":                d["status"],
        })
    return out


def get_results_by_run(run_id: str) -> list[dict]:
    all_r = get_all_results()
    return [r for r in all_r if r["runId"] == run_id]


# ---------------------------------------------------------------------------
# Global Normalization
# ---------------------------------------------------------------------------

def renormalize_all() -> list[dict]:
    """
    Min-max normalise SNCI and SCDI across ALL stored results,
    recompute quadrant using global medians, and bulk-update the DB.
    Returns the updated list of results.
    """
    results = get_all_results()
    if not results:
        return []

    snci_vals = [r["SNCI"] for r in results]
    scdi_vals = [r["SCDI"] for r in results]

    snci_min, snci_max = min(snci_vals), max(snci_vals)
    scdi_min, scdi_max = min(scdi_vals), max(scdi_vals)
    snci_range = snci_max - snci_min if snci_max != snci_min else 1.0
    scdi_range = scdi_max - scdi_min if scdi_max != scdi_min else 1.0

    # Normalised medians for quadrant boundaries
    norm_snci = [(v - snci_min) / snci_range for v in snci_vals]
    norm_scdi = [(v - scdi_min) / scdi_range for v in scdi_vals]
    med_snci = statistics.median(norm_snci)
    med_scdi = statistics.median(norm_scdi)

    updated: list[dict] = []
    for r in results:
        sn = (r["SNCI"] - snci_min) / snci_range
        sc = (r["SCDI"] - scdi_min) / scdi_range
        if   sn >= med_snci and sc >= med_scdi: q = "Q1"
        elif sn <  med_snci and sc >= med_scdi: q = "Q2"
        elif sn <  med_snci and sc <  med_scdi: q = "Q3"
        else:                                    q = "Q4"
        r["SNCI_Norm"] = round(sn, 6)
        r["SCDI_Norm"] = round(sc, 6)
        r["quadrant"]  = q
        updated.append(r)

    # Bulk update
    sql = """
    UPDATE results
    SET SNCI_Norm = :SNCI_Norm,
        SCDI_Norm = :SCDI_Norm,
        quadrant  = :quadrant
    WHERE id = :id
    """
    with _conn() as con:
        con.executemany(sql, [
            {"SNCI_Norm": r["SNCI_Norm"], "SCDI_Norm": r["SCDI_Norm"],
             "quadrant": r["quadrant"], "id": r["id"]}
            for r in updated
        ])

    return updated


def seed_from_legacy(runs: list[dict], results: list[dict]) -> None:
    """One-time migration: import existing in-memory data into SQLite."""
    for run in runs:
        save_run(run)
    for result in results:
        save_result(result)
    renormalize_all()


# ---------------------------------------------------------------------------
# Startup cleanup
# ---------------------------------------------------------------------------

def mark_stale_runs_failed() -> int:
    """
    On every app startup, any run still showing 'processing' is orphaned
    (the app was force-killed mid-run). Mark them 'failed' so the UI
    doesn't show them as stuck forever.

    Returns the number of runs that were updated.
    """
    sql = """
    UPDATE runs
    SET   status       = 'failed',
          completed_at = :now
    WHERE status IN ('processing', 'queued', 'validating')
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as con:
        cur = con.execute(sql, {"now": now})
        return cur.rowcount
