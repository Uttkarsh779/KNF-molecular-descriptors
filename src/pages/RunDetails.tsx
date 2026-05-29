import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Square, RotateCcw, Download, Copy, Cpu, HardDrive, Users } from 'lucide-react';
import { StatsCard } from '@/components/shared/StatsCard';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { MOCK_RUNS, MOCK_JOBS, MOCK_LOG_LINES } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { EmptyState } from '@/components/shared/EmptyState';
import type { Run } from '@/types';

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const RunDetails = () => {
  const { runId } = useParams<{ runId: string }>();
  const run = MOCK_RUNS.find(r => r.id === runId);
  const jobs = MOCK_JOBS.filter(j => j.runId === runId);
  const [stopRequested, setStopRequested] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, []);

  if (!run) {
    return (
      <div className="p-6 lg:p-8">
        <EmptyState title="Run not found" description={`No run found with ID "${runId}".`} action={<Link to="/runs" className="text-sm text-primary hover:underline">← Back to Run Manager</Link>} />
      </div>
    );
  }

  const handleStop = () => {
    setStopRequested(true);
    setShowStopModal(false);
    toast({ title: 'Stop Requested', description: 'Finishing running tasks and finalizing partial outputs.' });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <Link to="/runs" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3 h-3" /> Back to Runs
          </Link>
          <h1 className="text-2xl font-display font-bold text-foreground">{run.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">{run.id} · Created {new Date(run.createdAt).toLocaleDateString()}</p>
        </div>
        <StatusBadge status={stopRequested ? 'stop_requested' : run.status} />
      </div>

      {/* Stop Banner */}
      {stopRequested && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-5 py-3 text-sm text-warning" role="alert" aria-live="polite">
          ⚠ Stop requested. Finishing running tasks and finalizing partial outputs.
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <MiniStat label="Total" value={run.totalFiles} />
        <MiniStat label="Completed" value={run.completedFiles} />
        <MiniStat label="Success" value={run.successFiles} variant="success" />
        <MiniStat label="Failed" value={run.failedFiles} variant="destructive" />
        <MiniStat label="Stopped" value={run.stoppedFiles} variant="warning" />
        <MiniStat label="Elapsed" value={formatMs(run.elapsedMs)} />
        <MiniStat label="ETA" value={run.etaMs ? formatMs(run.etaMs) : '—'} />
      </div>

      {/* Resource Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard title="CPU Usage" value={`${run.cpuPercent ?? 0}%`} icon={Cpu} variant={run.cpuPercent && run.cpuPercent > 80 ? 'warning' : 'default'} />
        <StatsCard title="RAM Usage" value={`${run.ramPercent ?? 0}%`} icon={HardDrive} variant={run.ramPercent && run.ramPercent > 80 ? 'warning' : 'default'} />
        <StatsCard title="Active Workers" value={run.activeWorkers ?? 0} icon={Users} variant="primary" />
      </div>

      {/* Log Console */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Live Log</h2>
          <button onClick={() => { navigator.clipboard.writeText(MOCK_LOG_LINES.join('\n')); toast({ title: 'Copied', description: 'Log copied to clipboard.' }); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
            <Copy className="w-3 h-3" /> Copy
          </button>
        </div>
        <div ref={logRef} className="p-4 h-64 overflow-y-auto font-mono text-xs leading-relaxed text-muted-foreground">
          {MOCK_LOG_LINES.map((line, i) => (
            <div key={i} className={cn(line.includes('FAILED') ? 'text-destructive' : line.includes('✓') ? 'text-success' : '')}>
              {line}
            </div>
          ))}
        </div>
      </div>

      {/* Jobs Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Jobs ({jobs.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-medium">File</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Elapsed</th>
                <th className="text-left px-5 py-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map(job => (
                <tr key={job.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 font-mono text-foreground">{job.fileName}</td>
                  <td className="px-5 py-3"><StatusBadge status={job.status} /></td>
                  <td className="px-5 py-3 font-mono text-muted-foreground">{formatMs(job.elapsedMs)}</td>
                  <td className="px-5 py-3 text-xs text-destructive truncate max-w-xs">{job.errorMessage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sticky Action Bar */}
      <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm border-t border-border -mx-6 lg:-mx-8 px-6 lg:px-8 py-4 flex flex-wrap gap-3">
        <button
          onClick={() => setShowStopModal(true)}
          disabled={stopRequested || run.status === 'completed' || run.status === 'failed'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          <Square className="w-4 h-4" /> {stopRequested ? 'Stop Requested' : 'Stop Processing'}
        </button>
        <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
          <RotateCcw className="w-4 h-4" /> Retry Failed
        </button>
        <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
          <Download className="w-4 h-4" /> Export Partial Results
        </button>
      </div>

      {/* Stop Confirmation Modal */}
      {showStopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="rounded-xl border border-border bg-card p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="font-display font-bold text-foreground text-lg mb-2">Stop Processing?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This will gracefully stop all running tasks. Completed results will be preserved. Files currently being processed will finish before stopping.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowStopModal(false)} className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors">
                Cancel
              </button>
              <button onClick={handleStop} className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                Stop Processing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function MiniStat({ label, value, variant }: { label: string; value: string | number; variant?: 'success' | 'destructive' | 'warning' }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-display font-bold', variant === 'success' ? 'text-success' : variant === 'destructive' ? 'text-destructive' : variant === 'warning' ? 'text-warning' : 'text-foreground')}>
        {value}
      </p>
    </div>
  );
}

export default RunDetails;
