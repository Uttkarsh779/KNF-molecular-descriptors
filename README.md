# KNF Studio — Complete Setup & Installation Guide

KNF Studio is a desktop application for computing **KNF molecular descriptors** — fingerprints that describe how molecules interact with each other at the quantum-chemical level. It combines a modern React user interface inside an Electron desktop shell with a Python computation engine that runs xTB geometry optimization and NCI (Non-Covalent Interaction) analysis.

---

## Table of Contents

1. [What Is KNF Studio?](#1-what-is-knf-studio)
2. [Quick Start — Experienced Developers](#2-quick-start--experienced-developers)
3. [External Dependencies](#3-external-dependencies)
4. [Project Structure](#4-project-structure)
5. [Windows — Step-by-Step Setup](#5-windows--step-by-step-setup)
6. [Linux — Step-by-Step Setup](#6-linux--step-by-step-setup)
7. [macOS — Step-by-Step Setup](#7-macos--step-by-step-setup)
8. [Running the Application](#8-running-the-application)
9. [Verifying Everything Works](#9-verifying-everything-works)
10. [Troubleshooting](#10-troubleshooting)
11. [Future Docker Support](#11-future-docker-support)
12. [Tech Stack Reference](#12-tech-stack-reference)

---

## 1. What Is KNF Studio?

KNF Studio takes molecular structure files (`.xyz` format) as input and produces a rich set of descriptors that characterise how molecules interact. The pipeline works like this:

```
Your .xyz file
     │
     ▼
 xTB optimizer          — refines the molecular geometry using quantum mechanics
     │
     ▼
 NCI analysis (PyTorch) — maps regions of non-covalent interaction
     │
     ▼
 KNF descriptor engine  — produces a 9-number feature vector (f1–f9)
     │
     ▼
 KUID fingerprint       — a hex code uniquely describing the interaction type
     │
     ▼
 Quadrant classification — places the molecule in Q1/Q2/Q3/Q4 on a 2-D plot
     │
     ▼
 Results table + Explorer scatter plot shown in the Electron window
```

**What you get out of it:** A table of per-molecule descriptors and an interactive scatter plot comparing all uploaded structures.

---

## 2. Quick Start — Experienced Developers

> If you are already comfortable with Node.js, Python virtual environments, and the command line, use this section. Everyone else should start at [Section 5](#5-windows--step-by-step-setup) for their operating system.

**Prerequisites:** Node.js 18+, Python 3.10 or 3.11, xTB 6.x, Open Babel 3.x already installed and on `PATH`.

```bash
# 1. Clone and enter the repository
git clone <repo-url>
cd knf-ui

# 2. Install Node.js dependencies
cd frontend && npm install && cd ..

# 3. Create Python venv and install backend
python -m venv backend/NCIForge/.venv-nciforge
# Windows:
backend\NCIForge\.venv-nciforge\Scripts\python.exe -m pip install --upgrade pip
backend\NCIForge\.venv-nciforge\Scripts\python.exe -m pip install -e backend/NCIForge
backend\NCIForge\.venv-nciforge\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
# Linux / macOS:
backend/NCIForge/.venv-nciforge/bin/python -m pip install --upgrade pip
backend/NCIForge/.venv-nciforge/bin/python -m pip install -e backend/NCIForge
backend/NCIForge/.venv-nciforge/bin/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu

# 4. Launch
# Windows:
run-frontend.bat
# Linux / macOS:
./run-frontend.sh
```

> **Important for Windows users:** Do **not** run `npm run dev` from a terminal that has `ELECTRON_RUN_AS_NODE=1` set. If you are inside VS Code's integrated terminal, open a separate PowerShell or Command Prompt window instead. See [Troubleshooting](#10-troubleshooting) for details.

---

## 3. External Dependencies

This section lists every dependency the project needs, what it does, whether it is required, and how to install it. Read this before starting the platform-specific setup.

---

### Node.js

| | |
|---|---|
| **What it is** | A runtime that lets you execute JavaScript outside a web browser. The desktop app's frontend is built with JavaScript/TypeScript tools that all run on Node.js. |
| **Why we need it** | To install the app's frontend packages (`npm install`), run the Vite development server, and compile TypeScript to JavaScript. |
| **Mandatory?** | **Yes** |
| **Required version** | **18 LTS or newer** (18.x or 20.x recommended; avoid odd-numbered versions like 19, 21) |
| **Download** | <https://nodejs.org> — click the "LTS" button |
| **Verify** | `node --version` should print `v18.x.x` or higher |

---

### npm

| | |
|---|---|
| **What it is** | The Node Package Manager — it installs JavaScript libraries listed in `package.json`. |
| **Why we need it** | To install ~300 MB of React, Electron, Vite, and UI libraries in a single command. |
| **Mandatory?** | **Yes** |
| **Required version** | Comes bundled with Node.js — no separate install needed. |
| **Verify** | `npm --version` should print `9.x.x` or higher |

---

### Python

| | |
|---|---|
| **What it is** | A programming language. The entire computation engine (NCI analysis, KUID generation, API server) is written in Python. |
| **Why we need it** | To create the virtual environment and run the FastAPI backend that the Electron app talks to. |
| **Mandatory?** | **Yes** |
| **Required version** | **3.10 or 3.11** (Python 3.12+ has breaking changes with some chemistry packages — do not use 3.12 or newer) |
| **Download** | <https://www.python.org/downloads/> — choose the latest 3.11.x release |
| **Verify** | `python --version` or `python3 --version` should print `3.10.x` or `3.11.x` |

> **What is a virtual environment?** It is an isolated folder that contains its own copy of Python and installed packages. This prevents the project's packages from conflicting with other Python projects on your computer. The installer creates one at `backend/NCIForge/.venv-nciforge/`.

---

### PyTorch

| | |
|---|---|
| **What it is** | A machine-learning library from Meta that can run tensor computations on the CPU or GPU. |
| **Why we need it** | The NCI (Non-Covalent Interaction) analysis step uses PyTorch for fast numerical computation of electron density grids. |
| **Mandatory?** | **Yes** (CPU build is sufficient; GPU build is optional for speed) |
| **Required version** | 2.x — installed automatically by the backend installer |
| **Note** | **You must install from the PyTorch index URL** (shown in the commands below) — installing with plain `pip install torch` gives you the wrong build |
| **CPU install** | `pip install torch --index-url https://download.pytorch.org/whl/cpu` |
| **GPU install** | `pip install torch --index-url https://download.pytorch.org/whl/cu128` (requires NVIDIA GPU + CUDA 12.8) |

---

### xTB (Extended Tight Binding)

| | |
|---|---|
| **What it is** | A quantum-chemistry program developed by the Grimme group. It performs fast semi-empirical geometry optimisation. |
| **Why we need it** | Before computing NCI descriptors, the molecular geometry must be optimised to a local energy minimum. xTB does this in seconds. |
| **Mandatory?** | **Yes** |
| **Required version** | 6.x (6.7.1 recommended) |
| **Windows download** | `winget install --id GrimmeLab.xTB -e` or <https://github.com/grimme-lab/xtb/releases> |
| **Linux** | `sudo apt-get install xtb` or `conda install -c conda-forge xtb` |
| **macOS** | `brew install xtb` or `conda install -c conda-forge xtb` |
| **Verify** | `xtb --version` |

---

### Open Babel (obabel)

| | |
|---|---|
| **What it is** | A chemical file format converter — the "Swiss Army knife" of cheminformatics file conversion. |
| **Why we need it** | The pipeline reads `.xyz` coordinate files and produces `.mol` topology files. Open Babel performs this conversion between xTB optimisation and NCI analysis. |
| **Mandatory?** | **Yes** |
| **Required version** | 3.x (3.1.1 recommended) |
| **Windows download** | `winget install --id OpenBabel.OpenBabel -e` or <https://github.com/openbabel/openbabel/releases> |
| **Linux** | `sudo apt-get install openbabel` or `conda install -c conda-forge openbabel` |
| **macOS** | `brew install open-babel` or `conda install -c conda-forge openbabel` |
| **Verify** | `obabel --version` |

---

### nciforge (the KNF computation engine)

| | |
|---|---|
| **What it is** | The core scientific package of this project. It orchestrates xTB, Open Babel, and PyTorch to compute KNF descriptors and KUID fingerprints. |
| **Why we need it** | It is the computation engine that produces all the scientific output. |
| **Mandatory?** | **Yes** |
| **Required version** | 1.0.8 (installed automatically by the backend installer) |
| **How to install** | Run `install-backend.bat` (Windows) or `install_nciforge.sh` (Linux/macOS) — do **not** try to install this from PyPI |

---

### Git

| | |
|---|---|
| **What it is** | A version control tool used to download (clone) the repository. |
| **Why we need it** | To get the source code onto your computer. |
| **Mandatory?** | **Yes** (for cloning; you can also download a ZIP from GitHub as an alternative) |
| **Download** | <https://git-scm.com/downloads> |
| **Verify** | `git --version` |

---

### Electron (desktop shell)

| | |
|---|---|
| **What it is** | A framework that lets web apps run as native desktop applications. Electron bundles a web browser (Chromium) and Node.js together. |
| **Why we need it** | KNF Studio is a desktop app — Electron provides the window, the file system access, and the process management. |
| **Mandatory?** | **Yes** |
| **Version** | 30.5.1 — installed automatically via `npm install` |
| **You do not install this manually** | It is listed in `package.json` and installed by `npm install` |

---

## 4. Project Structure

```
knf-ui/                              ← Root of the git repository
│
├── frontend/                        ← The desktop app (React + Electron)
│   ├── electron/                    ←   Electron process files
│   │   ├── main.ts                  ←     App entry point; opens the window
│   │   ├── backend.ts               ←     Starts/stops the Python server
│   │   └── preload.cjs              ←     Bridge between web page and OS
│   ├── src/                         ←   React user interface
│   │   ├── pages/                   ←     Screen components (RunManager, Results, Explorer …)
│   │   ├── components/              ←     Reusable UI building blocks
│   │   ├── hooks/                   ←     Custom React logic (WebSocket connection, etc.)
│   │   └── types/                   ←     TypeScript type definitions
│   ├── scripts/                     ←   Build helper scripts (run internally by npm)
│   │   ├── launch-electron.mjs      ←     Safely launches Electron (fixes env variable issue)
│   │   ├── copy-preload.mjs         ←     Copies the IPC bridge into the build output
│   │   └── run-backend.mjs          ←     Starts the Python server standalone
│   ├── package.json                 ←   Node.js dependency list and npm commands
│   ├── vite.config.ts               ←   Vite bundler configuration (dev server on port 5173)
│   └── tsconfig.electron.json       ←   TypeScript settings for the Electron layer
│
├── backend/
│   └── NCIForge/                    ← The Python computation server
│       ├── server.py                ←   FastAPI web server (HTTP + WebSocket on port 8765)
│       ├── knf_core/                ←   The KNF descriptor computation library
│       ├── .venv-nciforge/          ←   Python virtual environment (created by installer)
│       └── scripts/                 ←   Installation helpers
│           ├── install_nciforge.ps1 ←     Windows PowerShell installer (called by install-backend.bat)
│           ├── install_nciforge.sh  ←     Linux/macOS installer
│           └── install_nciforge_cli.py ←  Cross-platform Python installer script
│
├── scripts/                         ← Project-level helper scripts
│   ├── bootstrap.ps1                ←   Master Windows installer (frontend + backend)
│   └── install-frontend.ps1        ←   Frontend-only Windows installer
│
├── install.bat                      ← Install everything at once (Windows)
├── install-frontend.bat             ← Install Node.js dependencies only (Windows)
├── install-backend.bat              ← Install Python backend only (Windows)
├── run-frontend.bat                 ← Start the app (Windows)
├── run-backend.bat                  ← Start Python server only (Windows)
├── install-frontend.sh              ← Install Node.js dependencies only (Linux/macOS)
├── run-frontend.sh                  ← Start the app (Linux/macOS)
└── run-backend.sh                   ← Start Python server only (Linux/macOS)
```

**Key file locations:**
- The Python virtual environment lives at `backend/NCIForge/.venv-nciforge/`
- All Node.js packages live at `frontend/node_modules/` (created by `npm install`)
- Build output for Electron goes to `frontend/dist-electron/`
- Build output for the React app goes to `frontend/dist/`

---

## 5. Windows — Step-by-Step Setup

> **Read this entire section before running any commands.** Each step explains what you are doing and why.

---

### Step 1 — Install Git

Git lets you download the project source code.

1. Open your browser and go to <https://git-scm.com/download/win>
2. Download and run the installer
3. Accept all defaults — the important option is "Git from the command line and also from 3rd-party software"
4. Open a new **PowerShell** window and verify:
   ```powershell
   git --version
   ```
   Expected output: `git version 2.x.x.windows.x`

---

### Step 2 — Install Node.js 18 LTS

Node.js runs the frontend build tools. We need the LTS (Long-Term Support) version — it is more stable than the "current" release.

**Option A — Using winget (recommended, built into Windows 10/11):**
```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

**Option B — Direct download:**
1. Go to <https://nodejs.org>
2. Click the green **"LTS"** button (not "Current")
3. Run the downloaded `.msi` installer — accept all defaults

After installing, **close and reopen** PowerShell, then verify:
```powershell
node --version    # should print v18.x.x or v20.x.x
npm --version     # should print 9.x.x or 10.x.x
```

---

### Step 3 — Install Python 3.11

The backend is written in Python. **Do not use Python 3.12 or newer** — it breaks some chemistry packages.

**Option A — Using winget:**
```powershell
winget install --id Python.Python.3.11 -e
```

**Option B — Direct download:**
1. Go to <https://www.python.org/downloads/windows/>
2. Find the latest **Python 3.11.x** release and download the "Windows installer (64-bit)"
3. Run the installer
4. **On the first screen, check the box "Add Python 3.11 to PATH"** — this is critical
5. Click "Install Now"

After installing, **close and reopen** PowerShell, then verify:
```powershell
python --version    # should print Python 3.11.x
```

> **If `python` is not found:** Try `py --version` or `py -3 --version`. If that works, use `py -3` wherever these instructions say `python`.

---

### Step 4 — Install xTB

xTB is the quantum chemistry tool that optimises molecular geometries.

```powershell
winget install --id GrimmeLab.xTB -e
```

After installation, **close and reopen** PowerShell. Test:
```powershell
xtb --version
```

**If `xtb` is not recognised (common on Windows):** winget installs it to `C:\ProgramData\xtb\xtb-6.7.1\bin\` but does not always update PATH immediately. Add it manually:

```powershell
$xtbPath = "C:\ProgramData\xtb\xtb-6.7.1\bin"
[System.Environment]::SetEnvironmentVariable(
    "Path",
    [System.Environment]::GetEnvironmentVariable("Path", "User") + ";$xtbPath",
    "User"
)
```

Close and reopen PowerShell, then run `xtb --version` again.

---

### Step 5 — Install Open Babel

Open Babel converts molecular file formats between xTB and the NCI analysis step.

```powershell
winget install --id OpenBabel.OpenBabel -e
```

After installation, **close and reopen** PowerShell. Test:
```powershell
obabel --version
```

**If `obabel` is not recognised:** winget installs it to `C:\Program Files\OpenBabel-3.1.1\`. Add it to PATH:

```powershell
$obelPath = "C:\Program Files\OpenBabel-3.1.1"
[System.Environment]::SetEnvironmentVariable(
    "Path",
    [System.Environment]::GetEnvironmentVariable("Path", "User") + ";$obelPath",
    "User"
)
```

Close and reopen PowerShell, then run `obabel --version` again.

> **Why PATH matters:** When the Python backend starts, it looks for `xtb.exe` and `obabel.exe` by searching the directories listed in the PATH environment variable. If they are not in PATH, the app will report them as missing even though they are installed. The backend does also search a few well-known install locations automatically, but adding them to PATH is the most reliable fix.

---

### Step 6 — Clone the Repository

```powershell
git clone <repo-url>
cd knf-ui
```

Replace `<repo-url>` with the actual GitHub URL of this repository.

---

### Step 7 — Install Frontend Dependencies

This downloads all the JavaScript/TypeScript libraries the app needs (React, Electron, Vite, Tailwind CSS, etc.). It will create a `frontend/node_modules/` folder that is about 300 MB.

```bat
install-frontend.bat
```

Or run it manually:
```powershell
cd frontend
npm install
cd ..
```

This takes 1–3 minutes on first run. You should see a progress bar and then something like `added 1234 packages`.

---

### Step 8 — Install the Python Backend

This creates the Python virtual environment, installs the `nciforge` package, installs PyTorch (CPU build), and sets up the paths for xTB and Open Babel.

```bat
install-backend.bat
```

The installer is interactive and will ask you three questions:
- **Install scope** — press Enter to accept `local` (recommended)
- **PyTorch mode** — type `cpu` and press Enter (unless you have an NVIDIA GPU, in which case type `gpu`)
- **Set up external tools?** — press Enter to accept `yes`

This step takes **5–15 minutes** because it downloads PyTorch (~800 MB for CPU build).

After it finishes, verify the nciforge CLI installed correctly:
```powershell
backend\NCIForge\.venv-nciforge\Scripts\python.exe -m knf_core.main --help
```

You should see the nciforge help text. If you get an error, see [Troubleshooting](#10-troubleshooting).

---

### Step 9 — Launch the App

```bat
run-frontend.bat
```

The Electron window will open after 10–30 seconds (Vite needs to compile on first launch).

> **Important:** Always run the app from **PowerShell** or **Command Prompt** opened directly — not from inside VS Code's integrated terminal. The VS Code terminal can set `ELECTRON_RUN_AS_NODE=1` which breaks Electron. See [Troubleshooting](#10-troubleshooting) for details.

---

## 6. Linux — Step-by-Step Setup

> These instructions are written for **Ubuntu / Debian**. Adapt package manager commands for your distribution (replace `apt-get` with `dnf`, `pacman`, etc. as appropriate).

---

### Step 1 — Update Your Package Lists

```bash
sudo apt-get update
```

---

### Step 2 — Install Git

```bash
sudo apt-get install -y git
git --version
```

---

### Step 3 — Install Node.js 18 LTS

The version of Node.js in the default Ubuntu repositories is often too old. Use the official NodeSource repository instead:

```bash
# Add the NodeSource repository for Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# Install Node.js
sudo apt-get install -y nodejs

# Verify
node --version    # should print v18.x.x
npm --version
```

---

### Step 4 — Install Python 3.11

```bash
sudo apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip
```

> The `python3.11-venv` package is needed to create virtual environments. The `python3.11-dev` package is needed by some Python packages that compile C extensions.

Verify:
```bash
python3.11 --version    # should print Python 3.11.x
```

---

### Step 5 — Install xTB

**Option A — apt (Ubuntu 22.04+):**
```bash
sudo apt-get install -y xtb
xtb --version
```

**Option B — conda (recommended if you have Anaconda/Miniconda):**
```bash
conda install -c conda-forge xtb
xtb --version
```

**Option C — Binary release (if the above do not work):**
```bash
# Download the latest Linux release from GitHub
wget https://github.com/grimme-lab/xtb/releases/download/v6.7.1/xtb-6.7.1-linux-x86_64.tar.xz
tar -xf xtb-6.7.1-linux-x86_64.tar.xz
sudo mv xtb-6.7.1 /opt/xtb
echo 'export PATH="/opt/xtb/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
xtb --version
```

---

### Step 6 — Install Open Babel

```bash
sudo apt-get install -y openbabel
obabel --version
```

If the packaged version is too old (needs 3.x):
```bash
conda install -c conda-forge openbabel
```

---

### Step 7 — Clone the Repository

```bash
git clone <repo-url>
cd knf-ui
```

---

### Step 8 — Install Frontend Dependencies

```bash
chmod +x install-frontend.sh
./install-frontend.sh
```

Or manually:
```bash
cd frontend
npm install
cd ..
```

---

### Step 9 — Install the Python Backend

```bash
chmod +x backend/NCIForge/scripts/install_nciforge.sh
./backend/NCIForge/scripts/install_nciforge.sh
```

Or manually (more control):
```bash
# Create the virtual environment with Python 3.11
python3.11 -m venv backend/NCIForge/.venv-nciforge

# Activate it
source backend/NCIForge/.venv-nciforge/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel

# Install nciforge and its dependencies
pip install -e backend/NCIForge

# Install PyTorch (CPU build)
pip install torch --index-url https://download.pytorch.org/whl/cpu

# Deactivate
deactivate
```

Verify:
```bash
backend/NCIForge/.venv-nciforge/bin/python -m knf_core.main --help
```

---

### Step 10 — Install Electron system dependencies (Linux only)

Electron requires several system libraries on Linux. If the app fails to open, install these:

```bash
sudo apt-get install -y \
  libgconf-2-4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libxss1 \
  libasound2 \
  libcups2
```

---

### Step 11 — Launch the App

```bash
chmod +x run-frontend.sh
./run-frontend.sh
```

---

## 7. macOS — Step-by-Step Setup

---

### Step 1 — Install Homebrew (Package Manager)

Homebrew is the standard package manager for macOS. If you already have it, skip this step.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts. After installation, verify:
```bash
brew --version
```

---

### Step 2 — Install Git

macOS often has git pre-installed. Check first:
```bash
git --version
```

If it prompts you to install Xcode Command Line Tools, click Install and wait. Otherwise, install via Homebrew:
```bash
brew install git
```

---

### Step 3 — Install Node.js 18 LTS

```bash
brew install node@18
```

After installation, Homebrew may tell you to add Node.js to your PATH. Follow the instructions printed in the terminal (they involve adding a line to `~/.zprofile` or `~/.bash_profile`).

Verify in a **new terminal window**:
```bash
node --version    # should print v18.x.x
npm --version
```

---

### Step 4 — Install Python 3.11

macOS ships with Python 3.x but it may not be 3.11. Install a specific version:

```bash
brew install python@3.11
```

Verify:
```bash
python3.11 --version    # should print Python 3.11.x
```

> On macOS, always use `python3.11` explicitly in commands rather than `python` or `python3` — the system Python might point to a different version.

---

### Step 5 — Install xTB

```bash
brew install xtb
xtb --version
```

If Homebrew does not have it, use conda:
```bash
conda install -c conda-forge xtb
```

---

### Step 6 — Install Open Babel

```bash
brew install open-babel
obabel --version
```

---

### Step 7 — Clone the Repository

```bash
git clone <repo-url>
cd knf-ui
```

---

### Step 8 — Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

---

### Step 9 — Install the Python Backend

```bash
# Create virtual environment
python3.11 -m venv backend/NCIForge/.venv-nciforge

# Activate
source backend/NCIForge/.venv-nciforge/bin/activate

# Install
pip install --upgrade pip setuptools wheel
pip install -e backend/NCIForge
pip install torch --index-url https://download.pytorch.org/whl/cpu

deactivate
```

Or use the installer script:
```bash
chmod +x backend/NCIForge/scripts/install_nciforge.sh
./backend/NCIForge/scripts/install_nciforge.sh
```

Verify:
```bash
backend/NCIForge/.venv-nciforge/bin/python -m knf_core.main --help
```

---

### Step 10 — Launch the App

```bash
chmod +x run-frontend.sh
./run-frontend.sh
```

---

## 8. Running the Application

Once setup is complete, there are two ways to run the app:

---

### Option A — All-in-one (Recommended)

From the `knf-ui/` directory:

**Windows:**
```bat
run-frontend.bat
```

**Linux / macOS:**
```bash
./run-frontend.sh
```

This single command does everything:
1. Starts the Vite development server on `http://localhost:5173`
2. Compiles the Electron TypeScript source files
3. Copies the IPC bridge file
4. Launches the Electron window (which also auto-starts the Python backend on port 8765)

The window appears after 10–30 seconds on the first run.

---

### Option B — Frontend and Backend in Separate Terminals

This is useful if you want to see the Python server's log output directly, or if you need to restart just the backend without restarting Electron.

**Terminal 1 — Start the Python backend:**

```powershell
# Windows
cd knf-ui\backend\NCIForge
.\.venv-nciforge\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8765
```

```bash
# Linux / macOS
cd knf-ui/backend/NCIForge
.venv-nciforge/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8765
```

Wait until you see this line:
```
INFO:     Application startup complete.
```

**Terminal 2 — Start the Electron frontend:**

```bash
cd knf-ui/frontend
npm run dev
```

---

### Developer npm Commands

From inside `knf-ui/frontend/`:

| Command | What it does |
|---------|-------------|
| `npm run dev` | Starts Vite + Electron (the full desktop app) |
| `npm run dev:backend` | Starts the Python backend only |
| `npm run build` | Compiles everything for production |
| `npm test` | Runs the Vitest unit test suite |
| `npm run lint` | Checks the code for style issues |
| `npm run preview` | Previews the production build |

---

## 9. Verifying Everything Works

After the Electron window opens, check these things:

### 1. Dependency Status Bar

At the top of the window you should see four coloured indicators. All four must be green before calculations work:

| Indicator | What it checks | What to do if red |
|-----------|---------------|-------------------|
| **torch** | PyTorch is importable in the venv | Reinstall: `pip install torch --index-url https://download.pytorch.org/whl/cpu` |
| **nciforge** | The `nciforge` CLI is found | Re-run `install-backend.bat` |
| **xtb** | The `xtb` binary is on PATH | Add `xtb` directory to PATH (see Step 4/5 of your OS section) |
| **obabel** | The `obabel` binary is on PATH | Add `obabel` directory to PATH (see Step 5/6 of your OS section) |

### 2. Run a Test Calculation

1. In the app sidebar click **Run Manager**
2. Click **Upload Files**
3. Select any `.xyz` file (water dimer examples are in `../data/test/` relative to `knf-ui/`)
4. Leave all settings at their defaults
5. Click **Start Run**
6. The log panel shows live output from xTB and nciforge
7. When the run finishes (1–3 minutes for a small file), click **Results** in the sidebar
8. You should see a table with columns: `File`, `f1`–`f9`, `KUID`, `SNCI_Norm`, `SCDI_Norm`, `Quadrant`
9. Click **Explorer** to see the scatter plot

### 3. Check the API Directly (Advanced)

The Python backend exposes a health endpoint. You can call it from any browser or terminal:

```
http://127.0.0.1:8765/api/health
```

Expected response:
```json
{
  "status": "ok",
  "dependencies": {
    "torch": "2.x.x+cpu",
    "nciforge": "/path/to/.venv-nciforge/Scripts/nciforge.exe",
    "xtb": "/path/to/xtb.exe",
    "obabel": "/path/to/obabel.exe"
  },
  "missing": []
}
```

If `"missing"` contains any entries, that dependency is not found by the backend.

---

## 10. Troubleshooting

### `ELECTRON_RUN_AS_NODE` is set — Electron window does not open or crashes immediately

**Symptom:** Running `npm run dev` results in `TypeError: Cannot read properties of undefined (reading 'isPackaged')` or the Electron window never appears.

**Cause:** Some tools (notably VS Code's integrated terminal, certain CI environments, and some npm scripts) set the environment variable `ELECTRON_RUN_AS_NODE=1`. When this variable is set, Electron behaves as a plain Node.js process instead of a desktop app — the `app` object does not exist.

**Fix:**

1. **Use a standalone terminal** (PowerShell, Windows Terminal, macOS Terminal) instead of VS Code's integrated terminal.

2. **Or unset the variable before running:**

   ```powershell
   # PowerShell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   npm run dev
   ```

   ```bash
   # Linux / macOS
   unset ELECTRON_RUN_AS_NODE
   npm run dev
   ```

The `scripts/launch-electron.mjs` file in this project automatically removes `ELECTRON_RUN_AS_NODE` from the environment before spawning Electron. This handles the case where Node.js inherits the variable, but it cannot fix the case where the variable is set in the shell before `node` itself starts. Starting from a clean terminal is the safest approach.

---

### Port 8765 is already in use

**Symptom:** Backend fails to start with `Address already in use` or `OSError: [Errno 98]`.

**Cause:** A previous instance of the backend is still running, or another application is using port 8765.

**Fix:**

```powershell
# Windows — find the process using port 8765
netstat -ano | findstr ":8765"
# The last column is the PID. Kill it:
Stop-Process -Id <PID> -Force
```

```bash
# Linux / macOS
lsof -i :8765
# or
fuser 8765/tcp
# Kill it:
kill -9 <PID>
```

---

### Port 5173 is already in use

**Symptom:** `npm run dev` fails with `Error: listen EADDRINUSE: address already in use :::5173`.

**Cause:** Another Vite server or another app is using port 5173.

**Fix:** Kill the process using port 5173 the same way as above, replacing `8765` with `5173`.

---

### `npm install` fails / package installation errors

**Symptom:** `npm install` exits with errors, often mentioning `node_modules`, `ENOTEMPTY`, or build failures.

**Fixes:**

```bash
# Delete the old node_modules and try again
cd frontend
rm -rf node_modules package-lock.json    # Linux/macOS
# Windows: Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

If errors mention `node-gyp` or native compilation:
- **Windows:** Install Visual Studio Build Tools — run `npm install --global windows-build-tools` (as Administrator)
- **Linux:** `sudo apt-get install -y build-essential python3-dev`
- **macOS:** `xcode-select --install`

---

### Backend installer fails — Python not found

**Symptom:** `install-backend.bat` prints `Python 3 was not found`.

**Fixes:**

1. Confirm Python is installed: open a new terminal and run `python --version` or `py -3 --version`
2. If Python is installed but not found, add it to PATH manually (see Step 3 of your OS section)
3. Pass the Python executable path directly to the installer:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass `
     -File backend\NCIForge\scripts\install_nciforge.ps1 `
     -PythonExe "C:\Users\YourName\AppData\Local\Programs\Python\Python311\python.exe" `
     -Scope local -Torch cpu -External auto
   ```

---

### PyTorch installation fails or takes forever

**Symptom:** `pip install torch` runs for a long time and then fails with a network error.

**Cause:** The PyTorch package is ~800 MB. Slow connections or network interruptions cause failures.

**Fixes:**

1. **Retry** — the installer uses `check=False` so it won't stop the whole install. Run the pip command manually with retries:
   ```powershell
   backend\NCIForge\.venv-nciforge\Scripts\python.exe -m pip install `
     torch --index-url https://download.pytorch.org/whl/cpu --retries 5
   ```

2. **If you do not have a GPU and want to skip PyTorch** (calculations will be slower but will still work using CPU fallback):
   ```powershell
   powershell -File backend\NCIForge\scripts\install_nciforge.ps1 -Torch skip
   ```

---

### xTB or obabel not found by the app even though they are installed

**Symptom:** The dependency bar shows `xtb` or `obabel` as red, but running `xtb --version` in your terminal works.

**Cause:** The backend server process may have a different PATH than your interactive terminal. The Electron app spawns the Python server without inheriting all of your shell's environment.

**Fix — Add the tool directories to the system-level (not just user-level) PATH, or use the auto-detection:**

The backend (`server.py`) automatically searches these directories on Windows even without PATH:
- `C:\ProgramData\xtb\xtb-6.7.1\bin\` — for xTB
- `C:\Program Files\OpenBabel-3.1.1\` — for obabel

If your tools are installed elsewhere, add their directories to the Windows user PATH as shown in Steps 4 and 5 of the Windows section. Then **restart the Electron app** (not just a new terminal).

---

### Python version is wrong (3.12+)

**Symptom:** Backend installer completes but `nciforge --help` fails with `ImportError` for `rdkit` or `scipy`.

**Cause:** Python 3.12 removed some APIs that RDKit and other chemistry packages rely on.

**Fix:** Install Python 3.11 specifically and point the installer at it:

```powershell
# Windows — install Python 3.11 if you have 3.12
winget install --id Python.Python.3.11 -e

# Then re-run the backend installer pointing at Python 3.11
powershell -File backend\NCIForge\scripts\install_nciforge.ps1 `
  -PythonExe "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python311\python.exe" `
  -Scope local -Torch cpu
```

---

### Permission denied errors on Linux/macOS

**Symptom:** `install_nciforge.sh` fails with `Permission denied`.

**Fix:**
```bash
chmod +x backend/NCIForge/scripts/install_nciforge.sh
chmod +x run-frontend.sh
chmod +x install-frontend.sh
./backend/NCIForge/scripts/install_nciforge.sh
```

---

### Electron window opens but is completely blank

**Symptom:** The desktop window appears but shows only a white/grey blank screen.

**Cause:** Vite has not finished compiling yet, or it started after Electron tried to connect.

**Fix:** Wait 20–30 seconds. Vite compilation takes longer on the first run. If it stays blank after a minute, check the terminal for TypeScript errors. You should see something like `✓ built in X.Xs` in the terminal. If you see red error output instead, there is a TypeScript compilation problem — re-run `npm install` and try again.

---

### Calculations complete but no results appear in the Results tab

**Symptom:** The run finishes (you see "Run Completed" notification) but the Results table is empty.

**Cause:** This was a bug in `server.py` where the output directory path was resolved relative to the wrong working directory.

**This is fixed in the current version.** If you experience this on an older checkout, update to the latest code and restart the backend.

---

### Build failures (`tsc` TypeScript errors)

**Symptom:** `npm run dev` fails with TypeScript compilation errors after printing `error TS...`.

**Fixes:**

```bash
# 1. Ensure Node.js is up to date
node --version    # should be 18+

# 2. Delete build cache
cd frontend
rm -rf dist dist-electron

# 3. Re-install packages (in case of corrupt node_modules)
rm -rf node_modules
npm install

# 4. Try building again
npm run dev
```

---

## 11. Future Docker Support

> Docker support is not yet implemented. This section explains what it will look like and how it will simplify setup for new contributors.

### Why Docker?

Currently, setting up KNF Studio requires installing Python, Node.js, xTB, and Open Babel separately on your machine — a process that varies by operating system and can go wrong in many ways. Docker solves this by packaging the application and all its dependencies into a single, portable container. A user with Docker installed would need only:

```bash
docker compose up
```

No Python, no Node.js, no xTB, no Open Babel to install manually.

> **Note on Electron and Docker:** Electron is a desktop GUI application — it cannot run inside a headless Docker container without a virtual display. The Docker strategy for this project will therefore containerise only the **Python backend**. The Electron frontend will continue to run natively on the host machine. An alternative "web mode" (serving the React app from a browser instead of Electron) is also planned — that mode can be fully containerised.

---

### Planned Docker Architecture

```
docker-compose.yml
├── backend (container)
│   ├── Python 3.11
│   ├── nciforge + all Python deps
│   ├── xtb binary
│   ├── openbabel binary
│   └── Uvicorn on port 8765
│
└── frontend (native, NOT containerised for Electron mode)
    └── connects to http://127.0.0.1:8765
```

---

### Planned File Structure

```
knf-ui/
├── docker/
│   ├── backend/
│   │   └── Dockerfile            ← Backend container definition
│   └── frontend/
│       └── Dockerfile            ← Web-mode frontend (non-Electron)
├── docker-compose.yml            ← Local development (backend only)
├── docker-compose.prod.yml       ← Production configuration
└── .env.example                  ← Template for environment variables
```

---

### Planned `Dockerfile` for the Backend

```dockerfile
FROM python:3.11-slim

# Install system dependencies (xtb, openbabel)
RUN apt-get update && apt-get install -y \
    xtb \
    openbabel \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/NCIForge/setup.py backend/NCIForge/
COPY backend/NCIForge/knf_core/ backend/NCIForge/knf_core/
RUN pip install --no-cache-dir -e backend/NCIForge \
    && pip install torch --index-url https://download.pytorch.org/whl/cpu

COPY backend/NCIForge/server.py .

EXPOSE 8765

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
```

---

### Planned `docker-compose.yml` for Local Development

```yaml
version: "3.9"

services:
  backend:
    build:
      context: .
      dockerfile: docker/backend/Dockerfile
    ports:
      - "8765:8765"
    volumes:
      # Mount source for live reload during development
      - ./backend/NCIForge:/app/backend/NCIForge
    environment:
      - PYTHONUNBUFFERED=1
    restart: unless-stopped
```

---

### Environment Variable Management

A `.env.example` file will document all configurable values:

```dotenv
# Backend server
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8765

# Computation settings
NCIFORGE_TIMEOUT_SECONDS=600
NCIFORGE_DEFAULT_WORKERS=4

# GPU mode: "cpu" or "cuda"
NCIFORGE_NCI_DEVICE=cpu
```

Developers copy this to `.env` and customise it. Docker Compose loads it automatically.

---

### Development vs Production Configurations

| Feature | Development | Production |
|---------|------------|------------|
| Source mounting | Volume mount (live reload) | Copied into image |
| Backend reload | `--reload` flag on uvicorn | No reload |
| CORS | Open (`*`) | Restricted to known origins |
| Logging level | `DEBUG` | `INFO` |
| GPU | Optional | Optional |

---

### How Docker Will Simplify Onboarding

Once implemented, a new contributor will follow these three steps:

1. Install Docker Desktop (<https://www.docker.com/products/docker-desktop/>)
2. Clone the repository
3. Run `docker compose up`

The container image will include xTB, Open Babel, Python 3.11, and all Python packages pre-installed. This reduces a 30-minute setup process to under 5 minutes and eliminates all PATH and version compatibility issues.

---

## 12. Tech Stack Reference

| Component | Technology | Version | Role |
|-----------|-----------|---------|------|
| Desktop shell | Electron | 30.5.1 | Wraps the web app in a native window |
| UI framework | React | 18.3.1 | Builds the interactive interface |
| Frontend build tool | Vite | 5.4.19 | Compiles and hot-reloads the frontend |
| Language (frontend) | TypeScript | 5.8.3 | Type-safe JavaScript |
| Component library | shadcn/ui + Radix UI | — | Accessible, unstyled UI primitives |
| Styling | Tailwind CSS | 3.4.17 | Utility-first CSS framework |
| State management | TanStack Query | 5.x | Server state, caching, polling |
| Form handling | React Hook Form + Zod | 7.x + 3.x | Forms with schema validation |
| Charts | Recharts | 2.15.4 | SVG-based charting |
| 3D viewer | 3Dmol.js | 2.5.5 | WebGL molecular visualisation |
| Backend API | FastAPI | 0.136.3 | HTTP and WebSocket server |
| Backend runtime | Uvicorn | 0.49.0 | ASGI server running FastAPI |
| Language (backend) | Python | 3.11 (venv) | Computation and API logic |
| Array/matrix math | NumPy + SciPy | 2.2 + 1.15 | Numerical computing |
| Cheminformatics | RDKit | 2026.3.3 | Molecular representation and topology |
| ML / tensor ops | PyTorch | 2.x (CPU or CUDA) | NCI scalar field computation |
| Geometry optimiser | xTB | 6.7.1 | Quantum semi-empirical optimisation |
| Format converter | Open Babel | 3.1.1 | Chemical file format conversion |
