import { useState, useCallback } from 'react';
import { Upload, X, FileText, ChevronDown, ChevronUp, Play, Save, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MolecularFile, RunConfig } from '@/types';
import { useToast } from '@/hooks/use-toast';

const ACCEPTED_EXTENSIONS = ['.xyz', '.sdf', '.mol', '.pdb', '.mol2'];

const defaultConfig: RunConfig = {
  charge: 0, spin: 1, processingMode: 'auto',
  forceRecomputation: false, cleanOutputs: true, debugMode: false,
  outputDirectory: './output/', nciBackend: 'torch', gpuEnabled: false,
  enableStopKey: true, interactiveQuadrant: true,
};

const RunManager = () => {
  const [files, setFiles] = useState<MolecularFile[]>([]);
  const [config, setConfig] = useState<RunConfig>(defaultConfig);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const { toast } = useToast();

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    addFiles(dropped);
  }, [files]);

  const addFiles = (incoming: File[]) => {
    const newFiles: MolecularFile[] = incoming.map((f, i) => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      const valid = ACCEPTED_EXTENSIONS.includes(ext);
      const duplicate = files.some(ef => ef.name === f.name);
      return {
        id: `file-${Date.now()}-${i}`,
        name: f.name,
        extension: ext,
        size: f.size,
        valid: valid && !duplicate,
        error: !valid ? `Unsupported format: ${ext}` : duplicate ? 'Duplicate file' : undefined,
      };
    });
    setFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const handleStart = () => {
    if (files.filter(f => f.valid).length === 0) return;
    setIsStarting(true);
    setTimeout(() => {
      setIsStarting(false);
      toast({ title: 'Run Started', description: `Processing ${files.filter(f => f.valid).length} files...` });
    }, 1500);
  };

  const commandPreview = `knf-run --charge ${config.charge} --spin ${config.spin} --mode ${config.processingMode} --backend ${config.nciBackend}${config.gpuEnabled ? ' --gpu' : ''}${config.forceRecomputation ? ' --force' : ''}${config.workers ? ` --workers ${config.workers}` : ''} --output "${config.outputDirectory}"`;

  const validCount = files.filter(f => f.valid).length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-display font-bold text-foreground">Run Manager</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure and launch KNF descriptor computations</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* File Upload */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Molecular Files</h2>
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => document.getElementById('file-input')?.click()}
            className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/40 transition-colors"
            role="button"
            aria-label="Drop molecular files here or click to browse"
          >
            <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Drop files here or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">{ACCEPTED_EXTENSIONS.join(', ')}</p>
            <input id="file-input" type="file" multiple accept={ACCEPTED_EXTENSIONS.join(',')} className="hidden" onChange={e => e.target.files && addFiles(Array.from(e.target.files))} />
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="rounded-xl border border-border bg-card divide-y divide-border max-h-80 overflow-y-auto">
              {files.map(f => (
                <div key={f.id} className={cn('flex items-center gap-3 px-4 py-2.5 text-sm', !f.valid && 'opacity-60')}>
                  <FileText className={cn('w-4 h-4 shrink-0', f.valid ? 'text-primary' : 'text-destructive')} />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate">{f.name}</p>
                    {f.error ? (
                      <p className="text-xs text-destructive">{f.error}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</p>
                    )}
                  </div>
                  <button onClick={() => removeFile(f.id)} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${f.name}`}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Configuration */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Configuration</h2>
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FieldGroup label="Charge">
                <input type="number" value={config.charge} onChange={e => setConfig(c => ({ ...c, charge: +e.target.value }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />
              </FieldGroup>
              <FieldGroup label="Spin">
                <input type="number" value={config.spin} onChange={e => setConfig(c => ({ ...c, spin: +e.target.value }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />
              </FieldGroup>
            </div>
            <FieldGroup label="Processing Mode">
              <select value={config.processingMode} onChange={e => setConfig(c => ({ ...c, processingMode: e.target.value as RunConfig['processingMode'] }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none">
                <option value="auto">Auto</option>
                <option value="single">Single</option>
                <option value="multi">Multi</option>
              </select>
            </FieldGroup>
            <FieldGroup label="Workers (optional)">
              <input type="number" value={config.workers ?? ''} onChange={e => setConfig(c => ({ ...c, workers: e.target.value ? +e.target.value : undefined }))} placeholder="Auto" className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />
            </FieldGroup>
            <FieldGroup label="NCI Backend">
              <select value={config.nciBackend} onChange={e => setConfig(c => ({ ...c, nciBackend: e.target.value as 'torch' | 'multiwfn' }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none">
                <option value="torch">Torch</option>
                <option value="multiwfn">Multiwfn</option>
              </select>
            </FieldGroup>
            <FieldGroup label="Output Directory">
              <input type="text" value={config.outputDirectory} onChange={e => setConfig(c => ({ ...c, outputDirectory: e.target.value }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />
            </FieldGroup>
            {/* Toggles */}
            <div className="space-y-2.5">
              {([
                ['gpuEnabled', 'GPU Acceleration'],
                ['forceRecomputation', 'Force Recomputation'],
                ['cleanOutputs', 'Clean Outputs'],
                ['debugMode', 'Debug Mode'],
                ['enableStopKey', 'Enable Stop Key'],
                ['interactiveQuadrant', 'Interactive Quadrant'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-muted-foreground">{label}</span>
                  <input type="checkbox" checked={config[key] as boolean} onChange={e => setConfig(c => ({ ...c, [key]: e.target.checked }))} className="rounded" />
                </label>
              ))}
            </div>

            {/* Advanced */}
            <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Advanced NCI Settings
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                {[
                  ['gridSpacing', 'Grid Spacing'],
                  ['gridPadding', 'Grid Padding'],
                  ['batchSize', 'Batch Size'],
                  ['eigBatchSize', 'Eig Batch Size'],
                  ['rhoFloor', 'Rho Floor'],
                ].map(([key, label]) => (
                  <FieldGroup key={key} label={label}>
                    <input type="number" step="any" value={(config as any)[key] ?? ''} onChange={e => setConfig(c => ({ ...c, [key]: e.target.value ? +e.target.value : undefined }))} placeholder="Default" className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />
                  </FieldGroup>
                ))}
                <FieldGroup label="NCI Device">
                  <input type="text" value={config.nciDevice ?? ''} onChange={e => setConfig(c => ({ ...c, nciDevice: e.target.value || undefined }))} placeholder="Auto" className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />
                </FieldGroup>
              </div>
            )}
          </div>

          {/* Command Preview */}
          <div className="rounded-xl border border-border bg-muted p-4">
            <p className="text-xs text-muted-foreground mb-1.5">Command Preview</p>
            <code className="text-xs text-primary font-mono break-all leading-relaxed">{commandPreview}</code>
          </div>
        </div>

        {/* Actions & Queue */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Actions</h2>
          <div className="space-y-3">
            <button
              onClick={handleStart}
              disabled={validCount === 0 || isStarting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {isStarting ? (
                <span className="animate-pulse-glow">Starting...</span>
              ) : (
                <><Play className="w-4 h-4" /> Start Run ({validCount} files)</>
              )}
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors">
                <Save className="w-4 h-4" /> Save Preset
              </button>
              <button className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors">
                <FolderOpen className="w-4 h-4" /> Load Preset
              </button>
            </div>
          </div>

          {/* Queue Preview */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Run Queue</h3>
            {validCount === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No files queued. Upload molecular files to get started.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Files ready</span>
                  <span className="font-mono text-foreground">{validCount}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Invalid/skipped</span>
                  <span className="font-mono text-foreground">{files.length - validCount}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Backend</span>
                  <span className="font-mono text-foreground">{config.nciBackend}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Mode</span>
                  <span className="font-mono text-foreground">{config.processingMode}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export default RunManager;
