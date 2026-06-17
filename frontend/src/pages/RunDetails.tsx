import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Copy, RefreshCw, Square, Terminal, CheckCircle2, XCircle, FileText, Check } from 'lucide-react';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Run } from '@/types';

function getApiBaseUrl(): string {
  try {
    const raw = localStorage.getItem('knf-settings');
    if (!raw) return 'http://127.0.0.1:8765';
    const parsed = JSON.parse(raw);
    return (parsed.apiBaseUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  } catch {
    return 'http://127.0.0.1:8765';
  }
}

const RunDetails = () => {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    if (!runId) return;
    try {
      const base = getApiBaseUrl();
      const [runRes, logRes] = await Promise.all([
        fetch(`${base}/api/runs/${runId}`),
        fetch(`${base}/api/runs/${runId}/logs`),
      ]);
      const runData = await runRes.json();
      const logData = await logRes.json();
      setRun(runData.run || null);
      setLogs(logData.logs || []);
    } catch {
      setRun(null);
      setLogs([]);
    }
  }, [runId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchData();
      if (mounted) setLoading(false);
    })();
  }, [fetchData]);

  const stopRun = useCallback(async () => {
    if (!runId || stopping) return;
    setStopping(true);
    try {
      const wsUrl = getApiBaseUrl().replace(/^http/, 'ws') + '/ws/run';
      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => { ws.send(JSON.stringify({ action: 'q', runId })); resolve(); };
        ws.onerror = () => reject(new Error('WebSocket connection failed'));
        ws.onclose = () => resolve();
      });
      toast({ title: 'Termination Signal Sent', description: `Run ${runId} is being stopped.` });
      setTimeout(fetchData, 500);
    } catch {
      toast({ title: 'Stop Failed', description: 'Could not reach backend via WebSocket.', variant: 'destructive' });
    } finally {
      setStopping(false);
    }
  }, [runId, stopping, toast, fetchData]);

  // Poll every 3s while the run is still processing
  useEffect(() => {
    if (!run || (run.status !== 'processing' && run.status !== 'queued')) return;
    const id = setInterval(fetchData, 3000);
    return () => clearInterval(id);
  }, [run, fetchData]);

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-4 animate-fade-in-up">
        <div className="h-8 w-48 animate-shimmer rounded-lg" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl animate-shimmer" />)}
        </div>
        <div className="h-64 rounded-xl animate-shimmer" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6 lg:p-8">
        <EmptyState
          title="Run not found"
          description={`No computation record found with ID "${runId}".`}
          action={
            <Link to="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium border border-primary/20 hover:bg-primary/20 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
          }
        />
      </div>
    );
  }

  const progressPct = run.totalFiles > 0 ? Math.round((run.completedFiles / run.totalFiles) * 100) : 0;
  const isActive = run.status === 'processing' || run.status === 'queued';

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl animate-fade-in-up">
      {/* Top Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <Link
            to="/"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" /> Dashboard
          </Link>
          <h1 className="text-2xl font-display font-bold text-foreground leading-tight">{run.name}</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5 select-all">{run.id}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isActive && (
            <>
              <button
                onClick={stopRun}
                disabled={stopping}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 text-xs font-semibold border border-rose-500/20 hover:bg-rose-500/20 transition-all',
                  stopping && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Square className="w-3 h-3" />
                {stopping ? 'Stopping...' : 'Terminate Run'}
              </button>
              <span className="inline-flex items-center gap-1.5 text-xs text-primary font-medium">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Live
              </span>
            </>
          )}
          <StatusBadge status={run.status} />
        </div>
      </div>

      {/* Progress Bar (Active Runs Only) */}
      {isActive && (
        <div className="rounded-lg border border-glass bg-card/45 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span>Computation Progress</span>
            <span>{run.completedFiles} / {run.totalFiles} files processed ({progressPct}%)</span>
          </div>
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Files"
          value={run.totalFiles}
          icon={<FileText className="w-4 h-4" />}
          color="#6366f1"
        />
        <MetricCard
          label="Completed"
          value={run.completedFiles}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color="#0ea5e9"
        />
        <MetricCard
          label="Successful"
          value={run.successFiles}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color="#10b981"
        />
        <MetricCard
          label="Failed"
          value={run.failedFiles}
          icon={<XCircle className="w-4 h-4" />}
          color={run.failedFiles > 0 ? '#ef4444' : '#71717a'}
        />
      </div>

      {/* Config Summary */}
      {run.config && Object.keys(run.config).length > 0 && (
        <div className="rounded-lg border border-glass bg-card/45 overflow-hidden">
          <div className="px-5 py-3 border-b border-glass">
            <h2 className="text-sm font-semibold text-foreground">Execution Configuration</h2>
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(run.config)
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([key, value]) => (
                <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900/10 px-3 py-2">
                  <span className="text-[9px] text-muted-foreground font-mono uppercase tracking-wider block">{key}</span>
                  <span className="text-xs font-mono text-foreground/90 block mt-0.5 truncate">
                    {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Terminal Log Viewer */}
      <div className="rounded-lg border border-glass overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-glass bg-zinc-950">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Execution Log Stream</h2>
            {logs.length > 0 && (
              <span className="text-[10px] text-muted-foreground font-mono">({logs.length} lines)</span>
            )}
          </div>
          <button
            onClick={copyLogs}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy All'}
          </button>
        </div>
        <div className="terminal-console p-4 h-80 overflow-y-auto space-y-1">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50 font-mono">
              No log output captured for this run.
            </div>
          ) : (
            logs.map((line, idx) => {
              let cls = 'terminal-row';
              if (line.startsWith('> ')) cls = 'terminal-row command text-primary/80';
              else if (/error|fail/i.test(line)) cls = 'terminal-row error text-rose-400';
              else if (/success|completed|done|finished/i.test(line)) cls = 'terminal-row success text-emerald-400';

              return (
                <div key={idx} className={cn(cls, 'text-[10px] leading-relaxed text-muted-foreground')}>
                  {line}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

function MetricCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-lg border border-glass bg-card/45 p-4 card-hover-glow">
      <div className="flex items-center gap-2 mb-2">
        <div style={{ color }}>{icon}</div>
        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-display font-bold text-foreground">{value}</p>
    </div>
  );
}

export default RunDetails;
