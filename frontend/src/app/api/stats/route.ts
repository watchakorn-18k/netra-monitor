import { NextResponse } from 'next/server';
import os from 'os';
import si from 'systeminformation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [cpu, mem, disk, temps, net, processes] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.cpuTemperature(),
      si.networkStats(),
      si.processes(),
    ]);

    const cpuUsage = cpu.currentLoad || 0;
    const memTotal = mem.total;
    const memUsed = mem.used;
    const memPercent = (memUsed / memTotal) * 100;

    const mainInterface = net.find((n) => n.iface !== 'lo') || net[0] || {};
    const netIn = mainInterface.rx_sec || 0;
    const netOut = mainInterface.tx_sec || 0;

    const topProcesses = (processes.list || [])
      .sort((a: { cpu: number }, b: { cpu: number }) => (b.cpu || 0) - (a.cpu || 0))
      .slice(0, 8)
      .map((p: { name: string; pid: number; cpu: number; mem: number }) => ({
        name: p.name,
        pid: p.pid,
        cpu: Number((p.cpu || 0).toFixed(1)),
        mem: Number((p.mem || 0).toFixed(1)),
      }));

    // Disk IO
    let diskIO = { read: 0, write: 0 };
    try {
      const dio = await si.disksIO();
      diskIO = { read: dio.rIO_sec || 0, write: dio.wIO_sec || 0 };
    } catch { /* ignore */ }

    const stats = {
      cpu: {
        usage: Number(cpuUsage.toFixed(1)),
        cores: cpu.cpus ? cpu.cpus.length : os.cpus().length,
        perCore: cpu.cpus ? cpu.cpus.map((c: { load: number }) => Number((c.load || 0).toFixed(1))) : [],
        temperature: temps.main || null,
      },
      memory: {
        total: memTotal,
        used: memUsed,
        available: mem.available,
        percent: Number(memPercent.toFixed(1)),
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        swapPercent: mem.swaptotal > 0 ? Number(((mem.swapused / mem.swaptotal) * 100).toFixed(1)) : 0,
      },
      disk: disk.map((d: { fs: string; mount: string; size: number; used: number; available: number; use: number }) => ({
        fs: d.fs,
        mount: d.mount,
        size: d.size,
        used: d.used,
        available: d.available,
        percent: Number((d.use || 0).toFixed(1)),
      })),
      diskIO,
      network: {
        interface: mainInterface.iface || 'N/A',
        rx_sec: Number(netIn.toFixed(0)),
        tx_sec: Number(netOut.toFixed(0)),
      },
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      kernel: os.release(),
      osName: os.type(),
      processes: {
        total: processes.all || 0,
        running: processes.running || 0,
        sleeping: processes.sleeping || 0,
        top: topProcesses,
      },
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error collecting stats:', error);
    return NextResponse.json({ error: 'Failed to collect stats' }, { status: 500 });
  }
}
