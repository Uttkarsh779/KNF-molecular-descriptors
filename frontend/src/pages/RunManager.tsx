import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, X, FileText, ChevronDown, ChevronUp, Play, Save, FolderOpen, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MolecularFile, RunConfig, AppSettings } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useWebSocket } from '@/hooks/useWebSocket';

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

const RunManager = () => {
  const [files, setFiles] = useState<MolecularFile[]>([]);
  const { toast } = useToast();

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
  const apiUrlRef = useRef('http://localhost:8765');

  const [wsUrl, setWsUrl] = useState(() => {
    try {
      const saved = localStorage.getItem('knf-settings');
      if (saved) {
        const settings: AppSettings = JSON.parse(saved);
        const base = settings.apiBaseUrl.replace(/\/+$/, '');
        apiUrlRef.current = base;
        return base.replace(/^http/, 'ws') + '/ws/run';
      }
    } catch { /* ignore */ }
    return 'ws://127.0.0.1:8765/ws/run';
  });

  const { isConnected, messages, connect, disconnect, sendMessage } = useWebSocket(wsUrl);

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
      toast({ title: 'Files Uploaded', description: `${result.files.length} file(s) sent to backend.` });
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

  // Handle incoming websocket messages
  useEffect(() => {
    if (messages.length > 0) {
       const lastMessage = messages[messages.length - 1];
       if (lastMessage.type === 'completed' || lastMessage.status === 'completed') {
           setIsStarting(false);
           toast({ title: 'Run Completed', description: lastMessage.message || 'All files processed successfully.' });
           disconnect();
       } else if (lastMessage.type === 'error' || lastMessage.status === 'error') {
           setIsStarting(false);
           toast({ title: 'Run Failed', description: lastMessage.message || lastMessage.error || 'Unknown error.', variant: 'destructive' });
           disconnect();
       } else if (lastMessage.type === 'log') {
           setWsLogs(prev => [...prev, lastMessage.message].slice(-50));
       } else if (lastMessage.type === 'command') {
           setWsLogs(prev => [...prev, `> ${lastMessage.message}`].slice(-50));
       } else if (lastMessage.type === 'status') {
           toast({ title: 'Status', description: lastMessage.message });
       } else if (lastMessage.type === 'results') {
           const fileList = lastMessage.files?.join(', ') || '';
           setWsLogs(prev => [...prev, `Results: ${fileList}`].slice(-50));
       }
    }
  }, [messages, disconnect, toast]);

  const handleStart = async (data: ConfigSchemaType) => {
    const validFiles = files.filter(f => f.valid);
    if (validFiles.length === 0) return;

    setIsStarting(true);
    setWsLogs([]);
    toast({ title: 'Run Started', description: `Processing ${validFiles.length} file(s)...` });

    connect();
    await new Promise(r => setTimeout(r, 1000));

    sendMessage({
      action: 'start_run',
      config: data,
      files: validFiles.map(f => f.name),
    });
  };

  const commandPreview = `knf-run --charge ${config.charge || 0} --spin ${config.spin || 1} --mode ${config.processingMode || 'auto'} --backend ${config.nciBackend || 'torch'}${config.gpuEnabled ? ' --gpu' : ''}${config.forceRecomputation ? ' --force' : ''}${config.workers ? ` --workers ${config.workers}` : ''} --output "${config.outputDirectory || './output/'}"`;

  const validCount = files.filter(f => f.valid).length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      <header className="animate-fade-in-up">
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
        <FormProvider {...methods}>
        <form onSubmit={handleSubmit(handleStart)} className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Configuration</h2>
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FieldGroup label="Charge" error={errors.charge?.message}>
                <Controller name="charge" control={control} render={({field}) => <input type="number" {...field} value={field.value ?? ''} onChange={e => { const val = e.target.value; field.onChange(val === '' ? undefined : parseInt(val)); }} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />} />
              </FieldGroup>
              <FieldGroup label="Spin" error={errors.spin?.message}>
                <Controller name="spin" control={control} render={({field}) => <input type="number" {...field} value={field.value ?? ''} onChange={e => { const val = e.target.value; field.onChange(val === '' ? undefined : parseInt(val)); }} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />} />
              </FieldGroup>
            </div>
            <FieldGroup label="Processing Mode">
              <Controller name="processingMode" control={control} render={({field}) => <select {...field} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none"><option value="auto">Auto</option><option value="single">Single</option><option value="multi">Multi</option></select>} />
            </FieldGroup>
            <FieldGroup label="Workers (optional)" error={errors.workers?.message}>
               <Controller name="workers" control={control} render={({field}) => <input type="number" value={field.value || ''} onChange={e => field.onChange(e.target.value ? parseInt(e.target.value) : null)} placeholder="Auto" className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />} />
            </FieldGroup>
            <FieldGroup label="NCI Backend">
              <Controller name="nciBackend" control={control} render={({field}) => <select {...field} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none"><option value="torch">Torch</option><option value="multiwfn">Multiwfn</option></select>} />
            </FieldGroup>
             <FieldGroup label="Output Directory" error={errors.outputDirectory?.message}>
                <div className="flex gap-2">
                  <Controller
                    name="outputDirectory"
                    control={control}
                    render={({field}) => (
                      <input
                        type="text"
                        {...field}
                        className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none"
                      />
                    )}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.electronAPI?.selectOutputDirectory) {
                        toast({
                          title: 'Folder picker unavailable',
                          description: 'Open the desktop app (Electron) to choose an output directory.',
                          variant: 'destructive',
                        });
                        return;
                      }
                      const chosen = await window.electronAPI.selectOutputDirectory();
                      if (chosen) setValue('outputDirectory', chosen, { shouldDirty: true, shouldValidate: true });
                    }}
                    className="shrink-0 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                  >
                    Browse
                  </button>
                </div>
             </FieldGroup>
            {/* Toggles */}
            <div className="space-y-2.5">
              {(['gpuEnabled', 'forceRecomputation', 'cleanOutputs', 'debugMode', 'enableStopKey', 'interactiveQuadrant'] as const).map((key) => (
                <label key={key} className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <Controller name={key} control={control} render={({field}) => <input type="checkbox" checked={field.value as boolean} onChange={field.onChange} className="rounded" />} />
                </label>
              ))}
            </div>

            {/* Advanced */}
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Advanced NCI Settings
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                {(['gridSpacing', 'gridPadding', 'batchSize', 'eigBatchSize', 'rhoFloor'] as const).map((key) => (
                  <FieldGroup key={key} label={key.replace(/([A-Z])/g, ' $1').trim()} error={errors[key]?.message as string}>
                     <Controller name={key} control={control} render={({field}) => <input type="number" step="any" value={field.value || ''} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : null)} placeholder="Default" className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />} />
                  </FieldGroup>
                ))}
                <FieldGroup label="NCI Device" error={errors.nciDevice?.message}>
                  <Controller name="nciDevice" control={control} render={({field}) => <input type="text" value={field.value || ''} onChange={e => field.onChange(e.target.value || null)} placeholder="Auto" className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />} />
                </FieldGroup>
              </div>
            )}
          </div>
        </form>
        </FormProvider>

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
              onClick={handleSubmit(handleStart)}
              disabled={validCount === 0 || isStarting || !isValid}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {isStarting ? (
                <span className="animate-pulse-glow inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Processing...</span>
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
                <div className="flex justify-between text-xs text-muted-foreground border-t border-border pt-2 mt-2">
                  <span>Backend Status</span>
                  <span className={cn("font-mono font-medium", isConnected ? "text-primary" : "text-muted-foreground")}>
                      {isConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>
                {wsLogs.length > 0 && (
                   <div className="mt-2 p-2 bg-muted rounded-md max-h-40 overflow-y-auto">
                     {wsLogs.map((log, i) => (
                         <div key={i} className="text-[10px] font-mono text-muted-foreground truncate leading-relaxed">
                            {log}
                         </div>
                     ))}
                   </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function FieldGroup({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1.5">{label}</label>
      {children}
      {error && <span className="text-[10px] text-destructive mt-1 block">{error}</span>}
    </div>
  );
}

export default RunManager;
