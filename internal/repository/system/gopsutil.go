package system

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

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

	sm, _ := mem.SwapMemory()
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

	result := make([]domain.DiskStats, 0)
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
		memInfo, _ := p.MemoryInfo()
		var memBytes uint64
		if memInfo != nil {
			memBytes = memInfo.RSS
		}
		procs = append(procs, domain.ProcessInfo{
			Name:     name,
			Service:  detectService(p.Pid),
			PID:      p.Pid,
			CPU:      roundF(cpuPct, 1),
			Mem:      roundF32(memPct, 1),
			MemBytes: memBytes,
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

func (r *gopsutilRepository) RestartProcess(pid int32) error {
	if runtime.GOOS == "darwin" {
		return restartLaunchdService(pid)
	}
	return restartSystemdService(pid)
}

func restartSystemdService(pid int32) error {
	svc := detectSystemdUnit(pid)
	if svc == "" {
		return fmt.Errorf("no systemd unit found for PID %d", pid)
	}
	cmd := exec.Command("systemctl", "restart", svc)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl restart %s failed: %s", svc, strings.TrimSpace(string(out)))
	}
	return nil
}

func restartLaunchdService(pid int32) error {
	label := detectLaunchdService(pid)
	if label == "" {
		return fmt.Errorf("no launchd service found for PID %d", pid)
	}
	uid := os.Getuid()
	target := fmt.Sprintf("gui/%d/%s", uid, label)
	cmd := exec.Command("launchctl", "kickstart", "-k", target)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl kickstart %s failed: %s", target, strings.TrimSpace(string(out)))
	}
	return nil
}

func (r *gopsutilRepository) GetTopMemoryProcesses(limit int) ([]domain.ProcessInfo, error) {
	pids, err := process.Processes()
	if err != nil {
		return nil, err
	}

	procs := make([]domain.ProcessInfo, 0, len(pids))
	for _, p := range pids {
		name, _ := p.Name()
		cpuPct, _ := p.CPUPercent()
		memPct, _ := p.MemoryPercent()
		memInfo, _ := p.MemoryInfo()
		var memBytes uint64
		if memInfo != nil {
			memBytes = memInfo.RSS
		}
		procs = append(procs, domain.ProcessInfo{
			Name:     name,
			Service:  detectService(p.Pid),
			PID:      p.Pid,
			CPU:      roundF(cpuPct, 1),
			Mem:      roundF32(memPct, 1),
			MemBytes: memBytes,
		})
	}

	sort.Slice(procs, func(i, j int) bool {
		return procs[i].MemBytes > procs[j].MemBytes
	})

	if len(procs) > limit {
		procs = procs[:limit]
	}

	return procs, nil
}

// ── Podman containers ─────────────────────────────────

func (r *gopsutilRepository) GetContainers() ([]domain.ContainerInfo, error) {
	out, err := exec.Command("podman", "ps", "-a", "--format", "json").Output()
	if err != nil {
		return nil, nil
	}

	var raw []struct {
		ID      string `json:"Id"`
		Names   []string `json:"Names"`
		Image   string `json:"Image"`
		State   string `json:"State"`
		Status  string `json:"Status"`
		Ports   []struct {
			HostIP   string `json:"host_ip"`
			HostPort string `json:"host_port"`
		} `json:"Ports"`
		Created int64  `json:"CreatedAt"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, nil
	}

	// Get memory limits via podman inspect
	memLimits := getContainerMemLimits()

	result := make([]domain.ContainerInfo, 0, len(raw))
	for _, c := range raw {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		var portStrs []string
		for _, p := range c.Ports {
			if p.HostPort != "" {
				portStrs = append(portStrs, p.HostIP+":"+p.HostPort)
			}
		}
		result = append(result, domain.ContainerInfo{
			ID:       c.ID[:12],
			Name:     name,
			Image:    c.Image,
			State:    c.State,
			Status:   c.Status,
			Ports:    strings.Join(portStrs, ", "),
			Created:  c.Created,
			MemLimit: memLimits[c.ID],
		})
	}
	return result, nil
}

func getContainerMemLimits() map[string]string {
	out, err := exec.Command("podman", "ps", "-a", "--format", "{{.ID}}").Output()
	if err != nil {
		return nil
	}
	m := make(map[string]string)
	for _, id := range strings.Fields(string(out)) {
		insp, err := exec.Command("podman", "inspect", id, "--format", "{{.HostConfig.Memory}}").Output()
		if err != nil {
			continue
		}
		val := strings.TrimSpace(string(insp))
		if val == "" || val == "0" {
			m[id] = ""
			continue
		}
		memInt, err := strconv.ParseInt(val, 10, 64)
		if err != nil {
			m[id] = val
			continue
		}
		m[id] = formatMemorySize(uint64(memInt))
	}
	return m
}

func formatMemorySize(bytes uint64) string {
	if bytes >= 1024*1024*1024 {
		return fmt.Sprintf("%.0fG", float64(bytes)/float64(1024*1024*1024))
	}
	if bytes >= 1024*1024 {
		return fmt.Sprintf("%.0fM", float64(bytes)/float64(1024*1024))
	}
	return fmt.Sprintf("%dK", bytes/1024)
}

func (r *gopsutilRepository) ContainerAction(id string, action string) error {
	switch action {
	case "start", "stop", "restart", "remove":
	default:
		return fmt.Errorf("invalid container action: %s", action)
	}
	cmd := exec.Command("podman", action, id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("podman %s %s failed: %s", action, id, strings.TrimSpace(string(out)))
	}
	return nil
}

// ── Podman images ─────────────────────────────────────

func (r *gopsutilRepository) GetImages() ([]domain.ImageInfo, error) {
	out, err := exec.Command("podman", "images", "--format", "json").Output()
	if err != nil {
		return nil, nil
	}

	var raw []struct {
		ID        string   `json:"Id"`
		RepoTags  []string `json:"RepoTags"`
		Size      int64    `json:"Size"`
		Created   int64    `json:"Created"`
		Containers int     `json:"Containers"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, nil
	}

	result := make([]domain.ImageInfo, 0, len(raw))
	for _, img := range raw {
		// Show short ID (first 12 chars)
		shortID := img.ID
		if len(shortID) > 12 {
			// podman returns full sha256:xxx, take last 12
			parts := strings.SplitN(shortID, ":", 2)
			if len(parts) == 2 && len(parts[1]) > 12 {
				shortID = parts[1][:12]
			}
		}
		tags := img.RepoTags
		if tags == nil {
			tags = []string{"<none>"}
		}
		result = append(result, domain.ImageInfo{
			ID:         shortID,
			RepoTags:   tags,
			Size:       img.Size,
			Created:    img.Created,
			Containers: img.Containers,
		})
	}
	return result, nil
}

