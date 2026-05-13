package system

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
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

	result := domain.NetworkStats{}
	var bestName string
	var bestTotal uint64
	for _, c := range counters {
		if c.Name == "lo" || c.Name == "lo0" {
			continue
		}
		total := c.BytesRecv + c.BytesSent
		if total > bestTotal {
			bestTotal = total
			bestName = c.Name
		}
		if c.BytesRecv > 0 || c.BytesSent > 0 {
			result.Interfaces = append(result.Interfaces, domain.NetInterface{
				Name:     c.Name,
				RxBytes:  c.BytesRecv,
				TxBytes:  c.BytesSent,
			})
		}
	}
	if bestName != "" {
		for _, c := range counters {
			if c.Name == bestName {
				result.Interface = c.Name
				result.RxBytes = c.BytesRecv
				result.TxBytes = c.BytesSent
				break
			}
		}
	}

	// Get public IP (best effort)
	client := &http.Client{Timeout: 3 * time.Second}
	if resp, err := client.Get("https://api.ipify.org"); err == nil {
		defer resp.Body.Close()
		if body, err := io.ReadAll(resp.Body); err == nil {
			result.PublicIP = strings.TrimSpace(string(body))
		}
	}

	// Count established connections
	if conns, err := psnet.Connections("tcp"); err == nil {
		for _, c := range conns {
			if c.Status == "ESTABLISHED" {
				result.ConnCount++
			}
		}
	}

	return result, nil
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
			HostPort int    `json:"host_port"`
		} `json:"Ports"`
		Created string `json:"CreatedAt"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, nil
	}

	// Get memory limits via podman inspect
	memLimits := getContainerMemLimits()

	// Get live stats for running containers
	liveStats := r.GetContainerStats()

	result := make([]domain.ContainerInfo, 0, len(raw))
	for _, c := range raw {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		var portStrs []string
		for _, p := range c.Ports {
			if p.HostPort != 0 {
				portStrs = append(portStrs, fmt.Sprintf("%s:%d", p.HostIP, p.HostPort))
			}
		}
		ci := domain.ContainerInfo{
			ID:       c.ID[:12],
			Name:     name,
			Image:    c.Image,
			State:    c.State,
			Status:   c.Status,
			Ports:    strings.Join(portStrs, ", "),
			Created:  c.Created,
			MemLimit: memLimits[c.ID],
		}
		// Merge live stats if available
		if st, ok := liveStats[c.ID[:12]]; ok {
			ci.CPU = st.CPU
			ci.MemUsage = st.MemUsage
			ci.MemPct = st.MemPct
			ci.NetIO = st.NetIO
			ci.BlockIO = st.BlockIO
			ci.PIDs = st.PIDs
			ci.Uptime = st.Uptime
		}
		result = append(result, ci)
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
		ID         string   `json:"Id"`
		RepoTags   []string `json:"RepoTags"`
		Names      []string `json:"Names"`
		Size       int64    `json:"Size"`
		Created    int64    `json:"Created"`
		Containers int      `json:"Containers"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, nil
	}

	result := make([]domain.ImageInfo, 0, len(raw))
	for _, img := range raw {
		shortID := img.ID
		if len(shortID) > 12 {
			parts := strings.SplitN(shortID, ":", 2)
			if len(parts) == 2 && len(parts[1]) > 12 {
				shortID = parts[1][:12]
			}
		}
		// RepoTags is first priority, then Names (podman uses Names when untagged)
		tags := img.RepoTags
		if len(tags) == 0 {
			tags = img.Names
		}
		if len(tags) == 0 {
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
	// Count images before prune
	before, _ := r.GetImages()
	beforeCount := len(before)

	cmd := exec.Command("podman", "image", "prune", "-f")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("podman image prune failed: %s", strings.TrimSpace(string(out)))
	}

	// Count images after prune
	after, _ := r.GetImages()
	afterCount := len(after)

	_ = out
	return beforeCount - afterCount, nil
}

// ── Container stats ──────────────────────────────────

