'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp, Clock3, Cpu, Flame, Gauge, HardDrive, Monitor, ServerCog, Thermometer, Timer, Database, LogIn, LogOut, Skull, X, KeyRound, RotateCw, Container, ImageIcon, Play, Square, Trash2, Trash, Scissors, Sun, Moon, FileText, Activity, Wrench, Download, Folder, Terminal as TerminalIcon, Globe, Search, RefreshCw, ChevronRight, File } from 'lucide-react';
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
  created: string;
  memLimit: string;
  cpu: number;
  memUsage: string;
  memPct: number;
  netIO: string;
  blockIO: string;
  pids: number;
  uptime: string;
}

interface ImageInfo {
  id: string;
  repoTags: string[];
  size: number;
  created: number;
  containers: number;
}

interface ServiceInfo {
  name: string;
  description: string;
  active: string;
  sub: string;
  enabled: boolean;
  uptime: string;
  pid: number;
  memBytes: number;
  cpuPct: number;
}

interface SSLCertInfo {
  domain: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  daysLeft: number;
  expired: boolean;
  error: string;
}

interface ComposeStack {
  name: string;
  file: string;
  status: string;
  services: number;
  running: number;
}

interface CronJob {
  line: string;
  user: string;
}

interface UptimeCheck {
  url: string;
  online: boolean;
  statusCode: number;
  responseMs: number;
  error: string;
  lastChecked: string;
}

interface NetToolResult {
  tool: string;
  target: string;
  output: string;
  error: string;
}

interface FileEntry {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  modTime: string;
  mode: string;
}

