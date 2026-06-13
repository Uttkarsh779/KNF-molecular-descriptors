# KNF Studio — Setup & Run Guide

## Project Structure

```
knf-ui/
├── frontend/                        # React + Electron desktop app
│   ├── src/                         #   React pages, components, hooks, types
│   ├── electron/                    #   Electron main process & IPC bridge
│   ├── public/                      #   Static assets (icons, robots.txt)
│   ├── scripts/                     #   Build-time helpers (Vite, Electron)
│   ├── index.html                   #   HTML entry point
│   ├── package.json                 #   Node dependencies & npm scripts
│   ├── vite.config.ts               #   Vite bundler config (port 8080)
│   ├── tailwind.config.ts           #   Tailwind CSS config
│   ├── tsconfig*.json               #   TypeScript configs (app / node / electron)
│   └── components.json              #   shadcn/ui registry
│
├── backend/
│   └── NCIForge/                    # FastAPI + Python computation engine
│       ├── server.py                #   Uvicorn HTTP server (port 8765)
│       ├── knf_core/                #   KNF descriptor pipeline
│       └── scripts/                 #   Backend installation helpers
│           ├── install_nciforge.ps1 #     Windows PowerShell installer
│           ├── install_nciforge.sh  #     Unix/macOS installer
│           └── install_nciforge_cli.py #  Interactive installer (cross-platform)
│
├── scripts/                         # Project-level install scripts
│   ├── bootstrap.ps1                #   Combined installer (frontend + backend)
│   └── install-frontend.ps1        #   Frontend-only installer
│
├── install.bat                      # Install everything (Windows, one-shot)
├── install-frontend.bat             # Install frontend only  (Windows)
├── install-backend.bat              # Install backend only   (Windows)
├── run-frontend.bat                 # Start frontend         (Windows)
├── run-backend.bat                  # Start backend          (Windows)
├── install-frontend.sh              # Install frontend only  (Unix/macOS)
├── run-frontend.sh                  # Start frontend         (Unix/macOS)
└── run-backend.sh                   # Start backend          (Unix/macOS)
```

---

## Prerequisites

### Required on all platforms

| Tool | Version | Install |
|------|---------|---------|
| Node.js | LTS (18 +) | https://nodejs.org or `winget install OpenJS.NodeJS.LTS` |
| Python | 3.11 + | https://python.org or `winget install Python.Python.3.11` |
| xtb | any | `winget install GrimmeLab.xTB` or `conda install -c conda-forge xtb` |
| Open Babel | 3.x | `winget install OpenBabel.OpenBabel` or `conda install -c conda-forge openbabel` |

> **Note:** `xtb` and `obabel` must be on `PATH` for calculations to run. The backend installer
> attempts to auto-detect and register them; see [External Tools](#external-tools) if they are missing.

---

## Installation

### Option A — Install everything at once (Windows)

```bat
install.bat
```

This installs all Node.js dependencies **and** the Python backend in one step.

---

### Option B — Install frontend and backend separately

#### 1. Frontend (Node.js / React / Electron)

**Windows:**
```bat
install-frontend.bat
```

**Unix / macOS:**
```bash
chmod +x install-frontend.sh
./install-frontend.sh
```

What it does:
- Detects (or optionally installs) Node.js via `winget`
- Runs `npm install` inside the `frontend/` directory
- Installs all React, Vite, Electron, and Tailwind dependencies

---

#### 2. Backend (Python / FastAPI / NCIForge)

**Windows:**
```bat
install-backend.bat
```

**Unix / macOS:**
```bash
chmod +x backend/NCIForge/scripts/install_nciforge.sh
./backend/NCIForge/scripts/install_nciforge.sh
```

What it does:
- Creates a Python virtual environment at `backend/NCIForge/.venv-nciforge/`
- Installs the `knf` package and all its dependencies
- Optionally installs PyTorch (CPU or GPU build)
- Detects and registers `xtb` / `obabel` on `PATH`

**Backend installer options (PowerShell):**

```powershell
# Interactive (prompts for scope, PyTorch mode, external tools)
powershell -File backend\NCIForge\scripts\install_nciforge.ps1

# Non-interactive with defaults
powershell -File backend\NCIForge\scripts\install_nciforge.ps1 -Scope local -Torch cpu -External auto

# GPU build of PyTorch
powershell -File backend\NCIForge\scripts\install_nciforge.ps1 -Scope local -Torch gpu
```

---

## Running Locally

### Run everything together (frontend + backend in one terminal)

```bat
run-frontend.bat
```

The Electron app starts Vite on `http://localhost:8080` and automatically spawns the Python backend on `http://127.0.0.1:8765`.

---

### Run frontend and backend in separate terminals

Open **two** terminal windows from the project root.

**Terminal 1 — backend:**

```bat
run-backend.bat
```
or (Unix):
```bash
./run-backend.sh
```

Wait until you see `Application startup complete` before starting the frontend.

**Terminal 2 — frontend:**

```bat
run-frontend.bat
```
or (Unix):
```bash
./run-frontend.sh
```

The Electron window opens and connects to the backend at `http://127.0.0.1:8765`.

---

### Run from inside the frontend directory (developer workflow)

```bash
cd frontend
npm run dev          # Vite + Electron (full app)
npm run dev:backend  # Backend only (Uvicorn)
npm run build        # Production build
npm test             # Run Vitest tests
npm run lint         # ESLint check
```

---

## Ports

| Service | URL | Notes |
|---------|-----|-------|
| Vite dev server | `http://localhost:8080` | Hot-reload React |
| Backend API | `http://127.0.0.1:8765` | FastAPI / Uvicorn |
| Electron window | — | Loads Vite in dev, `dist/` in prod |

---

## External Tools

If `xtb` or `obabel` are not found after installation, install them manually:

```powershell
# Windows — winget
winget install --id GrimmeLab.xTB -e
winget install --id OpenBabel.OpenBabel -e

# conda / mamba (all platforms)
conda install -c conda-forge xtb openbabel
```

Then confirm they are on `PATH`:
```powershell
xtb --version
obabel --version
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `npm: command not found` | Install Node.js LTS; restart terminal |
| `python: not found` | Install Python 3.11+; restart terminal; or use `py -3` |
| Port 8765 already in use | Close the other app using that port and retry |
| `npm run dev` fails immediately | Run `install-frontend.bat` first |
| Backend does not start | Ensure Python is installed and the venv was created by `install-backend.bat` |
| Calculations fail / no results | Install `xtb` and `obabel` and ensure they are on `PATH` |
| Electron window is blank | Wait for Vite to finish compiling (watch the terminal) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop wrapper | Electron 30 |
| Frontend build | Vite 5 + TypeScript |
| UI framework | React 18 + React Router 6 |
| Component library | shadcn/ui + Radix UI + Tailwind CSS 3 |
| State / data | TanStack Query 5 + React Hook Form + Zod |
| Charts | Recharts + custom quadrant chart |
| 3D viewer | 3Dmol.js |
| Backend | FastAPI + Uvicorn (Python 3.11) |
| Chemistry | RDKit, xTB, Open Babel |
| Optional GPU | PyTorch (CPU or CUDA 12.8 build) |
