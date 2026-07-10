"""
Lightweight API + WebSocket server wrapper for NCIForge CLI.
Bridges the React frontend with the CLI tool.

Usage: python server.py
"""
from fastapi import FastAPI, WebSocket, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import asyncio
import csv
import math
import subprocess
import json
import os
import tempfile
import shutil
import sys
from pathlib import Path
from datetime import datetime
import uuid
import re
from collections.abc import Iterable
import database as db

app = FastAPI(title="NCIForge API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
    )

UPLOAD_DIR = Path(tempfile.mkdtemp(prefix="nciforge_"))
TIMEOUT_SECONDS = 600
RUN_HISTORY: list[dict] = []
RESULT_HISTORY: list[dict] = []
RUN_LOGS: dict[str, list[str]] = {}
ACTIVE_PROCESSES: dict[str, asyncio.subprocess.Process] = {}
STOP_REQUESTED: set[str] = set()


def _discover_output_roots() -> list[Path]:
    roots: list[Path] = []
    candidates: list[Path] = []
    home = Path.home()
    candidates.append(home / "Downloads" / "water")
    candidates.append(home / "Downloads")
    candidates.append(home / "Desktop")
    for base in candidates:
        if not base.exists():
            continue
        for batch_json in base.rglob("batch_knf.json"):
            roots.append(batch_json.parent)
    # de-dup while preserving order
    seen: set[str] = set()
    unique: list[Path] = []
    for root in roots:
        key = str(root.resolve())
        if key in seen:
            continue
        seen.add(key)
        unique.append(root)
    return unique


def _seed_history_from_disk() -> None:
    if RUN_HISTORY or RESULT_HISTORY:
        return

    for root in _discover_output_roots():
        batch_json = root / "batch_knf.json"
        summary = {}
        generated_at = None
        if batch_json.exists():
            try:
                payload = json.loads(batch_json.read_text(encoding="utf-8", errors="ignore"))
                if isinstance(payload, dict):
                    summary = payload.get("summary", {}) if isinstance(payload.get("summary"), dict) else {}
                    generated_at = payload.get("generated_at_utc")
            except Exception:
                summary = {}

        run_id = f"disk-{root.name}"
        run_name = f"Disk Run {root.name}"
        total_files = int(summary.get("total_files", 0) or 0)
        completed_files = int(summary.get("successful_files", 0) or 0)
        failed_files = int(summary.get("failed_files", 0) or 0)
        stopped_files = int(summary.get("stopped_files", 0) or 0)
        parsed_results = _read_results_from_output_root(run_id, str(root))
        if parsed_results:
            completed_files = len(parsed_results)
            if total_files == 0:
                total_files = len(parsed_results)
        status = "completed" if parsed_results else ("stopped" if stopped_files else "failed")
        RUN_HISTORY.insert(0, {
            "id": run_id,
            "name": run_name,
            "status": status,
            "config": {
                "outputDirectory": str(root),
            },
            "files": [],
            "createdAt": generated_at or datetime.utcnow().isoformat() + "Z",
            "startedAt": generated_at or datetime.utcnow().isoformat() + "Z",
            "completedAt": generated_at or datetime.utcnow().isoformat() + "Z",
            "totalFiles": total_files,
            "completedFiles": completed_files,
            "successFiles": completed_files,
            "failedFiles": failed_files,
            "stoppedFiles": stopped_files,
            "elapsedMs": 0,
            "throughput": 0,
        })
        RESULT_HISTORY.extend(parsed_results)


def _status_from_metrics(snci: float, scdi: float) -> str:
    if snci >= 0 and scdi >= 0:
        return "Q1"
    if snci < 0 and scdi >= 0:
        return "Q2"
    if snci < 0 and scdi < 0:
        return "Q3"
    return "Q4"


def _extract_float(content: str, key: str, default: float = 0.0) -> float:
    m = re.search(rf"{re.escape(key)}:\s*([-+]?\d*\.?\d+)", content)
    if not m:
        return default
    try:
        return float(m.group(1))
    except ValueError:
        return default


def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        result = float(value)
        if math.isnan(result) or math.isinf(result):
            return default
        return result
    except Exception:
        return default


