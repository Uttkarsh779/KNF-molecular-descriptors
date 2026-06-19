# -*- mode: python ; coding: utf-8 -*-
"""
knf_studio.spec — PyInstaller build spec for the KNF Studio backend server.

This freezes ONLY the FastAPI/uvicorn API layer.
Heavy computation (torch, nciforge, xtb, obabel) runs as a subprocess
with its own venv — it does NOT need to be bundled here.

Keeping torch out of this bundle:
  - Reduces frozen bundle from ~700 MB -> ~60 MB
  - Cuts PyInstaller analysis time from 15 min -> 3-4 min
  - Eliminates c10.dll / DLL initialization errors on end-user machines
  - The /api/health endpoint already handles torch=None gracefully

Usage (from backend/NCIForge/ with venv activated):
    pyinstaller knf_studio.spec --clean
"""

from pathlib import Path

HERE = Path(SPECPATH)  # noqa: F821 – injected by PyInstaller

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
a = Analysis(  # noqa: F821
    [str(HERE / "_main.py")],
    pathex=[str(HERE)],
    binaries=[],
    datas=[
        # server.py and database.py are shipped as plain .py data files so
        # that targeted hot-patches don't require a full PyInstaller rebuild.
        (str(HERE / "server.py"),  "."),
        (str(HERE / "database.py"), "."),
    ],
    hiddenimports=[
        # ── uvicorn internals (not found by static analysis) ─────────────────
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.lifespan",
        "uvicorn.lifespan.off",
        "uvicorn.lifespan.on",
        # ── FastAPI / Starlette ───────────────────────────────────────────────
        "fastapi",
        "fastapi.middleware",
        "fastapi.middleware.cors",
        "starlette",
        "starlette.middleware",
        "starlette.middleware.cors",
        "starlette.routing",
        "starlette.staticfiles",
        "starlette.websockets",
        # ── Async runtime ─────────────────────────────────────────────────────
        "anyio",
        "anyio._backends._asyncio",
        "anyio._backends._trio",
        # ── HTTP / WebSocket libs ─────────────────────────────────────────────
        "h11",
        "httptools",
        "websockets",
        "wsproto",
        # ── stdlib modules often missed by static analysis ────────────────────
        "email.mime.text",
        "email.mime.multipart",
        "multiprocessing.pool",
        "sqlite3",
        "statistics",
        "csv",
        "logging",
        "logging.handlers",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # ── Torch ecosystem ── THE #1 build-time cost and DLL error source ────
        # server.py never imports torch at the top level; it's only tried
        # optionally inside _check_dependencies() which catches all exceptions.
        # The nciforge subprocess uses its own torch from its venv.
        "torch",
        "torch.cuda",
        "torchvision",
        "torchaudio",
        # ── Heavy scientific stack (not used by the API layer) ────────────────
        "numpy",
        "scipy",
        "pandas",
        "PIL",
        "Pillow",
        "matplotlib",
        "sklearn",
        "skimage",
        # ── Dev / notebook / test tools ───────────────────────────────────────
        "IPython",
        "jupyter",
        "pytest",
        "tkinter",
        "_tkinter",
    ],
    noarchive=False,
    # optimize=0: no bytecode optimization — avoids subtle freeze-mode bugs
    # where optimized .pyc strips assert statements and docstrings in ways
    # that interact badly with some introspection-heavy libraries.
    optimize=0,
)

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,   # onedir mode — _internal/ next to server.exe
    name="server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,            # keep console so Electron captures stdout/stderr
    icon=None,
)

coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="server",           # output: dist/server/
)
