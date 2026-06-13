import { useCallback, useEffect, useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, CircleDot, Sparkles } from 'lucide-react';
import {
  CartesianGrid,
  Label,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import type { ResultRecord, Quadrant } from '@/types';

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

type Domain = [number, number];

const quadrantColors: Record<Quadrant, string> = {
  Q1: '#22d3ee',
  Q2: '#a78bfa',
  Q3: '#fb923c',
  Q4: '#4ade80',
};

const fullDomain: Domain = [0, 1];

function clampDomain([min, max]: Domain, bounds: Domain): Domain {
  const lower = Math.max(bounds[0], min);
  const upper = Math.min(bounds[1], max);
  if (upper <= lower) return bounds;
  return [lower, upper];
}

function expandOrShrink(domain: Domain, factor: number, bounds: Domain): Domain {
  const center = (domain[0] + domain[1]) / 2;
  const half = ((domain[1] - domain[0]) * factor) / 2;
  return clampDomain([center - half, center + half], bounds);
}

const Explorer = () => {
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [xDomain, setXDomain] = useState<Domain>(fullDomain);
  const [yDomain, setYDomain] = useState<Domain>(fullDomain);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/results`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchResults();
      if (!mounted) return;
    })();
    const timer = setInterval(fetchResults, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [fetchResults]);

  const data = useMemo(() => results.filter(r => r.status === 'success').map(r => ({
    ...r,
    x: r.SNCI_Norm,
    y: r.SCDI_Norm,
  })), [results]);

  const bounds = useMemo(() => {
    if (!data.length) return { x: fullDomain, y: fullDomain };
    const xs = data.map(d => d.x);
    const ys = data.map(d => d.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xPad = (xMax - xMin || 1) * 0.08;
    const yPad = (yMax - yMin || 1) * 0.08;
    return { x: [xMin - xPad, xMax + xPad] as Domain, y: [yMin - yPad, yMax + yPad] as Domain };
  }, [data]);

  const selected = useMemo(() => data.find(d => d.id === selectedId) ?? data[0] ?? null, [data, selectedId]);

  useEffect(() => {
    if (!data.length) {
      setSelectedId(null);
      setXDomain(fullDomain);
      setYDomain(fullDomain);
      return;
    }

    setXDomain(bounds.x);
    setYDomain(bounds.y);
    setSelectedId(prev => (prev && data.some(d => d.id === prev) ? prev : data[0].id));
  }, [data, bounds]);

  const stats = useMemo(() => {
    const counts: Record<Quadrant, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    data.forEach(d => { counts[d.quadrant] += 1; });
    return counts;
  }, [data]);

  const medianX = useMemo(() => {
    const xs = data.map(d => d.x).sort((a, b) => a - b);
    const mid = Math.floor(xs.length / 2);
    return xs.length ? (xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2) : 0;
  }, [data]);

  const medianY = useMemo(() => {
    const ys = data.map(d => d.y).sort((a, b) => a - b);
    const mid = Math.floor(ys.length / 2);
    return ys.length ? (ys.length % 2 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2) : 0;
  }, [data]);

  const zoom = (direction: 'in' | 'out') => {
    const factor = direction === 'in' ? 0.8 : 1.25;
    setXDomain(d => expandOrShrink(d, factor, bounds.x));
    setYDomain(d => expandOrShrink(d, factor, bounds.y));
  };

  const resetZoom = () => {
    if (!data.length) return;
    setXDomain(bounds.x);
    setYDomain(bounds.y);
  };

  const renderDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const isSelected = selected?.id === payload.id;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={isSelected ? 7 : 4}
        fill={quadrantColors[payload.quadrant as Quadrant]}
        stroke={isSelected ? 'white' : 'rgba(255,255,255,0.2)'}
        strokeWidth={isSelected ? 2 : 1}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedId(payload.id);
        }}
      />
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wider">Interactive Explorer</span>
        </div>
        <h1 className="text-2xl font-display font-bold text-foreground">Scatter Explorer</h1>
        <p className="text-sm text-muted-foreground">Zoom the cloud, click a point, and inspect every field on the right.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => zoom('in')} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors">
          <ZoomIn className="w-4 h-4" /> Zoom In
        </button>
        <button onClick={() => zoom('out')} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors">
          <ZoomOut className="w-4 h-4" /> Zoom Out
        </button>
        <button onClick={resetZoom} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors">
          <RotateCcw className="w-4 h-4" /> Reset
        </button>
        <div className="ml-auto text-xs text-muted-foreground inline-flex items-center gap-2">
          <CircleDot className="w-3 h-3" /> Click a point to inspect it
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_420px] gap-6 items-start">
        <div className="rounded-xl border border-border bg-card p-4 min-h-[720px]">
          {loading ? (
            <div className="h-[680px] flex items-center justify-center text-sm text-muted-foreground">Loading plot...</div>
          ) : data.length === 0 ? (
            <EmptyState title="No points to plot" description="Run a computation that produces successful results first." />
          ) : (
            <>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-3">
                {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map(q => (
                  <span key={q} className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: quadrantColors[q] }} />
                    {q}: <span className="font-mono text-foreground">{stats[q]}</span>
                  </span>
                ))}
                <span className="ml-auto font-mono">Points: {data.length}</span>
              </div>
              <div className="h-[640px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 20%, 16%)" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={xDomain}
                      stroke="hsl(215, 15%, 50%)"
                      fontSize={11}
                      fontFamily="JetBrains Mono"
                    >
                      <Label value="SNCI_Norm" position="bottom" offset={10} style={{ fill: 'hsl(215, 15%, 50%)', fontSize: 12, fontFamily: 'Space Grotesk' }} />
                    </XAxis>
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={yDomain}
                      stroke="hsl(215, 15%, 50%)"
                      fontSize={11}
                      fontFamily="JetBrains Mono"
                    >
                      <Label value="SCDI_NORM" angle={-90} position="insideLeft" offset={10} style={{ fill: 'hsl(215, 15%, 50%)', fontSize: 12, fontFamily: 'Space Grotesk' }} />
                    </YAxis>
                    <ReferenceLine x={medianX} stroke="hsl(215, 15%, 35%)" strokeDasharray="6 4" />
                    <ReferenceLine y={medianY} stroke="hsl(215, 15%, 35%)" strokeDasharray="6 4" />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.[0]) return null;
                        const d = payload[0].payload as any;
                        return (
                          <div className="rounded-lg border border-border bg-popover p-3 text-xs shadow-lg max-w-xs">
                            <p className="font-medium text-foreground mb-1">{d.fileName}</p>
                            <p className="text-muted-foreground">Quadrant: <span className="font-mono text-foreground">{d.quadrant}</span></p>
                            <p className="text-muted-foreground">SNCI_Norm: <span className="font-mono text-foreground">{Number(d.x).toFixed(4)}</span></p>
                            <p className="text-muted-foreground">SCDI_Norm: <span className="font-mono text-foreground">{Number(d.y).toFixed(4)}</span></p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={data} shape={renderDot} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        <aside className="rounded-xl border border-border bg-card p-4 sticky top-6">
          {!selected ? (
            <EmptyState title="No point selected" description="Click any point on the scatter plot to inspect its full record." />
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-display font-bold text-foreground truncate">{selected.fileName}</h2>
                    <p className="text-xs text-muted-foreground font-mono">{selected.runId}</p>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>
                <div className="mt-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: `${quadrantColors[selected.quadrant]}22`, color: quadrantColors[selected.quadrant] }}>
                  Quadrant {selected.quadrant}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="SNCI" value={selected.SNCI.toFixed(4)} />
                <Stat label="SCDI" value={selected.SCDI.toFixed(4)} />
                <Stat label="Variance" value={selected.SCDI_variance.toExponential(2)} />
                <Stat label="SNCI_Norm" value={selected.SNCI_Norm.toFixed(4)} />
                <Stat label="SCDI_Norm" value={selected.SCDI_Norm.toFixed(4)} />
                <Stat label="f2_defined" value={selected.f2_defined ? 'Yes' : 'No'} />
              </div>

              <div className="rounded-lg border border-border p-3 max-h-[480px] overflow-y-auto">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs font-mono">
                  {Object.entries(selected).map(([key, value]) => {
                    if (['id', 'runId', 'fileName', 'status', 'quadrant'].includes(key)) return null;
                    return (
                      <div key={key} className="col-span-2 grid grid-cols-[140px_minmax(0,1fr)] gap-2 py-1 border-b border-border/50 last:border-b-0">
                        <span className="text-muted-foreground break-words">{key}</span>
                        <span className="text-foreground break-words text-right">{typeof value === 'number' ? value.toString() : String(value ?? '-')}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-mono text-foreground break-all">{value}</p>
    </div>
  );
}

export default Explorer;