def _read_quadrant_map(output_root: str | None) -> dict[str, str]:
    if not output_root:
        return {}
    q_file = os.path.join(output_root, "snci_scdi_quadrants.json")
    if not os.path.exists(q_file):
        return {}
    try:
        with open(q_file, "r", encoding="utf-8") as f:
            payload = json.load(f)
        quadrants = payload.get("quadrants", {}) if isinstance(payload, dict) else {}
        mapping: dict[str, str] = {}
        for quadrant, data in quadrants.items():
            for file_name in data.get("files", []):
                mapping[file_name] = quadrant
        return mapping
    except Exception:
        return {}


def _parse_kv_result_file(output_file: str, run_id: str, quadrant_map: dict[str, str], default_status: str = "success") -> dict | None:
    try:
        content = Path(output_file).read_text(encoding="utf-8", errors="ignore")
        snci = _extract_float(content, "SNCI_raw", 0.0)
        scdi = _extract_float(content, "SCDI_raw", 0.0)
        variance = _extract_float(content, "SCDI_variance", 0.0)
        fvals = {f"f{i}": _extract_float(content, f"f{i}", 0.0) for i in range(1, 10)}
        file_name = Path(output_file).parent.name
        f2_defined = "n/a" not in content.lower() and "no_candidate_triplets" not in content.lower()
        return {
            "id": str(uuid.uuid4()),
            "runId": run_id,
            "fileName": file_name,
            "f1": fvals["f1"],
            "f2": fvals["f2"],
            "f3": fvals["f3"],
            "f4": fvals["f4"],
            "f5": fvals["f5"],
            "f6": fvals["f6"],
            "f7": fvals["f7"],
            "f8": fvals["f8"],
            "f9": fvals["f9"],
            "f2_defined": f2_defined,
            "KUID_raw": None,
            "KUID": None,
            "KUID_Cluster": None,
            "KUID_Intensive_raw": None,
            "KUID_Intensive": None,
            "KUID_Intensive_Cluster": None,
            "KUID_prefix2": None,
            "KUID_prefix4": None,
            "KUID_prefix6": None,
            "SNCI": snci,
            "SCDI": scdi,
            "SCDI_variance": variance,
            "SNCI_Norm": snci,
            "SCDI_Norm": scdi,
            "quadrant": quadrant_map.get(file_name) or _status_from_metrics(snci, scdi),
            "status": default_status,
        }
    except Exception:
        return None


