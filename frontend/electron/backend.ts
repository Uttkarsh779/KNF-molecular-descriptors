import { ChildProcess, spawn, spawnSync } from 'child_process';
import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const _require = createRequire(import.meta.url);
const { app } = _require('electron') as typeof import('electron');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_PORT = 8765;
const isDev = !app.isPackaged;

// ---------------------------------------------------------------------------
// Log path — written by Electron, so it always exists even if Python crashes
// before writing its own log.
// ---------------------------------------------------------------------------

export function getBackendLogPath(): string {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'KNFStudio')
    : path.join(os.homedir(), 'AppData', 'Local', 'KNFStudio');
  try { fs.mkdirSync(base, { recursive: true }); } catch { /* ignore */ }
  return path.join(base, 'backend-startup.log');
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getBackendDir(): string {
  if (isDev) {
    return path.resolve(__dirname, '..', '..', 'backend', 'NCIForge');
  }
  return path.join(process.resourcesPath, 'backend');
}

function getToolsDir(): string {
  if (isDev) return '';
  return path.join(process.resourcesPath, 'backend', 'tools');
}

function buildEnvPath(): string {
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const original = process.env[pathKey] || '';
  const toolsDir = getToolsDir();

  const extras: string[] = [];

  if (toolsDir) {
    const xtbBin = path.join(toolsDir, 'xtb', 'bin');
    if (fs.existsSync(xtbBin)) extras.push(xtbBin);

    const obaDir = path.join(toolsDir, 'obabel');
    if (fs.existsSync(obaDir)) extras.push(obaDir);
  }

  return [...extras, original].join(process.platform === 'win32' ? ';' : ':');
}

// ---------------------------------------------------------------------------
// Production: use frozen server.exe (no Python needed)
// ---------------------------------------------------------------------------

function getProductionBackendCommand(): { command: string; args: string[] } | null {
  const serverExe = path.join(getBackendDir(), 'server', 'server.exe');
  if (fs.existsSync(serverExe)) {
    return { command: serverExe, args: [String(BACKEND_PORT)] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Development: use the Python venv
// ---------------------------------------------------------------------------

function getDevPythonCommand(): { command: string; args: string[] } {
  const backendDir = getBackendDir();
  const venvPython = process.platform === 'win32'
    ? path.join(backendDir, '.venv-nciforge', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv-nciforge', 'bin', 'python');

  const candidates: Array<{ command: string; args: string[] }> = [
    ...(fs.existsSync(venvPython) ? [{ command: venvPython, args: [] as string[] }] : []),
    { command: 'py',      args: ['-3'] },
    { command: 'python',  args: [] },
    { command: 'python3', args: [] },
  ];

  for (const c of candidates) {
    try {
      spawnSync(c.command, [...c.args, '--version'], { stdio: 'ignore' });
      return c;
    } catch { /* try next */ }
  }
  return { command: 'py', args: ['-3'] };
}

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------

let backendProcess: ChildProcess | null = null;

export async function startBackend(): Promise<void> {
  const newPath = buildEnvPath();
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
  };
  env[pathKey] = newPath;

  let command: string;
  let args: string[];

  if (!isDev) {
    const prod = getProductionBackendCommand();
    if (!prod) {
      throw new Error(
        `Frozen backend not found.\n` +
        `Expected: ${path.join(getBackendDir(), 'server', 'server.exe')}\n\n` +
        `This is a packaging error — please report it.`
      );
    }
    command = prod.command;
    args    = prod.args;
    console.log('[backend] production mode — using frozen server.exe at:', command);
  } else {
    const python = getDevPythonCommand();
    command = python.command;
    args    = [...python.args, '-m', 'uvicorn', 'server:app',
               '--host', '127.0.0.1', '--port', String(BACKEND_PORT)];
    console.log('[backend] dev mode — using Python venv');
  }

  // ── Open log file (Electron captures ALL output, even if Python crashes) ──
  const logPath = getBackendLogPath();
  let logStream: fs.WriteStream | null = null;
  try {
    logStream = fs.createWriteStream(logPath, { flags: 'w', encoding: 'utf8' });
    logStream.write(`=== KNF Studio Backend Startup Log ===\n`);
    logStream.write(`Date    : ${new Date().toISOString()}\n`);
    logStream.write(`Command : ${command}\n`);
    logStream.write(`Args    : ${args.join(' ')}\n`);
    logStream.write(`CWD     : ${path.dirname(command)}\n`);
    logStream.write(`isDev   : ${isDev}\n`);
    logStream.write(`========================================\n\n`);
  } catch (e) {
    console.warn('[backend] could not open log file:', e);
  }

  const write = (line: string) => {
    try { logStream?.write(line); } catch { /* ignore */ }
  };

  backendProcess = spawn(command, args, {
    cwd:         isDev ? getBackendDir() : path.dirname(command),
    env,
    stdio:       ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess.on('error', (err) => {
    const msg = `[ERROR] Failed to launch process: ${err.message}\n`;
    console.error('[backend]', msg);
    write(msg);
  });

  backendProcess.stdout?.on('data', (d: Buffer) => {
    const text = d.toString();
    text.split('\n').filter(l => l.trim()).forEach(l => console.log(`[backend] ${l}`));
    write(text);
  });

  backendProcess.stderr?.on('data', (d: Buffer) => {
    const text = d.toString();
    text.split('\n').filter(l => l.trim()).forEach(l => console.error(`[backend] ${l}`));
    write(`[STDERR] ${text}`);
  });

  backendProcess.on('exit', (code, signal) => {
    const msg = `\n[EXIT] Process exited — code=${code} signal=${signal}\n`;
    console.log('[backend] exited', { code, signal });
    write(msg);
    try { logStream?.end(); } catch { /* ignore */ }
    backendProcess = null;
  });

  await waitForBackend(logPath);
}

// ---------------------------------------------------------------------------
// Wait for the HTTP server to become ready
// ---------------------------------------------------------------------------

async function waitForBackend(logPath: string): Promise<void> {
  // 90 retries × 1s = 90 seconds max (torch loading can take 30–60s on first run)
  const maxRetries = 90;

  for (let i = 0; i < maxRetries; i++) {
    // If the process already died, fail immediately instead of waiting 90s
    if (backendProcess === null) {
      throw new Error(
        `Backend process exited unexpectedly before serving any requests.\n\n` +
        `Check the log file for the exact error:\n${logPath}`
      );
    }

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(id);
      if (res.ok) {
        console.log('[backend] ready ✓');
        return;
      }
    } catch { /* still starting */ }

    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error(
    `Backend did not respond after ${maxRetries}s.\n\n` +
    `Check the log file for the exact error:\n${logPath}`
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function stopBackend(): void {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill('SIGKILL');
      }
    }, 5000);
  }
}

export function getBackendUrl(): string {
  return `http://127.0.0.1:${BACKEND_PORT}`;
}
