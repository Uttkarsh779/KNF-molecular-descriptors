"""
Lightweight API + WebSocket server wrapper for NCIForge CLI.
Bridges the React frontend with the CLI tool.

Usage: python server.py
"""
from fastapi import FastAPI, WebSocket, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

app = FastAPI(title="NCIForge API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
                "SCDI": 0.0,
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
    try:
        import torch
        checks["torch"] = torch.__version__
    except ImportError:
        checks["torch"] = None

    nciforge_path = None
    try:
        nciforge_path = _find_nciforge()
        checks["nciforge"] = nciforge_path
    except RuntimeError:
        checks["nciforge"] = None

    checks["xtb"] = _find_on_path("xtb")
    checks["obabel"] = _find_on_path("obabel")

    return checks


@app.on_event("startup")
async def hydrate_from_disk() -> None:
    _seed_history_from_disk()

@app.get("/api/health")
async def health():
    deps = _check_dependencies()
    missing = [k for k, v in deps.items() if v is None]
    return {
        "status": "ok" if not missing else "degraded",
        "upload_dir": str(UPLOAD_DIR),
        "dependencies": deps,
        "missing": missing,
    }

@app.post("/api/upload")
async def upload_files(files: list[UploadFile] = File(...)):
    saved = []
    for f in files:
        dest = UPLOAD_DIR / f.filename
        with open(dest, "wb") as out:
            content = await f.read()
            out.write(content)
        saved.append({"name": f.filename, "size": len(content), "path": str(dest)})
    return {"files": saved}

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


@app.get("/api/runs")
async def get_runs():
    if not RUN_HISTORY:
        _seed_history_from_disk()
    return {"runs": RUN_HISTORY}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = next((r for r in RUN_HISTORY if r["id"] == run_id), None)
    return {"run": run}


@app.get("/api/runs/{run_id}/logs")
async def get_run_logs(run_id: str):
    return {"logs": RUN_LOGS.get(run_id, [])}


@app.get("/api/results")
async def get_results():
    if not RUN_HISTORY and not RESULT_HISTORY:
        _seed_history_from_disk()
    combined: dict[tuple[str, str], dict] = {}
    for record in RESULT_HISTORY:
        combined[(str(record.get("runId")), str(record.get("fileName")))] = record

    for run in RUN_HISTORY:
        run_id = run.get("id")
        output_root = run.get("config", {}).get("outputDirectory") if isinstance(run.get("config"), dict) else None
        if not run_id or not output_root:
            continue
        parsed = _read_results_from_output_root(str(run_id), str(output_root))
        for record in parsed:
            combined[(str(record.get("runId")), str(record.get("fileName")))] = record

    return {"results": list(combined.values())}

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
                run_name = f"Run {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}"
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
                RUN_HISTORY.insert(0, run_record)
                RUN_LOGS[run_id] = [f"[{datetime.utcnow().isoformat()}] Run created"]

                deps = _check_dependencies()
                missing = [k for k, v in deps.items() if v is None]
                if missing:
                    issues = []
                    if "torch" in missing:
                        issues.append("PyTorch (torch) is not installed")
                    if "xtb" in missing:
                        issues.append("xtb (extended tight binding) is not on PATH")
                    if "obabel" in missing:
                        issues.append("Open Babel (obabel) is not on PATH")
                    if "nciforge" in missing:
                        issues.append("nciforge CLI is not installed")

                    await websocket.send_json({
                        "type": "error",
                        "message": "Missing dependencies: " + "; ".join(issues) +
                                   ". This system doesn't have the required computational chemistry tools installed."
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
                args = [nciforge_path]

                if len(input_files) == 1:
                    args.append(input_files[0])
                else:
                    args.append(str(UPLOAD_DIR))

                charge = config.get("charge", 0)
                spin = config.get("spin", 1)
                processing_mode = config.get("processingMode", "auto")
                nci_backend = config.get("nciBackend", "torch")
                gpu_enabled = config.get("gpuEnabled", False)
                force = config.get("forceRecomputation", False)
                clean = config.get("cleanOutputs", True)
                debug = config.get("debugMode", False)
                enable_stop = config.get("enableStopKey", True)
                interactive = config.get("interactiveQuadrant", False)
                workers = config.get("workers")
                output_dir = config.get("outputDirectory", "")

                args.extend(["--charge", str(charge)])
                args.extend(["--spin", str(spin)])
                args.extend(["--processing", processing_mode])
                args.extend(["--nci-backend", nci_backend])

                if gpu_enabled:
                    args.append("--gpu")
                if force:
                    args.append("--force")
                if clean:
                    args.append("--clean")
                if debug:
                    args.append("--debug")
                if enable_stop:
                    args.append("--enable-stop-key")
                if interactive:
                    args.append("--interactive-quadrant-plot")
                if workers:
                    args.extend(["--workers", str(workers)])
                if output_dir:
                    args.extend(["--output-dir", output_dir])

                grid_spacing = config.get("gridSpacing")
                grid_padding = config.get("gridPadding")
                batch_size = config.get("batchSize")
                eig_batch_size = config.get("eigBatchSize")
                rho_floor = config.get("rhoFloor")
                nci_device = config.get("nciDevice")

                if grid_spacing is not None:
                    args.extend(["--nci-grid-spacing", str(grid_spacing)])
                if grid_padding is not None:
                    args.extend(["--nci-grid-padding", str(grid_padding)])
                if batch_size is not None:
                    args.extend(["--nci-batch-size", str(batch_size)])
                if eig_batch_size is not None:
                    args.extend(["--nci-eig-batch-size", str(eig_batch_size)])
                if rho_floor is not None:
                    args.extend(["--nci-rho-floor", str(rho_floor)])
                if nci_device:
                    args.extend(["--nci-device", nci_device])

                cmd_display = " ".join(str(a) for a in args)
                await websocket.send_json({
                    "type": "command",
                    "message": cmd_display
                })

                # Ensure xtb and obabel are on PATH
                xtb_dir = r"C:\ProgramData\xtb\xtb-6.7.1\bin"
                scripts_dir = r"C:\Users\Administrator\AppData\Local\Packages\PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0\LocalCache\local-packages\Python311\Scripts"
                extra_path = f"{xtb_dir};{scripts_dir}"
                proc_env = os.environ.copy()
                proc_env["PATH"] = f"{extra_path};{proc_env.get('PATH', '')}"

                process = await asyncio.create_subprocess_exec(
                    *args,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=str(UPLOAD_DIR),
                    env=proc_env
                )
                ACTIVE_PROCESSES[run_id] = process
                STOP_REQUESTED.discard(run_id)

                async def stream_output(stream, label):
                    while True:
                        line = await stream.readline()
                        if not line:
                            break
                        text = line.decode(errors="replace").strip()
                        if text:
                            RUN_LOGS[run_id].append(text)
                            await websocket.send_json({
                                "type": "log",
                                "message": text
                            })

                try:
                    await asyncio.wait_for(
                        asyncio.gather(
                            stream_output(process.stdout, "out"),
                            stream_output(process.stderr, "err")
                        ),
                        timeout=TIMEOUT_SECONDS
                    )

                    returncode = await process.wait()

                    if run_id in STOP_REQUESTED:
                        run_record["status"] = "stopped"
                        run_record["stoppedFiles"] = len(filenames)
                        await websocket.send_json({
                            "type": "status",
                            "message": "Run stopped."
                        })
                    elif returncode == 0:
                        run_record["status"] = "completed"
                        await websocket.send_json({
                            "type": "completed",
                            "message": "All files processed successfully.",
                            "output_dir": str(UPLOAD_DIR)
                        })

                        result_files = []
                        # Resolve output_root relative to UPLOAD_DIR (where nciforge runs)
                        if output_dir:
                            clean_output_dir = output_dir.lstrip("./\\").rstrip("/\\")
                            output_root = str(UPLOAD_DIR / clean_output_dir) if clean_output_dir else str(UPLOAD_DIR)
                        else:
                            output_root = str(UPLOAD_DIR)
                        for root, _, files in os.walk(output_root):
                            for fn in files:
                                if fn.endswith((".json", ".csv", ".txt", ".png")):
                                    rel = os.path.relpath(os.path.join(root, fn), output_root)
                                    result_files.append(rel)
                        if result_files:
                            parsed_results = _read_results_from_output_root(run_id, output_root)
                            RESULT_HISTORY.extend(parsed_results)
                            run_record["completedFiles"] = len(parsed_results)
                            run_record["successFiles"] = len(parsed_results)
                            await websocket.send_json({
                                "type": "results",
                                "files": result_files
                            })
                    elif not run_id in STOP_REQUESTED:
                        run_record["status"] = "failed"
                        run_record["failedFiles"] = len(filenames)
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Process exited with code {returncode}. Check logs above for details."
                        })

                except asyncio.TimeoutError:
                    process.kill()
                    run_record["status"] = "failed"
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Process timed out after {TIMEOUT_SECONDS} seconds."
                    })
                finally:
                    ACTIVE_PROCESSES.pop(run_id, None)
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
    candidates = [
        "nciforge",
        "nciforge.exe",
        os.path.join(os.path.dirname(__file__), "venv", "Scripts", "nciforge.exe"),
        os.path.join(os.path.dirname(__file__), ".venv-nciforge", "Scripts", "nciforge.exe"),
        os.path.join(os.path.dirname(__file__), ".venv-nciforge", "bin", "nciforge"),
    ]
    for c in candidates:
        resolved = shutil.which(c)
        if resolved:
            return resolved
    scripts_dir = os.path.join(
        os.environ.get("LOCALAPPDATA", ""),
        "Packages", "PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0",
        "LocalCache", "local-packages", "Python311", "Scripts", "nciforge.exe"
    )
    if os.path.exists(scripts_dir):
        return scripts_dir
    raise RuntimeError("nciforge not found. Install with: pip install -e /path/to/NCIForge")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