def _read_results_from_output_root(run_id: str, output_root: str | None) -> list[dict]:
    parsed: list[dict] = []
    if not output_root or not os.path.exists(output_root):
        return parsed

    quadrant_map = _read_quadrant_map(output_root)
    csv_file = os.path.join(output_root, "batch_knf_unified.csv")
    csv_rows: list[dict] = []
    if os.path.exists(csv_file):
        try:
            with open(csv_file, "r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                csv_rows = list(reader)
        except Exception:
            csv_rows = []

    if csv_rows:
        for row in csv_rows:
            file_name = row.get("File") or row.get("fileName") or row.get("file")
            if not file_name:
                continue
            parsed.append({
                "id": str(uuid.uuid4()),
                "runId": run_id,
                "fileName": file_name,
                "f1": _safe_float(row.get("f1", 0.0)),
                "f2": _safe_float(row.get("f2", 0.0)),
                "f3": _safe_float(row.get("f3", 0.0)),
                "f4": _safe_float(row.get("f4", 0.0)),
                "f5": _safe_float(row.get("f5", 0.0)),
                "f6": _safe_float(row.get("f6", 0.0)),
                "f7": _safe_float(row.get("f7", 0.0)),
                "f8": _safe_float(row.get("f8", 0.0)),
                "f9": _safe_float(row.get("f9", 0.0)),
                "f2_defined": str(row.get("f2_defined", "")).lower() in ("1", "true", "yes", "y"),
                "KUID_raw": row.get("KUID_raw"),
                "KUID": row.get("KUID"),
                "KUID_Cluster": row.get("KUID_Cluster"),
                "KUID_Intensive_raw": row.get("KUID_Intensive_raw"),
                "KUID_Intensive": row.get("KUID_Intensive"),
                "KUID_Intensive_Cluster": row.get("KUID_Intensive_Cluster"),
                "KUID_prefix2": row.get("KUID_prefix2"),
                "KUID_prefix4": row.get("KUID_prefix4"),
                "KUID_prefix6": row.get("KUID_prefix6"),
                "SNCI": _safe_float(row.get("SNCI", 0.0)),
                "SCDI": _safe_float(row.get("SCDI_variance", 0.0)),
                "SCDI_variance": _safe_float(row.get("SCDI_variance", 0.0)),
                "SNCI_Norm": _safe_float(row.get("SNCI_Norm", row.get("SNCI", 0.0))),
                "SCDI_Norm": _safe_float(row.get("SCDI_Norm", 0.0)),
                "quadrant": quadrant_map.get(file_name) or "Q1",
                "status": "success",
            })
        if parsed:
            return parsed

    json_file = os.path.join(output_root, "batch_knf.json")
    if os.path.exists(json_file):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                payload = json.load(f)
            records = payload.get("records", []) if isinstance(payload, dict) else []
            if isinstance(records, list) and records:
                for rec in records:
                    if not isinstance(rec, dict):
                        continue
                    file_name = rec.get("File") or rec.get("fileName") or rec.get("file")
                    if not file_name:
                        continue
                    parsed.append({
                        "id": str(uuid.uuid4()),
                        "runId": run_id,
                        "fileName": file_name,
                        "f1": _safe_float(rec.get("f1", 0.0)),
                        "f2": _safe_float(rec.get("f2", 0.0)),
                        "f3": _safe_float(rec.get("f3", 0.0)),
                        "f4": _safe_float(rec.get("f4", 0.0)),
                        "f5": _safe_float(rec.get("f5", 0.0)),
                        "f6": _safe_float(rec.get("f6", 0.0)),
                        "f7": _safe_float(rec.get("f7", 0.0)),
                        "f8": _safe_float(rec.get("f8", 0.0)),
                        "f9": _safe_float(rec.get("f9", 0.0)),
                        "SNCI": _safe_float(rec.get("SNCI", rec.get("SNCI_raw", 0.0))),
                        "SCDI": _safe_float(rec.get("SCDI", rec.get("SCDI_raw", 0.0))),
                        "SCDI_variance": _safe_float(rec.get("SCDI_variance", 0.0)),
                        "SNCI_Norm": _safe_float(rec.get("SNCI_Norm", rec.get("SNCI", 0.0))),
                        "SCDI_Norm": _safe_float(rec.get("SCDI_Norm", rec.get("SCDI", 0.0))),
                        "quadrant": str(rec.get("quadrant") or quadrant_map.get(file_name) or "Q1"),
                        "status": str(rec.get("status", "success")),
                    })
                if parsed:
                    return parsed
        except Exception:
            pass

    # Fallback 3: Parse per-file output.txt from subdirectories
    existing_names = {r.get("fileName") for r in parsed}
    for entry in os.scandir(output_root):
        if entry.is_dir() and entry.name not in ("__pycache__", "."):
            output_txt = os.path.join(entry.path, "output.txt")
            if os.path.exists(output_txt):
                try:
                    txt = open(output_txt, "r", encoding="utf-8", errors="ignore").read()
                    file_name = None
                    for ext in (".mol", ".xyz", ".pdb", ".cml", ".sdf"):
                        mol_file = os.path.join(entry.path, f"xtbtopo{ext}")
                        if os.path.exists(mol_file):
                            file_name = entry.name + ext
                            break
                    if not file_name:
                        file_name = entry.name
                    vals = {}
                    for line in txt.splitlines():
                        for key in ("SNCI_raw", "SCDI_variance", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"):
                            if line.strip().startswith(key + ":") or line.strip().startswith(key + " "):
                                parts = line.split(":", 1)
                                if len(parts) == 2:
                                    raw = parts[1].strip().split()[0] if parts[1].strip() else "0"
                                    vals[key] = _safe_float(raw) if raw not in ("n/a", "nan", "inf", "") else 0.0
                    if vals and file_name not in existing_names:
                        parsed.append({
                            "id": str(uuid.uuid4()),
                            "runId": run_id,
                            "fileName": file_name,
                            "f1": vals.get("f1", 0.0),
                            "f2": vals.get("f2", 0.0),
                            "f3": vals.get("f3", 0.0),
                            "f4": vals.get("f4", 0.0),
                            "f5": vals.get("f5", 0.0),
                            "f6": vals.get("f6", 0.0),
                            "f7": vals.get("f7", 0.0),
                            "f8": vals.get("f8", 0.0),
                            "f9": vals.get("f9", 0.0),
                            "SNCI": vals.get("SNCI_raw", 0.0),
                            "SCDI": vals.get("SCDI_variance", 0.0),
                            "SCDI_variance": vals.get("SCDI_variance", 0.0),
                            "SNCI_Norm": 0.0,
                            "SCDI_Norm": 0.0,
                            "quadrant": "Q1",
                            "status": "success",
                        })
                except Exception:
                    pass
    return parsed


def _kill_process_tree(pid: int) -> None:
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass

def _find_on_path(name: str) -> str | None:
    """Find an executable on PATH or in known directories."""
    found = shutil.which(name)
    if found:
        return found
    known_dirs = [
        r"C:\ProgramData\xtb\xtb-6.7.1\bin",
        r"C:\Program Files\OpenBabel-3.1.1",
        r"C:\Program Files (x86)\OpenBabel-3.1.1",
        r"C:\Users\Administrator\AppData\Local\Packages\PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0\LocalCache\local-packages\Python311\Scripts",
    ]
    for d in known_dirs:
        candidate = os.path.join(d, name) + ".exe"
        if os.path.exists(candidate):
            return candidate
        candidate = os.path.join(d, name)
        if os.path.exists(candidate):
            return candidate
    return None

def _check_dependencies() -> dict:
    checks = {}
    
    # 1. Find nciforge_path first so we can use its Python interpreter
    nciforge_path = None
    try:
        nciforge_path = _find_nciforge()
        checks["nciforge"] = nciforge_path
    except RuntimeError:
        checks["nciforge"] = None

    # 2. Determine Python interpreter to check torch
    python_exe = None
    if nciforge_path:
        # Check if nciforge is inside a venv (Scripts or bin directory)
        parent_dir = Path(nciforge_path).parent
        if parent_dir.name.lower() in ("scripts", "bin"):
            candidate = parent_dir / ("python.exe" if os.name == "nt" else "python")
            if candidate.exists():
                python_exe = str(candidate)

    if not python_exe:
        # Fallback to KNF_STUDIO_VENV
        venv_env = os.environ.get("KNF_STUDIO_VENV")
        if venv_env:
            venv_path = Path(venv_env)
            candidate = venv_path / "Scripts" / "python.exe" if os.name == "nt" else venv_path / "bin" / "python"
            if candidate.exists():
                python_exe = str(candidate)

    if not python_exe:
        # Final fallback: use current sys.executable if running in dev (non-frozen),
        # otherwise search PATH for python/python3.
        if not getattr(sys, 'frozen', False):
            python_exe = sys.executable
        else:
            python_exe = shutil.which("python") or shutil.which("python3")

    # 3. Check torch version in that Python interpreter
    checks["torch"] = None
    if python_exe:
        try:
            # Run python -c "import torch; print(torch.__version__)"
            # Use startupinfo to hide console window on Windows
            startupinfo = None
            if os.name == "nt":
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE
            res = subprocess.run(
                [python_exe, "-c", "import torch; print(torch.__version__)"],
                capture_output=True,
                text=True,
                check=True,
                startupinfo=startupinfo,
                timeout=5
            )
            checks["torch"] = res.stdout.strip()
        except Exception:
            pass

    checks["xtb"] = _find_on_path("xtb")
    checks["obabel"] = _find_on_path("obabel")

    return checks


@app.on_event("startup")
async def hydrate_from_disk() -> None:
    global RUN_HISTORY, RESULT_HISTORY  # must be first before any use
    db.init_db()

    # Mark any orphaned runs (app killed mid-run) as failed
    stale = db.mark_stale_runs_failed()
    if stale:
        print(f"[startup] marked {stale} stale run(s) as failed")

    if db.is_empty():
        # One-time migration: seed in-memory history from disk then persist to SQLite
        _seed_history_from_disk()
        if RUN_HISTORY or RESULT_HISTORY:
            db.seed_from_legacy(RUN_HISTORY, RESULT_HISTORY)
    else:
        # Load from DB into in-memory caches so legacy code still works
        RUN_HISTORY = db.get_all_runs()
        RESULT_HISTORY = db.get_all_results()

CACHED_DEPS: dict | None = None

@app.get("/api/health")
async def health():
    global CACHED_DEPS
    if CACHED_DEPS is None:
        try:
            CACHED_DEPS = _check_dependencies()
        except Exception:
            CACHED_DEPS = {"torch": None, "nciforge": None, "xtb": None, "obabel": None}
    missing = [k for k, v in CACHED_DEPS.items() if v is None]
    return {
        "status": "ok" if not missing else "degraded",
        "upload_dir": str(UPLOAD_DIR),
        "dependencies": CACHED_DEPS,
        "missing": missing,
    }

@app.post("/api/upload")
async def upload_files(files: list[UploadFile] = File(...)):
    saved = []
    errors = []
    for f in files:
        try:
            name = f.filename or "unnamed"
            safe_name = os.path.basename(name)
            dest = UPLOAD_DIR / safe_name
            content = await f.read()
            with open(dest, "wb") as out:
                out.write(content)
            saved.append({"name": safe_name, "size": len(content), "path": str(dest)})
        except Exception as e:
            errors.append({"name": f.filename, "error": str(e)})
    return {"files": saved, "errors": errors}

@app.get("/api/files")
async def list_files():
    files = []
    for f in UPLOAD_DIR.iterdir():
        if f.is_file():
            files.append({"name": f.name, "size": f.stat().st_size})
    return {"files": files}

@app.delete("/api/files")
async def clear_files():
    for f in UPLOAD_DIR.iterdir():
        if f.is_file():
            f.unlink()
    return {"status": "cleared"}


@app.get("/api/files/{filename}/content")
async def get_file_content(filename: str):
    safe_name = os.path.basename(filename)
    if not safe_name or safe_name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    # Search directories: upload dir, then output + source dirs from all runs
    search_dirs: list[Path] = [UPLOAD_DIR]
    for run in db.get_all_runs():
        cfg = json.loads(run.get("config_json") or "{}") if run.get("config_json") else {}
        for key in ("outputDirectory", "inputDirectory", "inputDir", "input_dir"):
            val = cfg.get(key)
            if val and os.path.isdir(val):
                search_dirs.append(Path(val))
                parent = Path(val).parent
                if parent.is_dir():
                    search_dirs.append(parent)
    # Also search known water molecule directories
    downloads = Path.home() / "Downloads" / "water"
    if downloads.is_dir():
        for child in downloads.iterdir():
            if child.is_dir():
                search_dirs.append(child)
    for search_dir in search_dirs:
        for root, _, files in os.walk(str(search_dir)):
            if safe_name in files:
                target_path = Path(root) / safe_name
                try:
                    content = target_path.read_text(encoding="utf-8", errors="ignore")
                    return {"name": safe_name, "content": content}
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=404, detail="File not found")



@app.get("/api/runs")
async def get_runs():
    return {"runs": db.get_all_runs()}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    return {"run": db.get_run_by_id(run_id)}


@app.get("/api/runs/{run_id}/logs")
async def get_run_logs(run_id: str):
    return {"logs": RUN_LOGS.get(run_id, [])}


@app.get("/api/results")
async def get_results(run_id: str | None = None):
    if run_id:
        return {"results": db.get_results_by_run(run_id)}
    return {"results": db.get_all_results()}


@app.get("/api/runs/{run_id}/results")
async def get_run_results(run_id: str):
    return {"results": db.get_results_by_run(run_id)}


@app.get("/api/results/normalized")
async def get_results_normalized():
    """Force-recompute global normalization and return updated results."""
    updated = db.renormalize_all()
    return {"results": updated, "count": len(updated)}

@app.websocket("/ws/run")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            action = data.get("action")

            if action == "start_run":
                config = data.get("config", {})
                filenames = data.get("files", [])
                run_id = f"run-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{str(uuid.uuid4())[:8]}"
                run_name = data.get("name", "").strip() or f"Run {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}"
                run_record = {
                    "id": run_id,
                    "name": run_name,
                    "status": "processing",
                    "config": config,
                    "files": [{"id": f"file-{i}", "name": name, "extension": Path(name).suffix, "size": 0, "valid": True} for i, name in enumerate(filenames)],
                    "createdAt": datetime.utcnow().isoformat() + "Z",
                    "startedAt": datetime.utcnow().isoformat() + "Z",
                    "totalFiles": len(filenames),
                    "completedFiles": 0,
                    "successFiles": 0,
                    "failedFiles": 0,
                    "stoppedFiles": 0,
                    "elapsedMs": 0,
                    "throughput": 0,
                }
                # ---- Persist run to DB immediately ----
                db.save_run(run_record)
                RUN_HISTORY.insert(0, run_record)
                RUN_LOGS[run_id] = [f"[{datetime.utcnow().isoformat()}] Run created"]

                deps = _check_dependencies()
                missing = [k for k, v in deps.items() if v is None and k != "torch"]
                if missing:
                    issues = []
                    if "xtb"      in missing: issues.append("xtb (extended tight binding) is not on PATH")
                    if "obabel"   in missing: issues.append("Open Babel (obabel) is not on PATH")
                    if "nciforge" in missing: issues.append("nciforge CLI is not installed")
                    run_record["status"] = "failed"
                    db.update_run_status(run_id, run_record)
                    await websocket.send_json({
                        "type": "error",
                        "message": "Missing dependencies: " + "; ".join(issues) +
                                   ". Install the required tools and restart the server."
                    })
                    continue

                await websocket.send_json({
                    "type": "status",
                    "message": f"Starting run with {len(filenames)} files..."
                })

                input_files = []
                for name in filenames:
                    f = UPLOAD_DIR / name
                    if f.exists():
                        input_files.append(str(f))
                    else:
                        found = list(UPLOAD_DIR.rglob(name))
                        if found:
                            input_files.append(str(found[0]))

                if not input_files:
                    await websocket.send_json({
                        "type": "error",
                        "message": "No valid input files found. Upload files first."
                    })
                    continue

                nciforge_path = deps["nciforge"]

                charge          = config.get("charge", 0)
                spin            = config.get("spin", 1)
                processing_mode = config.get("processingMode", "auto")
                nci_backend     = config.get("nciBackend", "torch")
                gpu_enabled     = config.get("gpuEnabled", False)
                force           = config.get("forceRecomputation", False)
                clean           = config.get("cleanOutputs", True)
                debug           = config.get("debugMode", False)
                enable_stop     = config.get("enableStopKey", True)
                interactive     = config.get("interactiveQuadrant", False)
                workers         = config.get("workers")
                output_dir      = config.get("outputDirectory", "")
                grid_spacing    = config.get("gridSpacing")
                grid_padding    = config.get("gridPadding")
                batch_size      = config.get("batchSize")
                eig_batch_size  = config.get("eigBatchSize")
                rho_floor       = config.get("rhoFloor")
                nci_device      = config.get("nciDevice")

                def _build_args(file_path: str) -> list[str]:
                    a = [nciforge_path, file_path]
                    a.extend(["--charge", str(charge)])
                    a.extend(["--spin", str(spin)])
                    a.extend(["--processing", processing_mode])
                    a.extend(["--nci-backend", nci_backend])
                    if gpu_enabled:  a.append("--gpu")
                    if force:        a.append("--force")
                    if clean:        a.append("--clean")
                    if debug:        a.append("--debug")
                    if enable_stop:  a.append("--enable-stop-key")
                    if interactive:  a.append("--interactive-quadrant-plot")
                    if workers:      a.extend(["--workers", str(workers)])
                    if output_dir:   a.extend(["--output-dir", output_dir])
                    if grid_spacing  is not None: a.extend(["--nci-grid-spacing",    str(grid_spacing)])
                    if grid_padding  is not None: a.extend(["--nci-grid-padding",    str(grid_padding)])
                    if batch_size    is not None: a.extend(["--nci-batch-size",      str(batch_size)])
                    if eig_batch_size is not None: a.extend(["--nci-eig-batch-size", str(eig_batch_size)])
                    if rho_floor     is not None: a.extend(["--nci-rho-floor",       str(rho_floor)])
                    if nci_device:               a.extend(["--nci-device",          nci_device])
                    return a

                # Ensure xtb and obabel are on PATH
                xtb_dir = r"C:\ProgramData\xtb\xtb-6.7.1\bin"
                scripts_dir = r"C:\Users\Administrator\AppData\Local\Packages\PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0\LocalCache\local-packages\Python311\Scripts"
                extra_path = f"{xtb_dir};{scripts_dir}"
                proc_env = os.environ.copy()
                proc_env["PATH"] = f"{extra_path};{proc_env.get('PATH', '')}"

                if output_dir:
                    clean_output_dir = output_dir.lstrip("./\\").rstrip("/\\")
                    output_root = str(UPLOAD_DIR / clean_output_dir) if clean_output_dir else str(UPLOAD_DIR)
                else:
                    output_root = str(UPLOAD_DIR)

                # ---------------------------------------------------------------
                # PER-FILE LOOP — parallel with concurrency limit
                # ---------------------------------------------------------------
                run_failed = False
                all_file_results: list[dict] = []
                concurrency = min(config.get("concurrency", 4) or 4, len(input_files))
                sem = asyncio.Semaphore(concurrency)
                file_lock = asyncio.Lock()

                async def _process_one(file_path: str):
                    nonlocal run_failed
                    if run_id in STOP_REQUESTED:
                        return
                    async with sem:
                        file_name = Path(file_path).name
                        args = _build_args(file_path)
                        cmd_display = " ".join(str(a) for a in args)
                        await websocket.send_json({"type": "log", "message": f"[{file_name}] Starting..."})

                        try:
                            process = await asyncio.create_subprocess_exec(
                                *args,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                cwd=str(UPLOAD_DIR),
                                env=proc_env
                            )

                            async def _stream(stream):
                                while True:
                                    line = await stream.readline()
                                    if not line:
                                        break
                                    text = line.decode(errors="replace").strip()
                                    if text:
                                        RUN_LOGS.setdefault(run_id, []).append(text)
                                        await websocket.send_json({"type": "log", "message": text})

                            await asyncio.wait_for(
                                asyncio.gather(_stream(process.stdout), _stream(process.stderr)),
                                timeout=TIMEOUT_SECONDS
                            )
                            returncode = await process.wait()

                        except asyncio.TimeoutError:
                            process.kill()
                            async with file_lock:
                                run_record["failedFiles"] = run_record.get("failedFiles", 0) + 1
                            await websocket.send_json({
                                "type": "log",
                                "message": f"[{file_name}] TIMEOUT after {TIMEOUT_SECONDS}s"
                            })
                            async with file_lock:
                                run_failed = True
                            return

                        if returncode != 0:
                            async with file_lock:
                                run_record["failedFiles"] = run_record.get("failedFiles", 0) + 1
                            await websocket.send_json({
                                "type": "log",
                                "message": f"[{file_name}] exited with code {returncode}"
                            })
                            async with file_lock:
                                run_failed = True
                            return

                        parsed = _read_results_from_output_root(run_id, output_root)
                        file_result = next(
                            (r for r in parsed if Path(r.get("fileName", "")).name == file_name or r.get("fileName") == file_name),
                            None
                        )
                        if not file_result and parsed:
                            async with file_lock:
                                existing_ids = {r["id"] for r in all_file_results}
                            new_results = [r for r in parsed if r["id"] not in existing_ids]
                            file_result = new_results[0] if new_results else None

                        async with file_lock:
                            if file_result:
                                db.save_result(file_result)
                                all_file_results.append(file_result)
                                RESULT_HISTORY.append(file_result)
                                run_record["completedFiles"] = run_record.get("completedFiles", 0) + 1
                                run_record["successFiles"]   = run_record.get("successFiles", 0) + 1
                                db.update_run_status(run_id, run_record)
                                await websocket.send_json({
                                    "type": "file_result",
                                    "result": file_result
                                })
                            else:
                                run_record["completedFiles"] = run_record.get("completedFiles", 0) + 1

                await websocket.send_json({
                    "type": "status",
                    "message": f"Processing {len(input_files)} files ({concurrency} parallel)..."
                })
                await asyncio.gather(*[_process_one(fp) for fp in input_files])

                # ---------------------------------------------------------------
                # All files done — finalize run
                # ---------------------------------------------------------------
                if run_id in STOP_REQUESTED:
                    run_record["status"] = "stopped"
                    run_record["stoppedFiles"] = len(input_files) - run_record.get("completedFiles", 0)
                    await websocket.send_json({"type": "status", "message": "Run stopped."})
                elif run_failed and not all_file_results:
                    run_record["status"] = "failed"
                    await websocket.send_json({
                        "type": "error",
                        "message": "All files failed. Check terminal logs."
                    })
                else:
                    run_record["status"] = "completed"
                    run_record["completedAt"] = datetime.utcnow().isoformat() + "Z"
                    await websocket.send_json({
                        "type": "completed",
                        "message": f"Run complete — {run_record.get('successFiles', 0)}/{len(input_files)} files processed.",
                        "output_dir": output_root
                    })

                db.update_run_status(run_id, run_record)

                # ---------------------------------------------------------------
                # Global renormalization across ALL historical results
                # ---------------------------------------------------------------
                updated_results = db.renormalize_all()
                await websocket.send_json({
                    "type": "normalized_update",
                    "message": f"Global normalization updated — {len(updated_results)} molecules across all runs.",
                    "count": len(updated_results)
                })
                STOP_REQUESTED.discard(run_id)

            elif action in ("stop_run", "q"):
                run_id = data.get("runId")
                if not run_id:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Missing runId for stop request."
                    })
                    continue
                STOP_REQUESTED.add(run_id)
                run_record = next((r for r in RUN_HISTORY if r["id"] == run_id), None)
                if run_record:
                    run_record["status"] = "stop_requested"
                process = ACTIVE_PROCESSES.get(run_id)
                if process and process.returncode is None:
                    _kill_process_tree(process.pid)
                    await websocket.send_json({
                        "type": "status",
                        "message": "Stop requested."
                    })
                else:
                    await websocket.send_json({
                        "type": "status",
                        "message": "Stop requested, but no active process was found."
                    })

    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


