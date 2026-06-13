import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, BarChart3, Activity, CheckCircle2, Zap, Clock, RefreshCw, Square } from 'lucide-react';
import { StatsCard } from '@/components/shared/StatsCard';
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

const Dashboard = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/runs`);
      const data = await res.json();
      setRuns(data.runs || []);
    } catch {
      setRuns([]);
    }
  }, []);

  const stopRun = useCallback(async (id: string) => {
    setStopping(id);
    try {
      const wsUrl = getApiBaseUrl().replace(/^http/, 'ws') + '/ws/run';
      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => { ws.send(JSON.stringify({ action: 'q', runId: id })); resolve(); };
        ws.onerror = () => reject(new Error('WebSocket connection failed'));
        ws.onclose = () => resolve();
      });
      toast({ title: 'Stop Signal Sent', description: `Run ${id} is being stopped.` });
      setTimeout(fetchRuns, 500);
    } catch {
      toast({ title: 'Failed to Stop', description: 'Could not reach backend via WebSocket.', variant: 'destructive' });
    } finally {
      setStopping(null);
    }
  }, [toast, fetchRuns]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchRuns();
      if (mounted) setLoading(false);
    })();
  }, [fetchRuns]);

  // Poll every 3s while any run is still processing
  useEffect(() => {
    const hasActive = runs.some(r => r.status === 'processing' || r.status === 'queued');
    if (!hasActive) return;
    const id = setInterval(fetchRuns, 3000);
    return () => clearInterval(id);
  }, [runs, fetchRuns]);

  const stats = useMemo(() => {
    const totalRuns = runs.length;
    const activeRuns = runs.filter(r => r.status === 'processing' || r.status === 'queued').length;
    const success = runs.filter(r => r.status === 'completed').length;
    const successRate = totalRuns > 0 ? Math.round((success / totalRuns) * 100) : 0;
    const lastThroughput = runs[0]?.throughput ?? 0;
    return { totalRuns, activeRuns, successRate, lastThroughput };
  }, [runs]);

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-7xl">
      <header className="animate-fade-in-up flex items-start justify-between">
        <div>
          <h1 className="text-3xl lg:text-4xl font-display font-bold text-foreground tracking-tight">
            <span className="text-gradient">KNF Studio</span>
          </h1>
          <p className="text-muted-foreground mt-1">Live backend data only (no demo dataset).</p>
        </div>
        {stats.activeRuns > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-primary font-medium">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {stats.activeRuns} active
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Runs" value={stats.totalRuns} icon={Activity} variant="default" />
        <StatsCard title="Active Runs" value={stats.activeRuns} icon={Zap} variant="primary" subtitle="Currently processing" />
        <StatsCard title="Success Rate" value={`${stats.successRate}%`} icon={CheckCircle2} variant="success" />
        <StatsCard title="Last Throughput" value={`${stats.lastThroughput} f/min`} icon={Clock} variant="default" />
      </div>

      <div className="flex flex-wrap gap-3 animate-fade-in-up delay-3">
        <Link to="/runs" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-all btn-press">
          <Play className="w-4 h-4" /> New Run
        </Link>
        <Link to="/results" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-all btn-press">
          <BarChart3 className="w-4 h-4" /> Open Results
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-display font-semibold text-foreground">Recent Runs</h2>
        </div>
        {loading ? (
          <div className="p-5 text-sm text-muted-foreground">Loading runs...</div>
        ) : runs.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No runs yet" description="Start a run from Run Manager to populate real data." />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {runs.map(run => (
              <div key={run.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/50 transition-all group">
                <Link to={`/runs/${run.id}`} className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{run.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{run.id} · {run.totalFiles} files</p>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  {(run.status === 'processing' || run.status === 'queued') && (
                    <button
                      onClick={e => { e.preventDefault(); stopRun(run.id); }}
                      disabled={stopping === run.id}
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-all disabled:opacity-50"
                    >
                      <Square className="w-3 h-3" />
                      {stopping === run.id ? '...' : 'Stop'}
                    </button>
                  )}
                  <StatusBadge status={run.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
