import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

type ColKey = keyof ResultRecord;

const columnMeta: { key: ColKey; label: string; numeric: boolean; sortKey?: string }[] = [
  { key: 'fileName', label: 'File', numeric: false },
  { key: 'f1', label: 'f1', numeric: true },
  { key: 'f2', label: 'f2', numeric: true },
  { key: 'f3', label: 'f3', numeric: true },
  { key: 'f4', label: 'f4', numeric: true },
  { key: 'f5', label: 'f5', numeric: true },
  { key: 'f6', label: 'f6', numeric: true },
  { key: 'f7', label: 'f7', numeric: true },
  { key: 'f8', label: 'f8', numeric: true },
  { key: 'f9', label: 'f9', numeric: true },
  { key: 'f2_defined', label: 'f2_defined', numeric: false },
  { key: 'KUID_raw', label: 'KUID_raw', numeric: false },
  { key: 'KUID', label: 'KUID', numeric: false },
  { key: 'KUID_Cluster', label: 'KUID_Cluster', numeric: false },
  { key: 'KUID_Intensive_raw', label: 'KUID_Intensive_raw', numeric: false },
  { key: 'KUID_Intensive', label: 'KUID_Intensive', numeric: false },
  { key: 'KUID_Intensive_Cluster', label: 'KUID_Intensive_Cluster', numeric: false },
  { key: 'KUID_prefix2', label: 'KUID_prefix2', numeric: false },
  { key: 'KUID_prefix4', label: 'KUID_prefix4', numeric: false },
  { key: 'KUID_prefix6', label: 'KUID_prefix6', numeric: false },
  { key: 'SNCI', label: 'SNCI', numeric: true },
  { key: 'SCDI_variance', label: 'SCDI_variance', numeric: true },
  { key: 'SNCI_Norm', label: 'SNCI_Norm', numeric: true },
  { key: 'SCDI_Norm', label: 'SCDI_Norm', numeric: true },
];

const quadrantColors: Record<Quadrant, string> = {
  Q1: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  Q2: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  Q3: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  Q4: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

const Results = () => {
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [active, setActive] = useState(false);

  const fetchResults = useCallback(async (mounted: boolean) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/results`);
      const data = await res.json();
      if (!mounted) return;
      const list: ResultRecord[] = data.results || [];
      setResults(list);
      setActive(list.some(r => r.status === 'running' || r.status === 'queued'));
    } catch {
      if (mounted) setResults([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchResults(mounted);
      if (mounted) setLoading(false);
    })();
  }, [fetchResults]);

  // Poll every 3s while any result has an active status
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => fetchResults(true), 3000);
    return () => clearInterval(id);
  }, [active, fetchResults]);

  const handleSort = useCallback(
    (key: ColKey) => {
      setSortDir(prev => (sortKey === key && prev === 'asc' ? 'desc' : 'asc'));
      setSortKey(key);
    },
    [sortKey],
  );

  const filtered = useMemo(() => {
    if (!search) return results;
    const q = search.toLowerCase();
    return results.filter(r => r.fileName.toLowerCase().includes(q) || r.runId.toLowerCase().includes(q));
  }, [results, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const result = cmp(a[sortKey], b[sortKey]);
      return sortDir === 'asc' ? result : -result;
    });
  }, [filtered, sortKey, sortDir]);

  const renderCell = (col: (typeof columnMeta)[number], r: ResultRecord) => {
    const val = r[col.key];
    if (val === null || val === undefined) return '-';
    if (col.key === 'f2_defined') return val ? 'Yes' : 'No';
    if (col.numeric && typeof val === 'number') return val.toFixed(4);
    return String(val);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Results Library</h1>
          <p className="text-sm text-muted-foreground mt-1">Interactive table of all computation results</p>
        </div>
        {results.some(r => r.status === 'running' || r.status === 'queued') && (
          <span className="inline-flex items-center gap-1.5 text-xs text-primary font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Auto-refreshing
          </span>
        )}
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by file or run id"
          className="w-full rounded-lg bg-input border border-border pl-9 pr-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none"
        />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-5 text-sm text-muted-foreground">Loading results...</div>
        ) : sorted.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No results yet" description="Run a computation to generate real result records." />
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  {columnMeta.map(col => (
                    <TableHead
                      key={col.key}
                      className={`whitespace-nowrap cursor-pointer select-none ${col.numeric ? 'text-right' : 'text-left'}`}
                      onClick={() => handleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortKey === col.key ? (
                          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-30" />
                        )}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="whitespace-nowrap text-center">Quadrant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(r => (
                  <TableRow key={r.id}>
                    {columnMeta.map(col => (
                      <TableCell
                        key={col.key}
                        className={`font-mono text-xs ${col.numeric ? 'text-right' : 'text-left'} max-w-[200px] truncate`}
                      >
                        {renderCell(col, r)}
                      </TableCell>
                    ))}
                    <TableCell className="text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${quadrantColors[r.quadrant]}`}
                      >
                        {r.quadrant}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Results;
