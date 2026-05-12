package system

import (
	"fmt"
	"runtime"
	"sort"
	"syscall"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	psnet "github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"

	"netra-monitor/internal/model"
)

// gopsutilRepository implements domain.SystemRepository using gopsutil.
type gopsutilRepository struct{}

// New creates a new system metrics repository.
func New() domain.SystemRepository {
	return &gopsutilRepository{}
}

func (r *gopsutilRepository) GetCPU() (domain.CPUStats, error) {
	perCore, err := cpu.Percent(0, true)
	if err != nil {
		return domain.CPUStats{}, err
	}

	var total float64
	for _, v := range perCore {
		total += v
	}
	avg := float64(0)
	if len(perCore) > 0 {
		avg = total / float64(len(perCore))
	}

	return domain.CPUStats{
		Usage:   roundF(avg, 1),
		Cores:   len(perCore),
		PerCore: perCore,
	}, nil
}

func (r *gopsutilRepository) GetMemory() (domain.MemoryStats, error) {
	vm, err := mem.VirtualMemory()
	if err != nil {
		return domain.MemoryStats{}, err
	}

	sm, _ := mem.SwapMemory() // swap may not exist, ignore error
	swapPercent := float64(0)
	swapTotal := uint64(0)
	swapUsed := uint64(0)
	if sm != nil {
		swapPercent = roundF(sm.UsedPercent, 1)
		swapTotal = sm.Total
		swapUsed = sm.Used
	}

	return domain.MemoryStats{
		Total:       vm.Total,
		Used:        vm.Used,
		Available:   vm.Available,
		Percent:     roundF(vm.UsedPercent, 1),
		SwapTotal:   swapTotal,
		SwapUsed:    swapUsed,
		SwapPercent: swapPercent,
	}, nil
}

func (r *gopsutilRepository) GetDisks() ([]domain.DiskStats, error) {
	partitions, err := disk.Partitions(false)
	if err != nil {
		return nil, err
	}

	var result []domain.DiskStats
	for _, p := range partitions {
		usage, err := disk.Usage(p.Mountpoint)
		if err != nil || usage == nil {
			continue
		}
		result = append(result, domain.DiskStats{
			Device:  p.Device,
			Mount:   p.Mountpoint,
			Total:   usage.Total,
			Used:    usage.Used,
			Free:    usage.Free,
			Percent: roundF(usage.UsedPercent, 1),
		})
	}
	return result, nil
}

func (r *gopsutilRepository) GetDiskIO() (domain.DiskIOStats, error) {
	counters, err := disk.IOCounters()
	if err != nil {
		return domain.DiskIOStats{}, err
	}

	var readTotal, writeTotal uint64
	for _, c := range counters {
		readTotal += c.ReadBytes
		writeTotal += c.WriteBytes
	}

	return domain.DiskIOStats{
		ReadBytes:  readTotal,
		WriteBytes: writeTotal,
	}, nil
}

func (r *gopsutilRepository) GetNetwork() (domain.NetworkStats, error) {
	counters, err := psnet.IOCounters(true)
	if err != nil {
		return domain.NetworkStats{}, err
	}

	for _, c := range counters {
		if c.Name == "lo" {
			continue
		}
		return domain.NetworkStats{
			Interface: c.Name,
			RxBytes:   c.BytesRecv,
			TxBytes:   c.BytesSent,
		}, nil
	}

	return domain.NetworkStats{}, nil
}

func (r *gopsutilRepository) GetSystemInfo() (domain.SystemInfo, error) {
	info, err := host.Info()
	if err != nil {
		return domain.SystemInfo{}, err
	}

	return domain.SystemInfo{
		Hostname: info.Hostname,
		OS:       info.OS,
		Arch:     runtime.GOARCH,
		Kernel:   info.KernelVersion,
		Uptime:   info.Uptime,
	}, nil
}

func (r *gopsutilRepository) GetTopProcesses(limit int) ([]domain.ProcessInfo, error) {
	pids, err := process.Processes()
	if err != nil {
		return nil, err
	}

	procs := make([]domain.ProcessInfo, 0, len(pids))
	for _, p := range pids {
		name, _ := p.Name()
		cpuPct, _ := p.CPUPercent()
		memPct, _ := p.MemoryPercent()
		procs = append(procs, domain.ProcessInfo{
			Name: name,
			PID:  p.Pid,
			CPU:  roundF(cpuPct, 1),
			Mem:  roundF32(memPct, 1),
		})
	}

	sort.Slice(procs, func(i, j int) bool {
		return procs[i].CPU > procs[j].CPU
	})

	if len(procs) > limit {
		procs = procs[:limit]
	}

	return procs, nil
}

func (r *gopsutilRepository) KillProcess(pid int32) error {
	p, err := process.NewProcess(pid)
	if err != nil {
		return fmt.Errorf("process not found: %d", pid)
	}
	return p.SendSignal(syscall.SIGTERM)
}

// --- helpers ---

func roundF(v float64, places int) float64 {
	pow := 1.0
	for i := 0; i < places; i++ {
		pow *= 10
	}
	return float64(int(v*pow+0.5)) / pow
}

func roundF32(v float32, places int) float32 {
	pow := float32(1.0)
	for i := 0; i < places; i++ {
		pow *= 10
	}
	return float32(int(v*pow+0.5)) / pow
}