func (r *gopsutilRepository) GetContainerStats() map[string]domain.ContainerInfo {
	out, err := exec.Command("podman", "stats", "--no-stream", "--format", "json").Output()
	if err != nil {
		return nil
	}
	var raw []struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		CPU      float64 `json:"cpu"`
		MemUsage string  `json:"mem_usage"`
		MemPct   float64 `json:"mem_percent"`
		NetIO    string  `json:"net_io"`
		BlockIO  string  `json:"block_io"`
		PIDs     int     `json:"pids"`
		Uptime   string  `json:"uptime"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil
	}
	m := make(map[string]domain.ContainerInfo)
	for _, s := range raw {
		m[s.ID[:12]] = domain.ContainerInfo{
			CPU:      s.CPU,
			MemUsage: s.MemUsage,
			MemPct:   s.MemPct,
			NetIO:    s.NetIO,
			BlockIO:  s.BlockIO,
			PIDs:     s.PIDs,
			Uptime:   s.Uptime,
		}
	}
	return m
}

// ── Container logs ────────────────────────────────────

func (r *gopsutilRepository) GetContainerLogs(id string, tail int) ([]domain.ContainerLog, error) {
	if tail <= 0 {
		tail = 100
	}
	out, err := exec.Command("podman", "logs", "--tail", strconv.Itoa(tail), id).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("podman logs %s failed: %s", id, strings.TrimSpace(string(out)))
	}
	var logs []domain.ContainerLog
	for _, line := range strings.Split(string(out), "\n") {
		if line == "" {
			continue
		}
		logType := "stdout"
		logs = append(logs, domain.ContainerLog{Line: line, Type: logType})
	}
	return logs, nil
}

// ── Systemd services ──────────────────────────────────

func (r *gopsutilRepository) GetServices() ([]domain.ServiceInfo, error) {
	out, err := exec.Command("systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend", "--plain").Output()
	if err != nil {
		return nil, nil // not linux or no systemctl
	}
	var services []domain.ServiceInfo
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		name := strings.TrimSuffix(fields[0], ".service")
		active := fields[2]
		sub := fields[3]
		if active == "inactive" && sub == "dead" {
			continue // skip totally inactive
		}
		// Get description and enabled status
		desc, enabled := getServiceDetails(name)
		services = append(services, domain.ServiceInfo{
			Name:        name,
			Description: desc,
			Active:      active,
			Sub:         sub,
			Enabled:     enabled,
		})
	}
	return services, nil
}

func getServiceDetails(name string) (string, bool) {
	out, _ := exec.Command("systemctl", "show", name+".service", "--property=Description,UnitFileState").Output()
	var desc string
	var enabled bool
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Description=") {
			desc = strings.TrimPrefix(line, "Description=")
		}
		if strings.HasPrefix(line, "UnitFileState=") {
			val := strings.TrimPrefix(line, "UnitFileState=")
			enabled = val == "enabled"
		}
	}
	return desc, enabled
}

func (r *gopsutilRepository) ServiceAction(name string, action string) error {
	switch action {
	case "start", "stop", "restart":
	default:
		return fmt.Errorf("invalid service action: %s", action)
	}
	cmd := exec.Command("systemctl", action, name+".service")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s %s failed: %s", action, name, strings.TrimSpace(string(out)))
	}
	return nil
}

// ── SSL Certificate Check ────────────────────────────

func (r *gopsutilRepository) GetSSLCerts() ([]domain.SSLCertInfo, error) {
	domainsStr := os.Getenv("SSL_DOMAINS")
	if domainsStr == "" {
		return nil, nil
	}
	domains := strings.Split(domainsStr, ",")
	results := make([]domain.SSLCertInfo, 0, len(domains))
	for _, d := range domains {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		results = append(results, checkSSLCert(d))
	}
	return results, nil
}

func checkSSLCert(host string) domain.SSLCertInfo {
	info := domain.SSLCertInfo{Domain: host}
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", host+":443", &tls.Config{InsecureSkipVerify: false})
	if err != nil {
		info.Error = err.Error()
		return info
	}
	defer conn.Close()
	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		info.Error = "no certificates found"
		return info
	}
	cert := certs[0]
	now := time.Now()
	daysLeft := int(cert.NotAfter.Sub(now).Hours() / 24)
	info.Issuer = cert.Issuer.CommonName
	info.NotBefore = cert.NotBefore.Format("2006-01-02")
	info.NotAfter = cert.NotAfter.Format("2006-01-02")
	info.DaysLeft = daysLeft
	info.Expired = cert.NotAfter.Before(now)
	return info
}

// ── Compose Stacks ───────────────────────────────────

func (r *gopsutilRepository) GetComposeStacks() ([]domain.ComposeStack, error) {
	// Find compose files in common locations
	searchDirs := []string{"/opt/stacks", "/opt/compose", "/home"}
	dir := os.Getenv("COMPOSE_DIR")
	if dir != "" {
		searchDirs = []string{dir}
	}

	var stacks []domain.ComposeStack
	for _, d := range searchDirs {
		entries, err := os.ReadDir(d)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			composeFile := findComposeFile(d + "/" + e.Name())
			if composeFile == "" {
				continue
			}
			stack := domain.ComposeStack{
				Name: e.Name(),
				File: composeFile,
			}
			// Try to get status via podman-compose ps
			stack.Services, stack.Running = getComposeStatus(e.Name(), composeFile)
			stack.Status = fmt.Sprintf("%d/%d running", stack.Running, stack.Services)
			stacks = append(stacks, stack)
		}
	}
	return stacks, nil
}

func findComposeFile(dir string) string {
	for _, name := range []string{"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "podman-compose.yml", "podman-compose.yaml"} {
		p := dir + "/" + name
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func getComposeStatus(name string, composeFile string) (total int, running int) {
	out, err := exec.Command("podman-compose", "--file", composeFile, "ps", "--format", "json").CombinedOutput()
	if err != nil {
		// Fallback: count containers with project label
		out2, err2 := exec.Command("podman", "ps", "-a", "--filter", "label=com.docker.compose.project="+name, "--format", "json").Output()
		if err2 != nil {
			return 0, 0
		}
		var containers []struct {
			State string `json:"State"`
		}
		if json.Unmarshal(out2, &containers) != nil {
			return 0, 0
		}
		total = len(containers)
		for _, c := range containers {
			if c.State == "running" {
				running++
			}
		}
		return
	}
	var services []struct {
		State string `json:"State"`
	}
	if json.Unmarshal(out, &services) != nil {
		return 0, 0
	}
	total = len(services)
	for _, s := range services {
		if s.State == "running" {
			running++
		}
	}
	return
}

func (r *gopsutilRepository) ComposeAction(name string, action string) error {
	// Find the compose file for this stack
	searchDirs := []string{"/opt/stacks", "/opt/compose", "/home"}
	dir := os.Getenv("COMPOSE_DIR")
	if dir != "" {
		searchDirs = []string{dir}
	}
	var composeFile string
	for _, d := range searchDirs {
		p := d + "/" + name
		composeFile = findComposeFile(p)
		if composeFile != "" {
			break
		}
	}
	if composeFile == "" {
		return fmt.Errorf("compose file not found for stack %s", name)
	}

	switch action {
	case "up", "down", "restart":
	default:
		return fmt.Errorf("invalid compose action: %s", action)
	}

	var cmd *exec.Cmd
	if action == "down" {
		cmd = exec.Command("podman-compose", "--file", composeFile, "down")
	} else if action == "restart" {
		cmd = exec.Command("podman-compose", "--file", composeFile, "restart")
	} else {
		cmd = exec.Command("podman-compose", "--file", composeFile, "up", "-d")
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("podman-compose %s %s failed: %s", action, name, strings.TrimSpace(string(out)))
	}
	return nil
}

// ── Cron Jobs ────────────────────────────────────────

func (r *gopsutilRepository) GetCronJobs() ([]domain.CronJob, error) {
	out, err := exec.Command("crontab", "-l").CombinedOutput()
	if err != nil {
		return nil, nil // no crontab or not available
	}
	var jobs []domain.CronJob
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		jobs = append(jobs, domain.CronJob{Line: line})
	}
	return jobs, nil
}

// ── Uptime Checks ────────────────────────────────────

func (r *gopsutilRepository) GetUptimeChecks() ([]domain.UptimeCheck, error) {
	urlsStr := os.Getenv("UPTIME_URLS")
	if urlsStr == "" {
		return nil, nil
	}
	urls := strings.Split(urlsStr, ",")
	results := make([]domain.UptimeCheck, 0, len(urls))
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		results = append(results, checkUptime(u))
	}
	return results, nil
}

func checkUptime(rawURL string) domain.UptimeCheck {
	result := domain.UptimeCheck{URL: rawURL, LastChecked: time.Now().Format(time.RFC3339)}
	start := time.Now()
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(rawURL)
	elapsed := time.Since(start)
	if err != nil {
		result.Error = err.Error()
		result.Online = false
		return result
	}
	defer resp.Body.Close()
	result.StatusCode = resp.StatusCode
	result.ResponseMs = float64(elapsed.Milliseconds())
	result.Online = resp.StatusCode >= 200 && resp.StatusCode < 400
	return result
}

// ── Network Tools ───────────────────────────────────

func (r *gopsutilRepository) RunNetworkTool(tool string, target string) (domain.NetworkToolResult, error) {
	result := domain.NetworkToolResult{Tool: tool, Target: target}
	var cmd *exec.Cmd
	switch tool {
	case "ping":
		cmd = exec.Command("ping", "-c", "4", "-W", "3", target)
	case "dns":
		cmd = exec.Command("dig", "+short", target)
	case "traceroute":
		cmd = exec.Command("traceroute", "-m", "15", target)
	case "port":
		cmd = exec.Command("nc", "-zvw3", target, strings.Split(target, ":")[len(strings.Split(target, ":"))-1])
	default:
		return result, fmt.Errorf("unsupported tool: %s", tool)
	}
	out, err := cmd.CombinedOutput()
	result.Output = string(out)
	if err != nil {
		result.Error = strings.TrimSpace(err.Error())
	}
	return result, nil
}

// ── File Browser ────────────────────────────────────

func (r *gopsutilRepository) BrowseDir(path string) ([]domain.FileInfo, error) {
	// Restrict to safe paths
	if path == "" {
		path = "/var/log"
	}
	// Basic path traversal protection
	if strings.Contains(path, "..") {
		return nil, fmt.Errorf("path traversal not allowed")
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	result := make([]domain.FileInfo, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		result = append(result, domain.FileInfo{
			Name:    e.Name(),
			Path:    path + "/" + e.Name(),
			Size:    info.Size(),
			IsDir:   e.IsDir(),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
			Mode:    info.Mode().String(),
		})
	}
	return result, nil
}

func (r *gopsutilRepository) ReadFile(path string) (string, error) {
	if strings.Contains(path, "..") {
		return "", fmt.Errorf("path traversal not allowed")
	}
	// Restrict file size to 1MB
	stat, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if stat.Size() > 1*1024*1024 {
		return "", fmt.Errorf("file too large (max 1MB)")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
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
