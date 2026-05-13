'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp, Clock3, Cpu, Flame, Gauge, HardDrive, Monitor, ServerCog, Thermometer, Timer, Database, LogIn, LogOut, Skull, X, KeyRound, RotateCw, Container, ImageIcon, Play, Square, Trash2, Trash, Scissors } from 'lucide-react';
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
interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: number;
  memLimit: string;
}

interface ImageInfo {
  id: string;
  repoTags: string[];
  size: number;
  created: number;
  containers: number;
}

interface Stats {
  cpu: { usage: number; cores: number; perCore: number[] };
  memory: { total: number; used: number; available: number; percent: number; swapTotal: number; swapUsed: number; swapPercent: number };
  disks: { device: string; mount: string; total: number; used: number; free: number; percent: number }[];
  diskIO: { readBytes: number; writeBytes: number };
  network: { interface: string; rxBytes: number; txBytes: number };
  system: { hostname: string; os: string; arch: string; kernel: string; uptime: number };
  topProcesses: { name: string; service?: string; pid: number; cpu: number; mem: number; memBytes: number }[];
  topMemory: { name: string; service?: string; pid: number; cpu: number; mem: number; memBytes: number }[];
  containers: ContainerInfo[];
  images: ImageInfo[];
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

function containerStateColor(state: string): string {
  switch (state) {
    case 'running': return 'text-emerald-400';
    case 'exited': case 'stopped': return 'text-red-400';
    case 'paused': return 'text-amber-400';
    default: return 'text-muted-foreground';
  }
}

function containerStateBg(state: string): string {
  switch (state) {
    case 'running': return 'bg-emerald-500/10 text-emerald-400';
    case 'exited': case 'stopped': return 'bg-red-500/10 text-red-400';
    case 'paused': return 'bg-amber-500/10 text-amber-400';
    default: return 'bg-muted text-muted-foreground';
  }
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

// ── Action Button ──────────────────────────────────────
function ActionBtn({ onClick, disabled, title, icon: Icon, variant }: {
  onClick: () => void; disabled?: boolean; title: string;
  icon: React.ComponentType<{ className?: string }>;
  variant: 'start' | 'stop' | 'restart' | 'remove' | 'prune';
}) {
  const styles: Record<string, string> = {
    start: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
    stop: 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
    restart: 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20',
    remove: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
    prune: 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center size-7 rounded-md transition-colors disabled:opacity-50 ${styles[variant]}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
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
  const [authed, setAuthed] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginPwd, setLoginPwd] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('netra_saved_pwd') || '';
    }
    return '';
  });
  const [loginErr, setLoginErr] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [killLoading, setKillLoading] = useState<number | null>(null);
  const [restartLoading, setRestartLoading] = useState<number | null>(null);
  const [containerLoading, setContainerLoading] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState<string | null>(null);
  const [pruneLoading, setPruneLoading] = useState(false);

  const prevNetRef = useRef<{ rx: number; tx: number; ts: number } | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const data: Stats = await res.json();

      if (!data?.memory || !data?.cpu || !data?.network || !data?.system) return;

      setStats(data);
      setAuthed(data.authenticated);
      setLastUpdate(new Date());

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

  // ── Auth actions ─────────────────────────────────────
  const handleLogin = useCallback(async () => {
    setLoginLoading(true);
    setLoginErr('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPwd }),
      });
      const data = await res.json();
      if (data.ok) {
        setAuthed(true);
        setShowLogin(false);
        localStorage.setItem('netra_saved_pwd', loginPwd);
        setLoginPwd('');
        fetchStats();
      } else {
        setLoginErr(data.error || 'Login failed');
      }
    } catch {
      setLoginErr('Network error');
    } finally {
      setLoginLoading(false);
    }
  }, [loginPwd, fetchStats]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/logout', { method: 'POST' });
    setAuthed(false);
    fetchStats();
  }, [fetchStats]);

  const handleKill = useCallback(async (pid: number) => {
    if (!confirm(`Kill process PID ${pid}?`)) return;
    setKillLoading(pid);
    try {
      const res = await fetch(`/api/kill/${pid}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) alert(data.error || 'Failed to kill');
      fetchStats();
    } catch { alert('Network error'); }
    finally { setKillLoading(null); }
  }, [fetchStats]);

  const handleContainerAction = useCallback(async (id: string, action: string) => {
    if (!authed) {
      setShowLogin(true);
      setLoginErr('');
      setLoginPwd('');
      return;
    }
    const msgs: Record<string, string> = {
      start: `Start container ${id}?`,
      stop: `Stop container ${id}?`,
      restart: `Restart container ${id}?`,
      remove: `Remove container ${id}? This cannot be undone.`,
    };
    if (!confirm(msgs[action])) return;
    setContainerLoading(`${action}-${id}`);
    try {
      const res = await fetch(`/api/container/${action}/${id}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) alert(data.error || `Failed to ${action}`);
      fetchStats();
    } catch { alert('Network error'); }
    finally { setContainerLoading(null); }
  }, [fetchStats]);

  const handleRemoveImage = useCallback(async (id: string) => {
    if (!confirm(`Remove image ${id}? This cannot be undone.`)) return;
    setImageLoading(id);
    try {
      const res = await fetch(`/api/image/remove/${id}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) alert(data.error || 'Failed to remove image');
      fetchStats();
    } catch { alert('Network error'); }
    finally { setImageLoading(null); }
  }, [fetchStats]);

  const handlePruneImages = useCallback(async () => {
    if (!confirm('Prune all unused images? This cannot be undone.')) return;
    setPruneLoading(true);
    try {
      const res = await fetch('/api/image/prune', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) alert(data.error || 'Failed to prune');
      else alert(`Pruned ${data.removed} unused image(s)`);
      fetchStats();
    } catch { alert('Network error'); }
    finally { setPruneLoading(false); }
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

  const runningContainers = stats.containers?.filter(c => c.state === 'running').length ?? 0;

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
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="gap-1.5 text-xs">
              <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Live
            </Badge>
            <span className="text-xs text-muted-foreground hidden sm:block">
              {lastUpdate.toLocaleTimeString('th-TH', { hour12: false })}
            </span>
            {stats.authEnabled && (
              authed ? (
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-white/10 hover:text-white transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" /> Logout
                </button>
              ) : (
                <button
                  onClick={() => { setShowLogin(true); setLoginErr(''); setLoginPwd(''); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
                >
                  <KeyRound className="h-3.5 w-3.5" /> Admin Login
                </button>
              )
            )}
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
            { Icon: Container, label: 'Containers', value: `${runningContainers}/${stats.containers?.length ?? 0}`, sub: 'podman', bg: 'from-white/5 to-white/[0.02]', ring: 'ring-white/10' },
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
              <div className="w-full mt-5 space-y-2">
                {stats.cpu.perCore.map((load, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-12 shrink-0">Core {i}</span>
                    <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${getBarColor(load)}`} style={{ width: `${load}%` }} />
                    </div>
                    <span className={`text-xs w-10 text-right font-mono ${getStatusColor(load)}`}>
                      {load.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
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
              <div className="w-full mt-5 space-y-3">
                <DiskBar label="RAM" value={stats.memory.used} max={stats.memory.total} />
                {stats.memory.swapTotal > 0 && (
                  <DiskBar label="Swap" value={stats.memory.swapUsed} max={stats.memory.swapTotal} />
                )}
              </div>
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
              {/* Top Memory Consumers */}
              <div className="w-full mt-5">
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Top Memory Usage</p>
                <div className="space-y-2">
                  {stats.topMemory?.map((p, i) => {
                    const pctOfTotal = stats.memory.total > 0 ? (p.memBytes / stats.memory.total) * 100 : 0;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground truncate max-w-[60%]" title={p.service ? `${p.name} (${p.service})` : p.name}>
                            {p.service || p.name}
                          </span>
                          <span className="text-white font-mono">{formatBytes(p.memBytes)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-700 ${getBarColor(pctOfTotal * 3)}`} style={{ width: `${Math.min(pctOfTotal * 3, 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
                    <TableHead>Service</TableHead>
                    <TableHead className="w-16">PID</TableHead>
                    <TableHead className="w-20 text-right">CPU</TableHead>
                    <TableHead className="w-20 text-right">MEM</TableHead>
                    {authed && <TableHead className="w-20 text-center">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.topProcesses.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{p.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.service ? (
                          <span className="inline-flex max-w-[180px] truncate rounded bg-white/10 px-1.5 py-0.5 text-[10px]" title={p.service}>
                            {p.service}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{p.pid}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${getStatusColor(p.cpu)}`}>
                        {p.cpu}%
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${getStatusColor(p.mem)}`}>
                        {p.mem}%
                      </TableCell>
                      {authed && (
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleKill(p.pid)}
                              disabled={killLoading === p.pid}
                              className="inline-flex items-center justify-center size-6 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                              title={`Kill PID ${p.pid}`}
                            >
                              {killLoading === p.pid ? (
                                <span className="inline-block w-3 h-3 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Skull className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* ── Podman Containers ─────────────────────────── */}
        <Card className="fade-in-up" style={{ animationDelay: '0.6s' }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2">
                  <Container className="h-4 w-4" aria-hidden="true" /> Podman Containers
                </CardTitle>
                <CardDescription>Container status and management</CardDescription>
              </div>
              <Badge variant="secondary">{runningContainers} running / {stats.containers?.length ?? 0} total</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {(!stats.containers || stats.containers.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-8">No containers found. Podman may not be installed or running.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Image</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Ports</TableHead>
                      <TableHead>Memory</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.containers.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs font-medium">{c.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.image}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${containerStateBg(c.state)}`}>
                            {c.state}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.status}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{c.ports || '—'}</TableCell>
                        <TableCell className="text-xs font-mono">{c.memLimit || '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            {c.state !== 'running' && (
                              <ActionBtn
                                icon={Play}
                                variant="start"
                                title="Start"
                                disabled={containerLoading === `start-${c.id}`}
                                onClick={() => handleContainerAction(c.id, 'start')}
                              />
                            )}
                            {c.state === 'running' && (
                              <ActionBtn
                                icon={Square}
                                variant="stop"
                                title="Stop"
                                disabled={containerLoading === `stop-${c.id}`}
                                onClick={() => handleContainerAction(c.id, 'stop')}
                              />
                            )}
                            {c.state === 'running' && (
                              <ActionBtn
                                icon={RotateCw}
                                variant="restart"
                                title="Restart"
                                disabled={containerLoading === `restart-${c.id}`}
                                onClick={() => handleContainerAction(c.id, 'restart')}
                              />
                            )}
                            {c.state !== 'running' && authed && (
                              <ActionBtn
                                icon={Trash2}
                                variant="remove"
                                title="Remove (must stop first)"
                                disabled={containerLoading === `remove-${c.id}`}
                                onClick={() => handleContainerAction(c.id, 'remove')}
                              />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Podman Images ─────────────────────────────── */}
        <Card className="fade-in-up" style={{ animationDelay: '0.7s' }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" aria-hidden="true" /> Podman Images
                </CardTitle>
                <CardDescription>Container images and disk usage</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{stats.images?.length ?? 0} images</Badge>
                {authed && (
                  <button
                    onClick={handlePruneImages}
                    disabled={pruneLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                  >
                    {pruneLoading ? (
                      <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Scissors className="h-3.5 w-3.5" />
                    )}
                    Prune Unused
                  </button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(!stats.images || stats.images.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-8">No images found.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tags</TableHead>
                      <TableHead>Image ID</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Containers</TableHead>
                      {authed && <TableHead className="text-center">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.images.map((img, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">
                          {img.repoTags.map((tag, ti) => (
                            <span key={ti} className="inline-flex rounded bg-white/10 px-1.5 py-0.5 text-[10px] mr-1 mb-0.5">
                              {tag}
                            </span>
                          ))}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{img.id}</TableCell>
                        <TableCell className="text-xs font-mono">{formatBytes(img.size)}</TableCell>
                        <TableCell className="text-xs text-center">
                          <Badge variant={img.containers > 0 ? 'default' : 'secondary'} className="text-[10px]">
                            {img.containers}
                          </Badge>
                        </TableCell>
                        {authed && (
                          <TableCell className="text-center">
                            <ActionBtn
                              icon={Trash}
                              variant="remove"
                              title="Remove image"
                              disabled={imageLoading === img.id}
                              onClick={() => handleRemoveImage(img.id)}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Login Modal ───────────────────────────── */}
        {showLogin && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-sm mx-4 rounded-xl border border-white/10 bg-card p-6 shadow-2xl">
              <button
                onClick={() => setShowLogin(false)}
                className="absolute top-3 right-3 text-muted-foreground hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-3 mb-5">
                <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Admin Login</h2>
                  <p className="text-xs text-muted-foreground">Enter password to unlock management</p>
                </div>
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); handleLogin(); }}
                className="space-y-3"
              >
                <input
                  type="password"
                  value={loginPwd}
                  onChange={(e) => setLoginPwd(e.target.value)}
                  placeholder="Password"
                  autoFocus
                  className="w-full rounded-lg border border-white/10 bg-muted/50 px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground/60">
                    Default: <span className="font-mono text-muted-foreground">123456</span> &middot; Change via <span className="font-mono">AUTH_PASSWORD</span> in <span className="font-mono">.env</span>
                  </p>
                  <label className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      defaultChecked={!!localStorage.getItem('netra_saved_pwd')}
                      onChange={(e) => {
                        if (!e.target.checked) localStorage.removeItem('netra_saved_pwd');
                      }}
                      className="rounded border-white/20 bg-muted"
                    />
                    Remember
                  </label>
                </div>
                {loginErr && (
                  <p className="text-xs text-destructive">{loginErr}</p>
                )}
                <button
                  type="submit"
                  disabled={loginLoading || !loginPwd}
                  className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors disabled:opacity-50"
                >
                  {loginLoading ? 'Verifying...' : 'Login'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────── */}
        <p className="text-center text-xs text-muted-foreground/50 pt-4 pb-2">
          VPS Monitor Dashboard | Auto-refresh 2s | {stats.system.hostname}
        </p>
      </div>
    </div>
  );
}
