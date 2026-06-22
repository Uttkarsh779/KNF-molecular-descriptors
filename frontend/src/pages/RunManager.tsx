import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, FileText, ChevronDown, ChevronUp, Play, Save, FolderOpen, Loader2, Cpu, Settings, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MolecularFile, RunConfig, AppSettings } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  connectWs, sendWsMessage,
  onWsStatusChange, setWsUrl as setGlobalWsUrl, isWsConnected,
} from '@/lib/wsConnection';
import { subscribeWsMessages, clearWsBuffer } from '@/lib/wsStore';

const ACCEPTED_EXTENSIONS = ['.xyz', '.sdf', '.mol', '.pdb', '.mol2'];

const configSchema = z.object({
  charge: z.number().int(),
  spin: z.number().int().min(1),
  processingMode: z.enum(['auto', 'single', 'multi']),
  workers: z.number().int().positive().optional().nullable(),
  nciBackend: z.enum(['torch', 'multiwfn']),
  outputDirectory: z.string().min(1),
  gpuEnabled: z.boolean(),
  forceRecomputation: z.boolean(),
  cleanOutputs: z.boolean(),
  debugMode: z.boolean(),
  enableStopKey: z.boolean(),
  interactiveQuadrant: z.boolean(),
  gridSpacing: z.number().positive().optional().nullable(),
  gridPadding: z.number().positive().optional().nullable(),
  batchSize: z.number().int().positive().optional().nullable(),
  eigBatchSize: z.number().int().positive().optional().nullable(),
  rhoFloor: z.number().optional().nullable(),
  nciDevice: z.string().optional().nullable(),
});

type ConfigSchemaType = z.infer<typeof configSchema>;

const defaultConfig: ConfigSchemaType = {
  charge: 0, spin: 1, processingMode: 'auto',
  forceRecomputation: false, cleanOutputs: true, debugMode: false,
  outputDirectory: './output/', nciBackend: 'torch', gpuEnabled: false,
  enableStopKey: true, interactiveQuadrant: true,
};

const STORAGE_KEY = 'knf-run-config';

function loadInitialConfig(): ConfigSchemaType {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultConfig;
    return { ...defaultConfig, ...JSON.parse(saved) };
  } catch {
    return defaultConfig;
  }
}

// Helper badge styles for chemistry file formats
const extensionBadges: Record<string, string> = {
  '.xyz': 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  '.sdf': 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  '.mol': 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
  '.pdb': 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
  '.mol2': 'bg-pink-500/10 text-pink-400 border border-pink-500/20',
};

