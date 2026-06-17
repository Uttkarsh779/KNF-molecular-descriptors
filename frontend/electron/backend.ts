import { ChildProcess, spawn, execSync } from 'child_process';
import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const _require = createRequire(import.meta.url);
const { app } = _require('electron') as typeof import('electron');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_PORT = 8765;
const isDev = !app.isPackaged;

function getBackendDir(): string {
  if (isDev) {
    return path.resolve(__dirname, '..', '..', 'backend', 'NCIForge');
  }
  return path.join(process.resourcesPath, 'backend');
}

function getPythonCommand(): { command: string; args: string[] } {
  const backendDir = getBackendDir();
  const venvPython = process.platform === 'win32'
    ? path.join(backendDir, '.venv-nciforge', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv-nciforge', 'bin', 'python');
  const candidates: Array<{ command: string; args: string[]; probe: string }> = [
    ...(fs.existsSync(venvPython) ? [{ command: venvPython, args: [] as string[], probe: `"${venvPython}"` }] : []),
    { command: 'py', args: ['-3'], probe: 'py -3' },
    { command: 'python', args: [], probe: 'python' },
    { command: 'python3', args: [], probe: 'python3' },
    { command: path.join('C:\\ProgramData\\xtb\\xtb-6.7.1\\bin', 'python'), args: [], probe: 'bundled python' },
  ];
  for (const c of candidates) {
    try {
      execSync(`${c.probe} --version`, { stdio: 'ignore' });
      return { command: c.command, args: c.args };
    } catch { }
  }
  return { command: 'py', args: ['-3'] };
}

let backendProcess: ChildProcess | null = null;

export async function startBackend(): Promise<void> {
  const backendDir = getBackendDir();
  const python = getPythonCommand();

  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const originalPath = process.env[pathKey] || '';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
  };
  env[pathKey] = [
    'C:\\ProgramData\\xtb\\xtb-6.7.1\\bin',
    path.join(app.getPath('exe'), '..', 'resources', 'backend', 'tools', 'xtb', 'bin'),
    'C:\\Users\\Administrator\\AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0\\LocalCache\\local-packages\\Python311\\Scripts',
    originalPath,
  ].join(';');

  backendProcess = spawn(python.command, [...python.args, '-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)], {
    cwd: backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess.on('error', (err) => {
    console.error('[backend] failed to start process:', err);
  });

  backendProcess.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.log(`[backend] ${line}`);
  });

  backendProcess.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.error(`[backend] ${line}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
  });

  await waitForBackend();
}

async function waitForBackend(): Promise<void> {
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        console.log('[backend] ready');
        return;
      }
    } catch { }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Backend failed to start');
}

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