func (r *gopsutilRepository) RemoveImage(id string) error {
	cmd := exec.Command("podman", "rmi", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("podman rmi %s failed: %s", id, strings.TrimSpace(string(out)))
	}
	return nil
}

func (r *gopsutilRepository) PruneImages() (int, error) {
	cmd := exec.Command("podman", "image", "prune", "-f")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("podman image prune failed: %s", strings.TrimSpace(string(out)))
	}
	// Parse number of deleted images from output
	count := 0
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "deleted") || strings.Contains(line, "untagged") {
			count++
		}
	}
	return count, nil
}

// ── helpers ────────────────────────────────────────────

func detectService(pid int32) string {
	if runtime.GOOS == "darwin" {
		return detectLaunchdService(pid)
	}
	return detectSystemdUnit(pid)
}

// ── macOS: launchd label ─────────────────────────────

var (
	launchdMap  map[int32]string
	launchdTime time.Time
	launchdMu   sync.Mutex
)

func detectLaunchdService(pid int32) string {
	m := getLaunchdMap()
	if m == nil {
		return ""
	}
	return m[pid]
}

func getLaunchdMap() map[int32]string {
	launchdMu.Lock()
	defer launchdMu.Unlock()

	if launchdMap != nil && time.Since(launchdTime) < 5*time.Second {
		return launchdMap
	}

	out, err := exec.Command("launchctl", "list").Output()
	if err != nil {
		return launchdMap
	}

	m := make(map[int32]string)
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 3 {
			p, err := strconv.Atoi(fields[0])
			if err == nil && p > 0 {
				m[int32(p)] = fields[2]
			}
		}
	}

	launchdMap = m
	launchdTime = time.Now()
	return m
}

// ── Linux: systemd unit from cgroup ──────────────────

var systemdUnitRE = regexp.MustCompile(`([A-Za-z0-9_.@:+\\-]+\.(service|scope|slice))`)

func detectSystemdUnit(pid int32) string {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cgroup", pid))
	if err != nil {
		return ""
	}

	var fallback string
	for _, line := range strings.Split(string(data), "\n") {
		matches := systemdUnitRE.FindAllString(line, -1)
		for i := len(matches) - 1; i >= 0; i-- {
			unit := decodeSystemdUnit(matches[i])
			if unit == "" || strings.HasSuffix(unit, ".slice") || isLoginSessionScope(unit) {
				continue
			}
			if strings.HasSuffix(unit, ".service") {
				return unit
			}
			if fallback == "" {
				fallback = unit
			}
		}
	}

	return fallback
}

func isLoginSessionScope(unit string) bool {
	return strings.HasPrefix(unit, "session-") || strings.HasPrefix(unit, "user@")
}

func decodeSystemdUnit(unit string) string {
	unit = strings.ReplaceAll(unit, `\\x2d`, "-")
	unit = strings.ReplaceAll(unit, `\\x2e`, ".")
	unit = strings.ReplaceAll(unit, `\\x40`, "@")
	unit = strings.ReplaceAll(unit, `\\x5f`, "_")
	return unit
}

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
