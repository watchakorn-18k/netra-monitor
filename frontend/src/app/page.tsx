'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp, Clock3, Cpu, Flame, Gauge, HardDrive, Monitor, ServerCog, Thermometer, Timer, Database } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ── Types (matching Go backend JSON) ───────────────────
interface Stats {
  cpu: { usage: number; cores: number; perCore: number[] };
  memory: { total: number; used: number; available: number; percent: number; swapTotal: number; swapUsed: number; swapPercent: number };
  disks: { device: string; mount: string; total: number; used: number; free: number; percent: number }[];
  diskIO: { readBytes: number; writeBytes: number };
  network: { interface: string; rxBytes: number; txBytes: number };
  system: { hostname: string; os: string; arch: string; kernel: string; uptime: number };
  topProcesses: { name: string; service?: string; pid: number; cpu: number; mem: number }[];
  history: { cpu: number[]; memory: number[]; netRx: number[]; netTx: number[] };
  authEnabled: boolean;
  authenticated: boolean;
}

interface HistoryPoint {
  cpu: number;
  mem: number;
  netIn: number;
  netOut: number;
  time: string;
}

// ── Helpers ────────────────────────────────────────────
function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatBytesPerSec(bytes: number): string {
  return formatBytes(bytes) + '/s';
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getStatusColor(value: number): string {
  if (value < 50) return 'text-emerald-400';
  if (value < 75) return 'text-amber-400';
  return 'text-red-400';
}

function getBarColor(value: number): string {
  if (value < 50) return 'bg-emerald-500';
  if (value < 75) return 'bg-amber-500';
  return 'bg-red-500';
}

function getBadgeVariant(value: number): 'default' | 'secondary' | 'destructive' {
  if (value < 50) return 'default';
  if (value < 75) return 'secondary';
  return 'destructive';
}

// ── SVG Circular Gauge ─────────────────────────────────
function CircularProgress({ value, size = 150, strokeWidth = 10, label, sub }: {
  value: number; size?: number; strokeWidth?: number; label: string; sub?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;
  const center = size / 2;
  const color = value < 50 ? '#10b981' : value < 75 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <svg width={size} height={size} className="ring-progress">
          <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" className="text-muted" strokeWidth={strokeWidth} />
          <circle
            cx={center} cy={center} r={radius}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tracking-tight" style={{ color }}>
            {value.toFixed(1)}%
          </span>
          {sub && <span className="text-xs text-muted-foreground mt-1">{sub}</span>}
        </div>
      </div>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

// ── SVG Sparkline ──────────────────────────────────────
function Sparkline({ data, color, height = 50 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return <div className="h-[50px]" />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 300;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ');
  const area = `0,${height} ${pts} ${w},${height}`;
  const id = `sp-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={pts} className="sparkline" stroke={color} />
    </svg>
  );
}

// ── Disk Progress Bar ──────────────────────────────────
function DiskBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const color = getBarColor(pct);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="text-muted-foreground">
          {formatBytes(value)} / {formatBytes(max)}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ── MAIN DASHBOARD ─────────────────────────────────────
// ════════════════════════════════════════════════════════
export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const prevNetRef = useRef<{ rx: number; tx: number; ts: number } | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const data: Stats = await res.json();

      // Validate essential fields exist before setting state
      if (!data?.memory || !data?.cpu || !data?.network || !data?.system) return;

      setStats(data);
      setLastUpdate(new Date());

      // Calculate net rate from cumulative bytes
      const now = Date.now();
      const prev = prevNetRef.current;
      let rxSec = 0, txSec = 0;
      if (prev) {
        const dt = (now - prev.ts) / 1000;
        if (dt > 0) {
          rxSec = Math.max(0, (data.network.rxBytes - prev.rx) / dt);
          txSec = Math.max(0, (data.network.txBytes - prev.tx) / dt);
        }
      }
      prevNetRef.current = { rx: data.network.rxBytes, tx: data.network.txBytes, ts: now };

      setHistory(prev => {
        const p: HistoryPoint = {
          cpu: data.cpu.usage,
          mem: data.memory.percent,
          netIn: rxSec,
          netOut: txSec,
          time: new Date().toLocaleTimeString('th-TH', { hour12: false }),
        };
        const next = [...prev, p];
        return next.length > 60 ? next.slice(-60) : next;
      });
      setLoading(false);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 2000);
    return () => clearInterval(id);
  }, [fetchStats]);

  // ── Loading ──────────────────────────────────────────
  if (loading || !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="inline-block w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground text-lg">Loading VPS Stats...</p>
        </div>
      </div>
    );
  }

  const cpuH = history.map(h => h.cpu);
  const memH = history.map(h => h.mem);
  const netInH = history.map(h => h.netIn);
  const netOutH = history.map(h => h.netOut);

  // ── Render ───────────────────────────────────────────
  return (
    <div className="min-h-screen pb-10">
      {/* ── Header ──────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-lg">
              <Monitor className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">
                VPS Monitor
              </h1>
              <p className="text-xs text-muted-foreground">
                {stats.system.hostname} | {stats.system.os} {stats.system.arch} | Kernel {stats.system.kernel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="gap-1.5 text-xs">
              <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Live
            </Badge>
            <span className="text-xs text-muted-foreground hidden sm:block">
              {lastUpdate.toLocaleTimeString('th-TH', { hour12: false })}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 space-y-5">
        {/* ── Top quick stats ─────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { Icon: Clock3, label: 'Uptime', value: formatUptime(stats.system.uptime), bg: 'from-white/5 to-white/[0.02]', ring: 'ring-white/10' },
            { Icon: ServerCog, label: 'Processes', value: String(stats.topProcesses.length), sub: 'top procs', bg: 'from-white/5 to-white/[0.02]', ring: 'ring-white/10' },
            { Icon: Database, label: 'Swap', value: stats.memory.swapTotal > 0 ? `${stats.memory.swapPercent}%` : 'None', sub: stats.memory.swapTotal > 0 ? formatBytes(stats.memory.swapUsed) : undefined, bg: 'from-white/5 to-white/[0.02]', ring: 'ring-white/10' },
            { Icon: Thermometer, label: 'CPU Temp', value: 'N/A', bg: 'from-white/5 to-white/[0.02]', ring: 'ring-white/10' },
          ].map(({ Icon, ...item }, i) => (
            <Card key={i} className={`bg-gradient-to-br ${item.bg} ring-1 ${item.ring} fade-in-up`} style={{ animationDelay: `${i * 0.05}s` }}>
              <CardContent className="flex items-center gap-3 p-4">
                <Icon className="h-6 w-6 text-white/80 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <p className="text-xl font-bold tracking-tight">{item.value}</p>
                  {item.sub && <p className="text-xs text-muted-foreground">{item.sub}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Main gauges: CPU | Memory | Network ────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* CPU */}
          <Card className="fade-in-up" style={{ animationDelay: '0.1s' }}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm uppercase tracking-wider">CPU Usage</CardTitle>
                <Badge variant={getBadgeVariant(stats.cpu.usage)}>{stats.cpu.cores} cores</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center pt-2">
              <CircularProgress value={stats.cpu.usage} label="CPU" sub={`${stats.cpu.cores} cores`} />

              {/* Per-core bars */}
              <div className="w-full mt-5 space-y-2">
                {stats.cpu.perCore.map((load, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-12 shrink-0">Core {i}</span>
                    <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${getBarColor(load)}`}
                        style={{ width: `${load}%` }}
                      />
                    </div>
                    <span className={`text-xs w-10 text-right font-mono ${getStatusColor(load)}`}>
                      {load.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>

              {/* Sparkline */}
              <div className="w-full mt-5">
                <p className="text-xs text-muted-foreground mb-1">History</p>
                <Sparkline data={cpuH} color={stats.cpu.usage < 50 ? '#10b981' : stats.cpu.usage < 75 ? '#f59e0b' : '#ef4444'} height={50} />
              </div>
            </CardContent>
          </Card>

          {/* Memory */}
          <Card className="fade-in-up" style={{ animationDelay: '0.2s' }}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm uppercase tracking-wider">Memory</CardTitle>
                <Badge variant="outline">{formatBytes(stats.memory.total)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center pt-2">
              <CircularProgress value={stats.memory.percent} label="RAM" sub={formatBytes(stats.memory.used)} />

              {/* Bars */}
              <div className="w-full mt-5 space-y-3">
                <DiskBar label="RAM" value={stats.memory.used} max={stats.memory.total} />
                {stats.memory.swapTotal > 0 && (
                  <DiskBar label="Swap" value={stats.memory.swapUsed} max={stats.memory.swapTotal} />
                )}
              </div>

              {/* Stats grid */}
              <div className="w-full mt-4 grid grid-cols-3 gap-2">
                {[
                  { label: 'Used', val: formatBytes(stats.memory.used), cls: 'text-white' },
                  { label: 'Free', val: formatBytes(stats.memory.available), cls: 'text-emerald-400' },
                  { label: 'Total', val: formatBytes(stats.memory.total), cls: 'text-muted-foreground' },
                ].map((s, i) => (
                  <div key={i} className="bg-muted/50 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">{s.label}</p>
                    <p className={`text-sm font-semibold ${s.cls}`}>{s.val}</p>
                  </div>
                ))}
              </div>

              {/* Sparkline */}
              <div className="w-full mt-4">
                <p className="text-xs text-muted-foreground mb-1">History</p>
                <Sparkline data={memH} color={stats.memory.percent < 50 ? '#10b981' : stats.memory.percent < 75 ? '#f59e0b' : '#ef4444'} height={50} />
              </div>
            </CardContent>
          </Card>

          {/* Network */}
          <Card className="fade-in-up" style={{ animationDelay: '0.3s' }}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm uppercase tracking-wider">Network</CardTitle>
                <Badge variant="outline">{stats.network.interface}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-xl p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1 inline-flex items-center justify-center gap-1"><ArrowDown className="h-3 w-3" aria-hidden="true" /> Download</p>
                  <p className="text-xl font-bold text-emerald-400">{history.length > 0 ? formatBytesPerSec(history[history.length-1].netIn) : '0 B/s'}</p>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1 inline-flex items-center justify-center gap-1"><ArrowUp className="h-3 w-3" aria-hidden="true" /> Upload</p>
                  <p className="text-xl font-bold text-white">{history.length > 0 ? formatBytesPerSec(history[history.length-1].netOut) : '0 B/s'}</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1"><ArrowDown className="h-3 w-3" aria-hidden="true" /> Download History</p>
                <Sparkline data={netInH} color="#10b981" height={50} />
              </div>
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1"><ArrowUp className="h-3 w-3" aria-hidden="true" /> Upload History</p>
                <Sparkline data={netOutH} color="#ffffff" height={50} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Disk + Processes ────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Disk */}
          <Card className="fade-in-up" style={{ animationDelay: '0.4s' }}>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2"><HardDrive className="h-4 w-4" aria-hidden="true" /> Disk Usage</CardTitle>
              <CardDescription>Filesystem storage allocation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats.disks.map((d, i) => (
                <div key={i} className="space-y-2">
                  <DiskBar label={`${d.mount} (${d.device})`} value={d.used} max={d.total} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Available: {formatBytes(d.free)}</span>
                    <span className={getStatusColor(d.percent)}>{d.percent}% used</span>
                  </div>
                </div>
              ))}
              {stats.diskIO && (
                <div className="pt-3 mt-2 border-t border-border grid grid-cols-2 gap-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Read (total)</p>
                    <p className="text-sm font-semibold text-white">{formatBytes(stats.diskIO.readBytes)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Write (total)</p>
                    <p className="text-sm font-semibold text-emerald-400">{formatBytes(stats.diskIO.writeBytes)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Processes */}
          <Card className="fade-in-up" style={{ animationDelay: '0.5s' }}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2"><Flame className="h-4 w-4" aria-hidden="true" /> Top Processes</CardTitle>
                  <CardDescription>By CPU usage</CardDescription>
                </div>
                <Badge variant="secondary">{stats.topProcesses.length} shown</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Process</TableHead>
                    <TableHead className="w-16">PID</TableHead>
                    <TableHead className="w-20 text-right">CPU</TableHead>
                    <TableHead className="w-20 text-right">MEM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.topProcesses.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">
                        <div>{p.name}</div>
                        {p.service && (
                          <div className="mt-1 inline-flex max-w-[180px] truncate rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground" title={p.service}>
                            {p.service}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{p.pid}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${getStatusColor(p.cpu)}`}>
                        {p.cpu}%
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${getStatusColor(p.mem)}`}>
                        {p.mem}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* ── Footer ─────────────────────────────────── */}
        <p className="text-center text-xs text-muted-foreground/50 pt-4 pb-2">
          VPS Monitor Dashboard | Auto-refresh 2s | {stats.system.hostname}
        </p>
      </div>
    </div>
  );
}
