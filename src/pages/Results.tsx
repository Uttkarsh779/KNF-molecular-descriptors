import { useState, useMemo } from 'react';
import { Download, Search, X, Copy, ChevronRight } from 'lucide-react';
import { MOCK_RESULTS, MOCK_QUADRANT_DATA } from '@/data/mockData';
import { QuadrantChart } from '@/components/QuadrantChart';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { cn } from '@/lib/utils';
import type { ResultRecord, Quadrant } from '@/types';
import { useToast } from '@/hooks/use-toast';

const QUADRANTS: Quadrant[] = ['Q1', 'Q2', 'Q3', 'Q4'];
const PAGE_SIZE = 15;

const Results = () => {
  const [search, setSearch] = useState('');
  const [quadrantFilter, setQuadrantFilter] = useState<Quadrant | ''>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<ResultRecord | null>(null);
  const [sortKey, setSortKey] = useState<keyof ResultRecord>('fileName');
  const [sortAsc, setSortAsc] = useState(true);
  const { toast } = useToast();

  const filtered = useMemo(() => {
    let data = [...MOCK_RESULTS];
    if (search) data = data.filter(r => r.fileName.toLowerCase().includes(search.toLowerCase()));
    if (quadrantFilter) data = data.filter(r => r.quadrant === quadrantFilter);
    if (statusFilter) data = data.filter(r => r.status === statusFilter);
    data.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return data;
  }, [search, quadrantFilter, statusFilter, sortKey, sortAsc]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const handleSort = (key: keyof ResultRecord) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
    setPage(0);
  };

  const downloadJSON = (data: unknown, name: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Downloaded', description: name });
  };

  const downloadCSV = () => {
    const headers = ['fileName', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'SNCI', 'SCDI', 'SCDI_variance', 'SNCI_Norm', 'SCDI_Norm', 'quadrant'];
    const rows = MOCK_RESULTS.map(r => headers.map(h => (r as any)[h]).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'batch_knf.csv'; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Downloaded', description: 'batch_knf.csv' });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      <header className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Results Library</h1>
          <p className="text-sm text-muted-foreground mt-1">{MOCK_RESULTS.length} records across all runs</p>
        </div>
        {/* Export Actions */}
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadCSV} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
            <Download className="w-3.5 h-3.5" /> batch_knf.csv
          </button>
          <button onClick={() => downloadJSON(MOCK_RESULTS, 'batch_knf.json')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
            <Download className="w-3.5 h-3.5" /> batch_knf.json
          </button>
          <button onClick={() => downloadJSON(MOCK_QUADRANT_DATA, 'snci_scdi_quadrants.json')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
            <Download className="w-3.5 h-3.5" /> quadrants.json
          </button>
          <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(MOCK_QUADRANT_DATA, null, 2)); toast({ title: 'Copied', description: 'Quadrant JSON copied.' }); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
            <Copy className="w-3.5 h-3.5" /> Copy Quadrant JSON
          </button>
        </div>
      </header>

      {/* Quadrant Chart */}
      <QuadrantChart results={MOCK_RESULTS} quadrantData={MOCK_QUADRANT_DATA} />

      {/* Quadrant File Lists */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {QUADRANTS.map(q => (
          <div key={q} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-foreground">{q}</h3>
              <span className="text-xs font-mono text-muted-foreground">{MOCK_QUADRANT_DATA.counts[q]} files</span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {MOCK_QUADRANT_DATA.files[q].map(f => (
                <p key={f} className="text-xs text-muted-foreground font-mono truncate">{f}</p>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search files..."
            className="w-full rounded-lg bg-input border border-border pl-9 pr-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none"
          />
        </div>
        <select value={quadrantFilter} onChange={e => { setQuadrantFilter(e.target.value as Quadrant | ''); setPage(0); }} className="rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none">
          <option value="">All Quadrants</option>
          {QUADRANTS.map(q => <option key={q} value={q}>{q}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }} className="rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none">
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="stopped">Stopped</option>
        </select>
        {(search || quadrantFilter || statusFilter) && (
          <button onClick={() => { setSearch(''); setQuadrantFilter(''); setStatusFilter(''); setPage(0); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} results</span>
      </div>

      {/* Results Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                {[
                  ['fileName', 'File'],
                  ['SNCI_Norm', 'SNCI_Norm'],
                  ['SCDI_Norm', 'SCDI_Norm'],
                  ['SNCI', 'SNCI'],
                  ['SCDI', 'SCDI'],
                  ['SCDI_variance', 'Var'],
                  ['quadrant', 'Quad'],
                  ['status', 'Status'],
                ].map(([key, label]) => (
                  <th key={key} className="text-left px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none" onClick={() => handleSort(key as keyof ResultRecord)}>
                    {label} {sortKey === key ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paged.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedRecord(r)}>
                  <td className="px-4 py-3 font-mono text-foreground">{r.fileName}</td>
                  <td className="px-4 py-3 font-mono text-primary">{r.SNCI_Norm.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-primary">{r.SCDI_Norm.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{r.SNCI.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{r.SCDI.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{r.SCDI_variance.toFixed(4)}</td>
                  <td className="px-4 py-3"><span className="font-mono text-xs">{r.quadrant}</span></td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground"><ChevronRight className="w-4 h-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">Previous</button>
            <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">Next</button>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedRecord(null)}>
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-md bg-card border-l border-border h-full overflow-y-auto animate-slide-in" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
              <h3 className="font-display font-bold text-foreground">{selectedRecord.fileName}</h3>
              <button onClick={() => setSelectedRecord(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <Section title="Status">
                <StatusBadge status={selectedRecord.status} />
                <span className="text-xs font-mono text-muted-foreground ml-2">{selectedRecord.quadrant}</span>
              </Section>
              <Section title="Normalized Metrics">
                <MetricRow label="SNCI_Norm" value={selectedRecord.SNCI_Norm.toFixed(6)} highlight />
                <MetricRow label="SCDI_Norm" value={selectedRecord.SCDI_Norm.toFixed(6)} highlight />
              </Section>
              <Section title="Raw Metrics">
                <MetricRow label="SNCI" value={selectedRecord.SNCI.toFixed(6)} />
                <MetricRow label="SCDI" value={selectedRecord.SCDI.toFixed(6)} />
                <MetricRow label="SCDI_variance" value={selectedRecord.SCDI_variance.toFixed(6)} />
              </Section>
              <Section title="KNF Descriptors">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
                  <MetricRow key={i} label={`f${i}`} value={(selectedRecord as any)[`f${i}`].toFixed(4)} />
                ))}
              </Section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono', highlight ? 'text-primary' : 'text-foreground')}>{value}</span>
    </div>
  );
}

export default Results;