const RunManager = () => {
  const [files, setFiles] = useState<MolecularFile[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  const methods = useForm<ConfigSchemaType>({
    resolver: zodResolver(configSchema),
    defaultValues: loadInitialConfig(),
    mode: 'onChange'
  });

  const { watch, control, handleSubmit, setValue, formState: { errors, isValid } } = methods;
  const config = watch();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Hook up the websocket (simulated backend URL)
  const [uploading, setUploading] = useState(false);
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  const apiUrlRef = useRef('http://127.0.0.1:8765');
  const terminalBottomRef = useRef<HTMLDivElement>(null);

  // ── WebSocket (module-level singleton so it survives navigation) ──────────
  const [isConnected, setIsConnected] = useState(isWsConnected);

  useEffect(() => {
    // Sync WS URL from settings once on mount
    try {
      const saved = localStorage.getItem('knf-settings');
      if (saved) {
        const settings: AppSettings = JSON.parse(saved);
        const base = settings.apiBaseUrl.replace(/\/+$/, '');
        apiUrlRef.current = base;
        setGlobalWsUrl(base.replace(/^http/, 'ws') + '/ws/run');
      }
    } catch { /* ignore */ }

    // Track connection status for the indicator dot
    return onWsStatusChange(setIsConnected);
  }, []);

  const uploadFilesToBackend = useCallback(async (filesToUpload: File[]): Promise<boolean> => {
    setUploading(true);
    try {
      const formData = new FormData();
      filesToUpload.forEach(f => formData.append('files', f));
      const res = await fetch(`${apiUrlRef.current}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
      const result = await res.json();
      toast({ title: 'Files Uploaded', description: `${result.files.length} file(s) synchronized with backend.` });
      return true;
    } catch (err: any) {
      toast({ title: 'Upload Failed', description: err.message, variant: 'destructive' });
      return false;
    } finally {
      setUploading(false);
    }
  }, [toast]);

  const addFiles = useCallback((incoming: File[]) => {
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
    // Upload to backend
    const validFiles = incoming.filter((_, i) => newFiles[i].valid);
    if (validFiles.length > 0) {
      uploadFilesToBackend(validFiles);
    }
  }, [files, uploadFilesToBackend]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    addFiles(dropped);
  }, [addFiles]);

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  // ── Handle incoming WS messages from the singleton bus ──────────────────
  useEffect(() => {
    return subscribeWsMessages((lastMessage) => {
      if (lastMessage.type === 'completed' || lastMessage.status === 'completed') {
        setIsStarting(false);
        toast({ title: 'Run Completed', description: lastMessage.message || 'All files processed successfully.' });
      } else if (lastMessage.type === 'error' || lastMessage.status === 'error') {
        setIsStarting(false);
        toast({ title: 'Run Failed', description: lastMessage.message || lastMessage.error || 'Unknown error.', variant: 'destructive' });
      } else if (lastMessage.type === 'log') {
        setWsLogs(prev => [...prev, lastMessage.message].slice(-100));
      } else if (lastMessage.type === 'command') {
        setWsLogs(prev => [...prev, `> ${lastMessage.message}`].slice(-100));
      } else if (lastMessage.type === 'status') {
        toast({ title: 'Status Update', description: lastMessage.message });
      } else if (lastMessage.type === 'file_result') {
        const r = lastMessage.result;
        setWsLogs(prev => [...prev, `✓ ${r?.fileName} processed`].slice(-100));
      } else if (lastMessage.type === 'normalized_update') {
        toast({ title: 'Normalization Updated', description: lastMessage.message });
      } else if (lastMessage.type === 'results') {
        const fileList = (lastMessage.files as string[])?.join(', ') || '';
        setWsLogs(prev => [...prev, `Results: ${fileList}`].slice(-100));
      }
    });
  }, [toast]);

  // Scroll terminal to bottom
  useEffect(() => {
    if (terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [wsLogs]);

  // Real-time computation workflow phase tracker
  const computationPhase = useMemo(() => {
    if (!isStarting) return 'idle';
    const logString = wsLogs.join('\n').toLowerCase();
    if (logString.includes('unified') || logString.includes('results') || logString.includes('kuid')) {
      return 'kuid';
    }
    if (logString.includes('nci') || logString.includes('density') || logString.includes('grid')) {
      return 'nci';
    }
    if (logString.includes('xtb') || logString.includes('optimize') || logString.includes('geometry')) {
      return 'xtb';
    }
    return 'init';
  }, [wsLogs, isStarting]);

  const handleStart = async (data: ConfigSchemaType) => {
    const validFiles = files.filter(f => f.valid);
    if (validFiles.length === 0) return;

    setIsStarting(true);
    setWsLogs([]);
    clearWsBuffer(); // reset so Analysis only shows this run's messages
    toast({ title: 'Run Initialized', description: `Executing computations on ${validFiles.length} molecular systems...` });

    // Connect via the module-level singleton — survives navigate() unmount
    connectWs();
    await new Promise(r => setTimeout(r, 1000));

    sendWsMessage({
      action: 'start_run',
      config: data,
      files: validFiles.map(f => f.name),
    });

    // Navigate to Analysis window so user can watch live results stream in
    navigate('/analysis');
  };

  const commandPreview = `knf-run --charge ${config.charge || 0} --spin ${config.spin || 1} --mode ${config.processingMode || 'auto'} --backend ${config.nciBackend || 'torch'}${config.gpuEnabled ? ' --gpu' : ''}${config.forceRecomputation ? ' --force' : ''}${config.workers ? ` --workers ${config.workers}` : ''} --output "${config.outputDirectory || './output/'}"`;

  const validCount = files.filter(f => f.valid).length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl animate-fade-in-up">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary font-mono tracking-widest text-[9px] uppercase">
          <Cpu className="w-3.5 h-3.5" />
          Computation Dashboard
        </div>
        <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
          Run <span className="text-gradient">Manager</span>
        </h1>
        <p className="text-xs text-muted-foreground">Configure and execute geometry optimizations and KNF calculations</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: File Manager */}
        <div className="space-y-4 lg:col-span-1">
          <div className="flex items-center justify-between border-b border-glass pb-2">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Molecular Inputs</h2>
            <span className="text-[10px] font-mono text-muted-foreground">{validCount} Ready</span>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => document.getElementById('file-input')?.click()}
            className="border border-dashed border-zinc-800 bg-zinc-900/10 hover:bg-zinc-900/25 rounded-lg p-6 text-center cursor-pointer hover:border-zinc-700 transition-all shadow-sm"
            role="button"
            aria-label="Drop molecular files here or click to browse"
          >
            <Upload className="w-8 h-8 text-muted-foreground/60 mx-auto mb-3" />
            <p className="text-xs text-foreground/80 font-semibold">Drag molecular structures here</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">or click to browse local storage</p>
            <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
              {ACCEPTED_EXTENSIONS.map(ext => (
                <span key={ext} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-glass/30 text-muted-foreground">
                  {ext}
                </span>
              ))}
            </div>
            <input id="file-input" type="file" multiple accept={ACCEPTED_EXTENSIONS.join(',')} className="hidden" onChange={e => e.target.files && addFiles(Array.from(e.target.files))} />
          </div>

          {/* Uploaded File List */}
          {files.length > 0 && (
            <div className="rounded-lg border border-glass bg-card/45 divide-y divide-glass/35 max-h-[340px] overflow-y-auto">
              {files.map(f => (
                <div key={f.id} className={cn('flex items-center gap-3 px-4 py-2 text-xs transition-opacity', !f.valid && 'opacity-60')}>
                  <FileText className={cn('w-3.5 h-3.5 shrink-0', f.valid ? 'text-primary' : 'text-destructive')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-foreground font-medium truncate leading-tight">{f.name}</p>
                      {f.valid && (
                        <span className={cn('text-[9px] font-mono font-semibold px-1 rounded shrink-0', extensionBadges[f.extension] || 'bg-white/5 text-muted-foreground')}>
                          {f.extension.slice(1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    {f.error ? (
                      <p className="text-[9px] text-destructive mt-0.5">{f.error}</p>
                    ) : (
                      <p className="text-[9px] text-muted-foreground font-mono mt-0.5">{(f.size / 1024).toFixed(1)} KB</p>
                    )}
                  </div>
                  <button onClick={() => removeFile(f.id)} className="text-muted-foreground hover:text-destructive transition-colors" aria-label={`Remove ${f.name}`}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Center Column: Config Options Form */}
        <div className="space-y-4 lg:col-span-1">
          <div className="flex items-center justify-between border-b border-glass pb-2">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Engine Parameters</h2>
            <Settings className="w-4 h-4 text-muted-foreground" />
          </div>

          <FormProvider {...methods}>
            <form onSubmit={handleSubmit(handleStart)} className="space-y-4">
              <div className="rounded-lg border border-zinc-800 bg-card/45 p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FieldGroup label="Molecular Charge" error={errors.charge?.message}>
                    <Controller name="charge" control={control} render={({field}) => <input type="number" {...field} value={field.value ?? ''} onChange={e => { const val = e.target.value; field.onChange(val === '' ? undefined : parseInt(val)); }} className="w-full rounded-lg bg-input/40 border border-glass px-3 py-1.5 text-xs text-foreground font-mono glass-input outline-none" />} />
                  </FieldGroup>
                  <FieldGroup label="Spin Multiplicity" error={errors.spin?.message}>
                    <Controller name="spin" control={control} render={({field}) => <input type="number" {...field} value={field.value ?? ''} onChange={e => { const val = e.target.value; field.onChange(val === '' ? undefined : parseInt(val)); }} className="w-full rounded-lg bg-input/40 border border-glass px-3 py-1.5 text-xs text-foreground font-mono glass-input outline-none" />} />
                  </FieldGroup>
                </div>
                <FieldGroup label="Processing Mode">
                  <Controller name="processingMode" control={control} render={({field}) => <select {...field} className="w-full rounded-lg bg-input/40 border border-glass px-3 py-1.5 text-xs text-foreground glass-input outline-none"><option value="auto">Auto-Detect</option><option value="single">Single Process</option><option value="multi">Parallel Batch</option></select>} />
                </FieldGroup>
                <FieldGroup label="Execution Workers (optional)" error={errors.workers?.message}>
                   <Controller name="workers" control={control} render={({field}) => <input type="number" value={field.value || ''} onChange={e => field.onChange(e.target.value ? parseInt(e.target.value) : null)} placeholder="System Default" className="w-full rounded-lg bg-input/40 border border-glass px-3 py-1.5 text-xs text-foreground font-mono glass-input outline-none" />} />
                </FieldGroup>
                <FieldGroup label="NCI Density Estimator Backend">
                  <Controller name="nciBackend" control={control} render={({field}) => <select {...field} className="w-full rounded-lg bg-input/40 border border-glass px-3 py-1.5 text-xs text-foreground glass-input outline-none"><option value="torch">PyTorch (GPU/CPU Acceleration)</option><option value="multiwfn">Multiwfn Integration</option></select>} />
                </FieldGroup>
                <FieldGroup label="Output Directory Path" error={errors.outputDirectory?.message}>
                    <div className="flex gap-2">
                      <Controller
                        name="outputDirectory"
                        control={control}
                        render={({field}) => (
                          <input
                            type="text"
                            {...field}
                            className="w-full rounded-lg bg-input/40 border border-glass px-3 py-1.5 text-xs text-foreground font-mono glass-input outline-none"
                          />
                        )}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.electronAPI?.selectOutputDirectory) {
                            toast({
                              title: 'Desktop App Only',
                              description: 'Use the desktop package (Electron wrapper) to browse directories.',
                              variant: 'destructive',
                            });
                            return;
                          }
                          const chosen = await window.electronAPI.selectOutputDirectory();
                          if (chosen) setValue('outputDirectory', chosen, { shouldDirty: true, shouldValidate: true });
                        }}
                        className="shrink-0 px-3 py-1.5 rounded-lg border border-glass bg-white/5 hover:bg-white/10 text-xs text-foreground font-medium transition-colors"
                      >
                        Browse
                      </button>
                    </div>
                </FieldGroup>

                {/* System Toggles */}
                <div className="space-y-2 border-t border-glass/40 pt-3">
                  {(['gpuEnabled', 'forceRecomputation', 'cleanOutputs', 'debugMode', 'enableStopKey', 'interactiveQuadrant'] as const).map((key) => (
                    <label key={key} className="flex items-center justify-between text-xs cursor-pointer py-0.5">
                      <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <Controller name={key} control={control} render={({field}) => <input type="checkbox" checked={field.value as boolean} onChange={field.onChange} className="rounded border-glass bg-background/50 focus:ring-primary text-primary" />} />
                    </label>
                  ))}
                </div>

                {/* Advanced parameters dropdown */}
                <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground hover:text-foreground transition-colors w-full border-t border-glass/40 pt-2.5">
                  {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  ADVANCED DENSITY GRIDS
                </button>
                {showAdvanced && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    {(['gridSpacing', 'gridPadding', 'batchSize', 'eigBatchSize', 'rhoFloor'] as const).map((key) => (
                      <FieldGroup key={key} label={key.replace(/([A-Z])/g, ' $1').trim()} error={errors[key]?.message as string}>
                         <Controller name={key} control={control} render={({field}) => <input type="number" step="any" value={field.value || ''} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : null)} placeholder="Auto" className="w-full rounded-lg bg-input/40 border border-glass px-2.5 py-1.5 text-xs text-foreground font-mono glass-input outline-none" />} />
                      </FieldGroup>
                    ))}
                    <FieldGroup label="Hardware Target">
                      <Controller name="nciDevice" control={control} render={({field}) => <input type="text" value={field.value || ''} onChange={e => field.onChange(e.target.value || null)} placeholder="Auto-Detect" className="w-full rounded-lg bg-input/40 border border-glass px-2.5 py-1.5 text-xs text-foreground font-mono glass-input outline-none" />} />
                    </FieldGroup>
                  </div>
                )}
              </div>
            </form>
          </FormProvider>

          {/* Bash Code Preview */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <p className="text-[9px] font-mono text-muted-foreground mb-1.5 tracking-wider uppercase">CLI Command Preview</p>
            <code className="text-xs text-primary/90 font-mono break-all leading-relaxed">{commandPreview}</code>
          </div>
        </div>

        {/* Right Column: Execution Console */}
        <div className="space-y-4 lg:col-span-1">
          <div className="flex items-center justify-between border-b border-glass pb-2">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Execution Shell</h2>
            <div className="flex items-center gap-1.5">
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full", isConnected ? "bg-emerald-500 animate-pulse" : "bg-zinc-600")} />
              <span className="text-[10px] font-mono text-muted-foreground">{isConnected ? 'Connected' : 'Offline'}</span>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleSubmit(handleStart)}
              disabled={validCount === 0 || isStarting || !isValid}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {isStarting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating Descriptors...
                </span>
              ) : (
                <><Play className="w-3.5 h-3.5" /> Start Descriptor Run ({validCount} files)</>
              )}
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/50 text-xs font-semibold transition-colors">
                <Save className="w-3.5 h-3.5 text-muted-foreground" /> Save Config
              </button>
              <button className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/50 text-xs font-semibold transition-colors">
                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" /> Load Preset
              </button>
            </div>
          </div>

          {/* Live Progress Timeline (Visual workflow states) */}
          {isStarting && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/10 p-4 space-y-3">
              <h3 className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Calculation Phase</h3>
              <div className="space-y-2.5 font-mono text-xs">
                <TimelineStep 
                  label="1. Molecular File Input Processing" 
                  status={computationPhase !== 'idle' ? 'success' : 'pending'} 
                />
                <TimelineStep 
                  label="2. xTB Structure Geometry Optimization" 
                  status={
                    computationPhase === 'xtb' ? 'active' : 
                    ['nci', 'kuid'].includes(computationPhase) ? 'success' : 'pending'
                  } 
                />
                <TimelineStep 
                  label="3. NCI Field Grid Mapping (PyTorch)" 
                  status={
                    computationPhase === 'nci' ? 'active' : 
                    computationPhase === 'kuid' ? 'success' : 'pending'
                  } 
                />
                <TimelineStep 
                  label="4. Descriptor Calculation & KUID Fingerprint" 
                  status={computationPhase === 'kuid' ? 'active' : 'pending'} 
                />
              </div>
            </div>
          )}

          {/* Command Terminal Console wrapper */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 flex flex-col justify-between h-[280px]">
            <div className="flex items-center justify-between border-b border-glass/40 pb-2 mb-2">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Terminal Output</span>
              {isStarting && (
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500 animate-pulse"></span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto text-[10px] font-mono text-muted-foreground space-y-1.5 pr-1 max-h-[220px]">
              {wsLogs.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground/50">
                  Console idle. Run a computation to capture stdout streams.
                </div>
              ) : (
                wsLogs.map((log, i) => {
                  let logClass = "terminal-row";
                  if (log.startsWith('> ')) {
                    logClass = "terminal-row command text-primary/90";
                  } else if (log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')) {
                    logClass = "terminal-row error text-destructive";
                  } else if (log.toLowerCase().includes('completed') || log.toLowerCase().includes('success') || log.toLowerCase().includes('results:')) {
                    logClass = "terminal-row success text-emerald-500";
                  }
                  return (
                    <div key={i} className={cn(logClass, "truncate")} title={log}>
                      {log}
                    </div>
                  );
                })
              )}
              <div ref={terminalBottomRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function TimelineStep({ label, status }: { label: string; status: 'pending' | 'active' | 'success' }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className={cn(
        "font-medium truncate",
        status === 'active' ? 'text-primary' : 
        status === 'success' ? 'text-white/80' : 'text-muted-foreground/60'
      )}>
        {label}
      </span>
      {status === 'active' ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" /> RUNNING
        </span>
      ) : status === 'success' ? (
        <span className="text-[10px] font-semibold text-emerald-500">✓ COMPLETED</span>
      ) : (
        <span className="text-[10px] font-semibold text-muted-foreground/50">PENDING</span>
      )}
    </div>
  );
}

function FieldGroup({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[9px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">{label}</label>
      {children}
      {error && <span className="text-[9px] text-destructive mt-1 block font-mono">{error}</span>}
    </div>
  );
}

export default RunManager;
