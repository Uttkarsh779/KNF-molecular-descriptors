"""
_main.py — PyInstaller entry-point for KNF Studio backend.

This is the real __main__ of the frozen server.exe produced by PyInstaller.
It must be robust enough to work on ANY Windows machine, including those that
have never had Python installed.
"""
import sys
import os
import multiprocessing
import tempfile

# ── MUST be the very first call in a frozen Windows exe ─────────────────────
multiprocessing.freeze_support()

import logging
import traceback
from pathlib import Path

# ── Crash log — written BEFORE any other imports so we always capture errors ─
try:
    _log_dir = Path(os.environ.get("LOCALAPPDATA", "")) / "KNFStudio"
    _log_dir.mkdir(parents=True, exist_ok=True)
except Exception:
    _log_dir = Path(tempfile.gettempdir())

_log_path = str(_log_dir / "server.log")

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(_log_path, encoding="utf-8", mode="w"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("knf_main")

# ── Frozen-exe path fix ──────────────────────────────────────────────────────
# In onedir PyInstaller mode, sys._MEIPASS == the _internal/ folder next to
# the .exe. All bundled .py/.pyc/.pyd/.dll files live there. We must:
#   1) Add it to sys.path so `import server` finds server.py / server.pyc
#   2) chdir there so any code that uses relative paths works correctly.
if hasattr(sys, "_MEIPASS"):
    _bundle_dir = sys._MEIPASS
else:
    _bundle_dir = os.path.dirname(os.path.abspath(__file__))

if _bundle_dir not in sys.path:
    sys.path.insert(0, _bundle_dir)

try:
    os.chdir(_bundle_dir)
except Exception:
    pass

log.info("=== KNF Studio Backend Starting ===")
log.info("Frozen  : %s", getattr(sys, "frozen", False))
log.info("MEIPASS : %s", getattr(sys, "_MEIPASS", "N/A"))
log.info("CWD     : %s", os.getcwd())
log.info("Log     : %s", _log_path)
log.info("Python  : %s", sys.version)
log.info("Argv    : %s", sys.argv)


def main() -> None:
    port = 8765
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            log.warning("Invalid port argument '%s', defaulting to 8765", sys.argv[1])

    log.info("Target port: %d", port)

    try:
        # ── Windows: must use SelectorEventLoop ─────────────────────────────
        # ProactorEventLoop (the Windows default since Python 3.8) has known
        # incompatibilities with some of uvicorn's socket operations inside a
        # PyInstaller frozen exe. SelectorEventLoop is stable.
        import asyncio
        if sys.platform == "win32":
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
            log.info("Event loop: WindowsSelectorEventLoopPolicy")

        log.info("Importing uvicorn...")
        import uvicorn
        log.info("uvicorn %s imported OK", getattr(uvicorn, "__version__", "?"))

        log.info("Importing server.app...")
        from server import app  # type: ignore[import]
        log.info("server.app imported OK")

        log.info("Starting uvicorn on 127.0.0.1:%d", port)
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=port,
            log_level="info",
            # Explicitly set lifespan so FastAPI startup events fire
            lifespan="on",
        )

    except Exception:
        log.critical("FATAL startup error:\n%s", traceback.format_exc())
        # Print to stderr as well so Electron captures it
        print("FATAL:", traceback.format_exc(), file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