interface Stats {
  cpu: { usage: number; cores: number; perCore: number[] };
  memory: { total: number; used: number; available: number; percent: number; swapTotal: number; swapUsed: number; swapPercent: number };
  disks: { device: string; mount: string; total: number; used: number; free: number; percent: number }[];
  diskIO: { readBytes: number; writeBytes: number };
  network: {
    interface: string;
    rxBytes: number;
    txBytes: number;
    interfaces: { name: string; rxBytes: number; txBytes: number; up: boolean }[];
    publicIP: string;
    connCount: number;
  };
  system: { hostname: string; os: string; arch: string; kernel: string; uptime: number };
  topProcesses: { name: string; service?: string; pid: number; cpu: number; mem: number; memBytes: number }[];
  topMemory: { name: string; service?: string; pid: number; cpu: number; mem: number; memBytes: number }[];
  containers: ContainerInfo[];
  images: ImageInfo[];
  services: ServiceInfo[];
  sslCerts: SSLCertInfo[];
  stacks: ComposeStack[];
  cronJobs: CronJob[];
  uptimeChecks: UptimeCheck[];
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
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('netra_theme') !== 'light';
    }
    return true;
  });
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [logsData, setLogsData] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [serviceLoading, setServiceLoading] = useState<string | null>(null);
  const [stackLoading, setStackLoading] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState<string | null>(null);
  const [netToolResult, setNetToolResult] = useState<NetToolResult | null>(null);
  const [netToolLoading, setNetToolLoading] = useState(false);
  const [netToolTarget, setNetToolTarget] = useState('');
  const [netToolType, setNetToolType] = useState('ping');
  const [fileBrowserPath, setFileBrowserPath] = useState('/var/log');
  const [fileBrowserFiles, setFileBrowserFiles] = useState<FileEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileContentName, setFileContentName] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

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

  const handleFetchLogs = useCallback(async (id: string) => {
    setShowLogs(id);
    setLogsLoading(true);
    setLogsData([]);
    try {
      const res = await fetch(`/api/container/logs/${id}?tail=200`);
      const data = await res.json();
      if (data.ok) {
        setLogsData(data.logs.map((l: { line: string }) => l.line));
      }
    } catch { /* ignore */ }
    finally { setLogsLoading(false); }
  }, []);

  const handleServiceAction = useCallback(async (name: string, action: string) => {
    if (!authed) {
      setShowLogin(true);
      setLoginErr('');
      setLoginPwd('');
      return;
    }
    if (!confirm(`${action} service ${name}?`)) return;
    setServiceLoading(`${action}-${name}`);
    try {
      const res = await fetch(`/api/service/${action}/${name}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) alert(data.error || `Failed to ${action}`);
      fetchStats();
    } catch { alert('Network error'); }
    finally { setServiceLoading(null); }
  }, [authed, fetchStats, setShowLogin, setLoginErr, setLoginPwd]);

  // Theme toggle
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('netra_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const handleStackAction = useCallback(async (name: string, action: string) => {
    if (!authed) {
      setShowLogin(true);
      setLoginErr('');
      setLoginPwd('');
      return;
    }
    if (!confirm(`${action === 'up' ? 'Start' : action === 'down' ? 'Stop' : 'Restart'} stack ${name}?`)) return;
    setStackLoading(`${action}-${name}`);
    try {
      const res = await fetch(`/api/compose/${action}/${name}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) alert(data.error || `Failed to ${action}`);
      fetchStats();
    } catch { alert('Network error'); }
    finally { setStackLoading(null); }
  }, [authed, fetchStats, setShowLogin, setLoginErr, setLoginPwd]);

  const handleOpenTerminal = useCallback(async (id: string) => {
    if (!authed) {
      setShowLogin(true);
      setLoginErr('');
      setLoginPwd('');
      return;
    }
    setShowTerminal(id);
  }, [authed, setShowLogin, setLoginErr, setLoginPwd]);

  const handleCloseTerminal = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setShowTerminal(null);
  }, []);

  const handleNetTool = useCallback(async () => {
    if (!netToolTarget) return;
    setNetToolLoading(true);
    setNetToolResult(null);
    try {
      const res = await fetch('/api/nettool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: netToolType, target: netToolTarget }),
      });
      const data = await res.json();
      setNetToolResult(data);
    } catch { setNetToolResult({ tool: netToolType, target: netToolTarget, output: '', error: 'Network error' }); }
    finally { setNetToolLoading(false); }
  }, [netToolType, netToolTarget]);

  const handleBrowse = useCallback(async (path: string) => {
    setFileLoading(true);
    setFileContent(null);
    try {
      const res = await fetch(`/api/files/browse?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.ok) {
        setFileBrowserFiles(data.files || []);
        setFileBrowserPath(data.path || path);
      }
    } catch { /* ignore */ }
    finally { setFileLoading(false); }
  }, []);

  const handleReadFile = useCallback(async (path: string, name: string) => {
    setFileLoading(true);
    setFileContentName(name);
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.ok) setFileContent(data.content);
      else setFileContent(data.error || 'Failed to read');
    } catch { setFileContent('Network error'); }
    finally { setFileLoading(false); }
  }, []);

  const handleExport = useCallback(() => {
    window.open('/api/export?format=json', '_blank');
  }, []);

  // Connect terminal WebSocket
  useEffect(() => {
    if (!showTerminal || !termRef.current) return;
    let term: any;
    let fitAddon: any;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      await import('@xterm/xterm/css/xterm.css');

      term = new Terminal({
        theme: {
          background: '#0d0d0d',
          foreground: '#e0e0e0',
          cursor: '#ffffff',
        },
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        cursorBlink: true,
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termRef.current!);
      fitAddon.fit();

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/api/container/terminal/${showTerminal}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        term.write(e.data);
      };
      ws.onclose = () => {
        term.write('\r\n[Connection closed]\r\n');
      };
      ws.onerror = () => {
        term.write('\r\n[Connection error]\r\n');
      };

      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      const onResize = () => fitAddon.fit();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    })();

    return () => {
      term?.dispose();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [showTerminal]);

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
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="inline-flex items-center justify-center size-7 rounded-lg border border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white transition-colors"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            {authed && (
              <button
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-white/10 hover:text-white transition-colors"
                title="Export stats"
              >
                <Download className="h-3.5 w-3.5" /> Export
              </button>
            )}
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
                <div className="flex items-center gap-2">
                  {stats.network.publicIP && (
                    <Badge variant="outline" className="font-mono text-[10px]">{stats.network.publicIP}</Badge>
                  )}
                  <Badge variant="outline">{stats.network.interface}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-xl p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1 inline-flex items-center justify-center gap-1"><ArrowDown className="h-3 w-3" aria-hidden="true" /> Download</p>
                  <p className="text-xl font-bold text-emerald-400">{history.length > 0 ? formatBytesPerSec(history[history.length-1].netIn) : '0 B/s'}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Total: {formatBytes(stats.network.rxBytes)}</p>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1 inline-flex items-center justify-center gap-1"><ArrowUp className="h-3 w-3" aria-hidden="true" /> Upload</p>
                  <p className="text-xl font-bold text-white">{history.length > 0 ? formatBytesPerSec(history[history.length-1].netOut) : '0 B/s'}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Total: {formatBytes(stats.network.txBytes)}</p>
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
              {/* Extra info */}
              <div className="mt-4 pt-3 border-t border-border grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground">Connections</p>
                  <p className="text-sm font-semibold">{stats.network.connCount}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Interfaces</p>
                  <p className="text-sm font-semibold">{stats.network.interfaces?.length ?? 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Total I/O</p>
                  <p className="text-sm font-semibold">{formatBytes(stats.network.rxBytes + stats.network.txBytes)}</p>
                </div>
              </div>
              {/* Interface list */}
              {stats.network.interfaces && stats.network.interfaces.length > 1 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">All Interfaces</p>
                  <div className="space-y-1.5">
                    {stats.network.interfaces.map((iface, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`size-1.5 rounded-full ${iface.name === stats.network.interface ? 'bg-emerald-400' : 'bg-muted-foreground/50'}`} />
                          <span className="font-mono">{iface.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span>↓{formatBytes(iface.rxBytes)}</span>
                          <span>↑{formatBytes(iface.txBytes)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                      <TableHead>CPU</TableHead>
                      <TableHead>MEM</TableHead>
                      <TableHead>Net I/O</TableHead>
                      <TableHead>Ports</TableHead>
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
                        <TableCell className={`text-xs font-mono ${c.cpu > 50 ? 'text-amber-400' : 'text-muted-foreground'}`}>{c.state === 'running' ? `${c.cpu}%` : '—'}</TableCell>
                        <TableCell className="text-xs font-mono">{c.state === 'running' ? (c.memUsage || '—') : '—'}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{c.state === 'running' ? (c.netIO || '—') : '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{c.ports || '—'}</TableCell>
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
                            <ActionBtn
                              icon={FileText}
                              variant="restart"
                              title="View logs"
                              disabled={logsLoading && showLogs === c.id}
                              onClick={() => handleFetchLogs(c.id)}
                            />
                            {c.state === 'running' && (
                              <ActionBtn
                                icon={Activity}
                                variant="start"
                                title="Terminal"
                                onClick={() => handleOpenTerminal(c.id)}
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

        {/* ── Systemd Services ────────────────────────── */}
        {stats.services && stats.services.length > 0 && (
        <Card className="fade-in-up" style={{ animationDelay: '0.8s' }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2">
                  <Wrench className="h-4 w-4" aria-hidden="true" /> Systemd Services
                </CardTitle>
                <CardDescription>Service status and management</CardDescription>
              </div>
              <Badge variant="secondary">{stats.services?.length ?? 0} services</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {(!stats.services || stats.services.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-8">No services found. Only available on Linux with systemd.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.services.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs font-medium">{s.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]" title={s.description}>{s.description}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${s.active === 'active' ? 'bg-emerald-500/10 text-emerald-400' : s.active === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-muted text-muted-foreground'}`}>
                            {s.active} ({s.sub})
                          </span>
                        </TableCell>
                        <TableCell>
                          {s.enabled ? (
                            <span className="text-xs text-emerald-400">Enabled</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Disabled</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <ActionBtn icon={RotateCw} variant="restart" title="Restart" disabled={serviceLoading === `restart-${s.name}`} onClick={() => handleServiceAction(s.name, 'restart')} />
                            {s.active === 'active' ? (
                              <ActionBtn icon={Square} variant="stop" title="Stop" disabled={serviceLoading === `stop-${s.name}`} onClick={() => handleServiceAction(s.name, 'stop')} />
                            ) : (
                              <ActionBtn icon={Play} variant="start" title="Start" disabled={serviceLoading === `start-${s.name}`} onClick={() => handleServiceAction(s.name, 'start')} />
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
        )}

        {/* ── Logs Modal ──────────────────────────────── */}
        {showLogs && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-3xl mx-4 rounded-xl border border-white/10 bg-card p-6 shadow-2xl max-h-[80vh] flex flex-col">
              <button
                onClick={() => setShowLogs(null)}
                className="absolute top-3 right-3 text-muted-foreground hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center size-9 rounded-lg bg-blue-500/10 text-blue-400">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Container Logs</h2>
                  <p className="text-xs text-muted-foreground">{showLogs}</p>
                </div>
              </div>
              <div className="flex-1 overflow-auto rounded-lg bg-black/50 p-3 font-mono text-xs leading-relaxed min-h-[300px]">
                {logsLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <span className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : logsData.length === 0 ? (
                  <p className="text-muted-foreground text-center">No logs available.</p>
                ) : (
                  logsData.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all hover:bg-white/5 px-1 rounded">{line}</div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SSL Certificates ─────────────────────────── */}
        {stats.sslCerts && stats.sslCerts.length > 0 && (
        <Card className="fade-in-up" style={{ animationDelay: '0.9s' }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2">
                  <Gauge className="h-4 w-4" aria-hidden="true" /> SSL Certificates
                </CardTitle>
                <CardDescription>Certificate expiry monitoring</CardDescription>
              </div>
              <Badge variant="secondary">{stats.sslCerts?.length ?? 0} domains</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {(!stats.sslCerts || stats.sslCerts.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-8">No SSL domains configured. Set <span className="font-mono text-xs">SSL_DOMAINS=example.com,api.example.com</span> in .env</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Issuer</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Days Left</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.sslCerts.map((cert, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs font-medium">{cert.domain}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{cert.issuer || '\u2014'}</TableCell>
                      <TableCell className="text-xs font-mono">{cert.notAfter || '\u2014'}</TableCell>
                      <TableCell className={`text-xs font-mono font-bold ${cert.expired ? 'text-red-400' : cert.daysLeft <= 30 ? 'text-amber-400' : cert.daysLeft <= 7 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {cert.error ? '\u2014' : cert.daysLeft}
                      </TableCell>
                      <TableCell>
                        {cert.error ? (
                          <span className="inline-flex rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-red-400">Error</span>
                        ) : cert.expired ? (
                          <span className="inline-flex rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-red-400">Expired</span>
                        ) : cert.daysLeft <= 30 ? (
                          <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-400">Expiring</span>
                        ) : (
                          <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-400">Valid</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        )}

        {/* ── Compose Stacks ──────────────────────────────── */}
        {stats.stacks && stats.stacks.length > 0 && (
        <Card className="fade-in-up" style={{ animationDelay: '1.0s' }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2">
                  <Database className="h-4 w-4" aria-hidden="true" /> Compose Stacks
                </CardTitle>
                <CardDescription>Podman Compose / Docker Compose management</CardDescription>
              </div>
              <Badge variant="secondary">{stats.stacks?.length ?? 0} stacks</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {(!stats.stacks || stats.stacks.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-8">No compose stacks found. Set <span className="font-mono text-xs">COMPOSE_DIR=/opt/stacks</span> in .env or place compose files in /opt/stacks</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stack</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Services</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.stacks.map((stack, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs font-medium">{stack.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[250px]" title={stack.file}>{stack.file}</TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${stack.running === stack.services && stack.services > 0 ? 'bg-emerald-500/10 text-emerald-400' : stack.running > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
                          {stack.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{stack.running}/{stack.services}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <ActionBtn icon={Play} variant="start" title="Up (start)" disabled={stackLoading === `up-${stack.name}`} onClick={() => handleStackAction(stack.name, 'up')} />
                          <ActionBtn icon={RotateCw} variant="restart" title="Restart" disabled={stackLoading === `restart-${stack.name}`} onClick={() => handleStackAction(stack.name, 'restart')} />
                          <ActionBtn icon={Square} variant="stop" title="Down (stop)" disabled={stackLoading === `down-${stack.name}`} onClick={() => handleStackAction(stack.name, 'down')} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        )}

        {/* ── Cron Jobs ───────────────────────────────── */}
        {stats.cronJobs && stats.cronJobs.length > 0 && (
        <Card className="fade-in-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2"><Clock3 className="h-4 w-4" aria-hidden="true" /> Cron Jobs</CardTitle>
                <CardDescription>Scheduled tasks</CardDescription>
              </div>
              <Badge variant="secondary">{stats.cronJobs.length} jobs</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {stats.cronJobs.map((job, i) => (
                <div key={i} className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs break-all">{job.line}</div>
              ))}
            </div>
          </CardContent>
        </Card>
        )}

        {/* ── Uptime Monitor ───────────────────────────── */}
        {stats.uptimeChecks && stats.uptimeChecks.length > 0 && (
        <Card className="fade-in-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2"><Globe className="h-4 w-4" aria-hidden="true" /> Uptime Monitor</CardTitle>
                <CardDescription>URL health checks</CardDescription>
              </div>
              <Badge variant="secondary">{stats.uptimeChecks.length} URLs</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.uptimeChecks.map((u, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{u.url}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${u.online ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {u.online ? 'Online' : 'Offline'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{u.error ? '—' : `${u.responseMs.toFixed(0)}ms`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.lastChecked ? new Date(u.lastChecked).toLocaleTimeString('th-TH', { hour12: false }) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        )}

        {/* ── Network Tools ────────────────────────────── */}
        <Card className="fade-in-up">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2"><Search className="h-4 w-4" aria-hidden="true" /> Network Tools</CardTitle>
            <CardDescription>Ping, DNS lookup, traceroute</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <select
                value={netToolType}
                onChange={(e) => setNetToolType(e.target.value)}
                className="rounded-lg border border-white/10 bg-muted/50 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="ping">Ping</option>
                <option value="dns">DNS Lookup</option>
                <option value="traceroute">Traceroute</option>
                <option value="port">Port Check</option>
              </select>
              <input
                value={netToolTarget}
                onChange={(e) => setNetToolTarget(e.target.value)}
                placeholder={netToolType === 'port' ? 'host:port' : 'hostname or IP'}
                className="flex-1 rounded-lg border border-white/10 bg-muted/50 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={handleNetTool}
                disabled={netToolLoading || !netToolTarget}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
              >
                {netToolLoading ? 'Running...' : 'Run'}
              </button>
            </div>
            {netToolResult && (
              <pre className="rounded-lg bg-black/50 p-4 text-xs font-mono overflow-auto max-h-[300px] whitespace-pre-wrap">{netToolResult.error ? `Error: ${netToolResult.error}` : netToolResult.output}</pre>
            )}
          </CardContent>
        </Card>

        {/* ── File Browser ─────────────────────────────── */}
        <Card className="fade-in-up">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider inline-flex items-center gap-2"><Folder className="h-4 w-4" aria-hidden="true" /> File Browser</CardTitle>
            <CardDescription>Browse server files (logs, configs)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <input
                value={fileBrowserPath}
                onChange={(e) => setFileBrowserPath(e.target.value)}
                placeholder="/var/log"
                className="flex-1 rounded-lg border border-white/10 bg-muted/50 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={() => handleBrowse(fileBrowserPath)}
                disabled={fileLoading}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
              >
                {fileLoading ? '...' : 'Browse'}
              </button>
            </div>
            {fileContent !== null ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-muted-foreground">{fileContentName}</span>
                  <button onClick={() => setFileContent(null)} className="text-xs text-muted-foreground hover:text-white"><X className="h-3.5 w-3.5" /></button>
                </div>
                <pre className="rounded-lg bg-black/50 p-3 text-xs font-mono overflow-auto max-h-[400px] whitespace-pre-wrap">{fileContent}</pre>
              </div>
            ) : fileBrowserFiles.length > 0 ? (
              <div className="rounded-lg border border-white/10 divide-y divide-white/5">
                {fileBrowserFiles.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)).map((f, i) => (
                  <button
                    key={i}
                    onClick={() => f.isDir ? handleBrowse(f.path) : handleReadFile(f.path, f.name)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-white/5 transition-colors text-left"
                  >
                    {f.isDir ? <Folder className="h-4 w-4 text-amber-400 shrink-0" /> : <File className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-muted-foreground shrink-0">{f.isDir ? '\u2014' : formatBytes(f.size)}</span>
                    <span className="text-muted-foreground/60 shrink-0 hidden sm:block">{f.modTime}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* ── Terminal Modal ────────────────────────────── */}
        {showTerminal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-4xl mx-4 rounded-xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <Activity className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Container Terminal</h2>
                    <p className="text-xs text-muted-foreground">{showTerminal}</p>
                  </div>
                </div>
                <button
                  onClick={handleCloseTerminal}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  <X className="h-3.5 w-3.5" /> Disconnect
                </button>
              </div>
              <div
                ref={termRef}
                className="rounded-lg overflow-hidden"
                style={{ height: '500px' }}
              />
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