def _find_nciforge() -> str:
    # 1. Check KNF_STUDIO_VENV environment variable
    venv_env = os.environ.get("KNF_STUDIO_VENV")
    candidates = []
    if venv_env:
        venv_path = Path(venv_env)
        candidates.append(str(venv_path / "Scripts" / "nciforge.exe"))
        candidates.append(str(venv_path / "bin" / "nciforge"))

    # 2. Check traditional local candidates relative to current file (dev environment fallback)
    candidates.extend([
        "nciforge",
        "nciforge.exe",
        os.path.join(os.path.dirname(__file__), "venv", "Scripts", "nciforge.exe"),
        os.path.join(os.path.dirname(__file__), ".venv-nciforge", "Scripts", "nciforge.exe"),
        os.path.join(os.path.dirname(__file__), ".venv-nciforge", "bin", "nciforge"),
    ])

    # 3. Add system python global/user-site script candidates via globbing
    appdata = os.environ.get("APPDATA")
    if appdata:
        roaming_python = Path(appdata) / "Python"
        if roaming_python.exists():
            for p in roaming_python.glob("Python*/Scripts/nciforge.exe"):
                candidates.append(str(p))
            for p in roaming_python.glob("Python*/Scripts/nciforge"):
                candidates.append(str(p))

    local_appdata = os.environ.get("LOCALAPPDATA")
    if local_appdata:
        local_python = Path(local_appdata) / "Programs" / "Python"
        if local_python.exists():
            for p in local_python.glob("Python*/Scripts/nciforge.exe"):
                candidates.append(str(p))
            for p in local_python.glob("Python*/Scripts/nciforge"):
                candidates.append(str(p))
        
        # Windows Store python packages
        packages = Path(local_appdata) / "Packages"
        if packages.exists():
            for p in packages.glob("PythonSoftwareFoundation.Python.*/LocalCache/local-packages/Python*/Scripts/nciforge.exe"):
                candidates.append(str(p))

    for c in candidates:
        if os.path.isabs(c):
            if os.path.exists(c) and os.path.isfile(c):
                return c
        else:
            resolved = shutil.which(c)
            if resolved:
                return resolved

    raise RuntimeError("nciforge not found. Install with: pip install -e /path/to/NCIForge")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
