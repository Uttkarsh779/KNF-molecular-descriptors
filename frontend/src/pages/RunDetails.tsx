import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Copy, RefreshCw, Square } from 'lucide-react';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { useToast } from '@/hooks/use-toast';
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
      toast({ title: 'Stop Signal Sent', description: `Run ${runId} is being stopped.` });
      setTimeout(fetchData, 500);
    } catch {
      toast({ title: 'Failed to Stop', description: 'Could not reach backend via WebSocket.', variant: 'destructive' });
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

  if (loading) return <div className="p-6 lg:p-8 text-sm text-muted-foreground">Loading run details...</div>;

  if (!run) {
    return (
      <div className="p-6 lg:p-8">
        <EmptyState
          title="Run not found"
          description={`No backend run found with ID "${runId}".`}
          action={<Link to="/" className="text-sm text-primary hover:underline">← Back to Dashboard</Link>}
        />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3 h-3" /> Back
          </Link>
          <h1 className="text-2xl font-display font-bold text-foreground">{run.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">{run.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {(run.status === 'processing' || run.status === 'queued') && (
            <>
              <button
                onClick={stopRun}
                disabled={stopping}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Square className="w-3 h-3" />
                {stopping ? 'Stopping...' : 'Stop'}
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Mini label="Total" value={run.totalFiles} />
        <Mini label="Completed" value={run.completedFiles} />
        <Mini label="Success" value={run.successFiles} />
        <Mini label="Failed" value={run.failedFiles} />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Run Log</h2>
          <button
            onClick={() => navigator.clipboard.writeText(logs.join('\n'))}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Copy
          </button>
        </div>
        <div className="p-4 h-72 overflow-y-auto font-mono text-xs leading-relaxed text-muted-foreground">
          {logs.length === 0 ? 'No logs captured for this run.' : logs.map((line, idx) => <div key={idx}>{line}</div>)}
        </div>
      </div>
    </div>
  );
};

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-display font-bold text-foreground">{value}</p>
    </div>
  );
}

export default RunDetails;
