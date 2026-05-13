package monitor

import (
	"fmt"
	"sync"

	domain "netra-monitor/internal/model"
)

// Monitor is the use case that orchestrates system metric collection.
func New(repo domain.SystemRepository) *Monitor {
	return &Monitor{
		repo:   repo,
		maxPts: 60,
	}
}

type Monitor struct {
	repo domain.SystemRepository

	mu      sync.Mutex
	history domain.HistoryData
	maxPts  int
}

// Collect gathers all system metrics and updates history.
func (m *Monitor) Collect() (*domain.Stats, error) {
	cpu, err := m.repo.GetCPU()
	if err != nil {
		return nil, fmt.Errorf("GetCPU: %w", err)
	}

	mem, err := m.repo.GetMemory()
	if err != nil {
		return nil, fmt.Errorf("GetMemory: %w", err)
	}

	disks, err := m.repo.GetDisks()
	if err != nil {
		return nil, fmt.Errorf("GetDisks: %w", err)
	}

	diskIO, err := m.repo.GetDiskIO()
	if err != nil {
		return nil, fmt.Errorf("GetDiskIO: %w", err)
	}

	net, err := m.repo.GetNetwork()
	if err != nil {
		return nil, fmt.Errorf("GetNetwork: %w", err)
	}

	sysInfo, err := m.repo.GetSystemInfo()
	if err != nil {
		return nil, fmt.Errorf("GetSystemInfo: %w", err)
	}

	procs, err := m.repo.GetTopProcesses(20)
	if err != nil {
		return nil, fmt.Errorf("GetTopProcesses: %w", err)
	}

	topMem, err := m.repo.GetTopMemoryProcesses(5)
	if err != nil {
		return nil, fmt.Errorf("GetTopMemoryProcesses: %w", err)
	}

	containers, _ := m.repo.GetContainers()
	images, _ := m.repo.GetImages()
	services, _ := m.repo.GetServices()
	cronJobs, _ := m.repo.GetCronJobs()
	uptimeChecks, _ := m.repo.GetUptimeChecks()
	servicesSSL, _ := m.repo.GetSSLCerts()
	composeStacks, _ := m.repo.GetComposeStacks()

	m.pushHistory(cpu.Usage, mem.Percent, net.RxBytes, net.TxBytes)

	return &domain.Stats{
		CPU:          cpu,
		Memory:       mem,
		Disks:        disks,
		DiskIO:       diskIO,
		Network:      net,
		System:       sysInfo,
		TopProcs:     procs,
		TopMem:       topMem,
		Containers:   containers,
		Images:       images,
		Services:     services,
		SSLCerts:     servicesSSL,
		Stacks:       composeStacks,
		CronJobs:     cronJobs,
		UptimeURLs:   uptimeChecks,
		History:      m.getHistory(),
	}, nil
}

// Kill terminates a process by PID.
func (m *Monitor) Kill(pid int32) error {
	return m.repo.KillProcess(pid)
}

// Restart restarts the service that owns the given PID.
func (m *Monitor) Restart(pid int32) error {
	return m.repo.RestartProcess(pid)
}

// ContainerAction performs start/stop/restart/remove on a container.
func (m *Monitor) ContainerAction(id string, action string) error {
	return m.repo.ContainerAction(id, action)
}

// RemoveImage removes a Podman image by ID.
func (m *Monitor) RemoveImage(id string) error {
	return m.repo.RemoveImage(id)
}

// PruneImages removes unused Podman images.
func (m *Monitor) PruneImages() (int, error) {
	return m.repo.PruneImages()
}

// GetContainerLogs returns container logs.
func (m *Monitor) GetContainerLogs(id string, tail int) ([]domain.ContainerLog, error) {
	return m.repo.GetContainerLogs(id, tail)
}

// ServiceAction performs start/stop/restart on a systemd service.
func (m *Monitor) ServiceAction(name string, action string) error {
	return m.repo.ServiceAction(name, action)
}

// ComposeAction performs up/down/restart on a compose stack.
func (m *Monitor) ComposeAction(name string, action string) error {
	return m.repo.ComposeAction(name, action)
}

// RunNetworkTool runs a network diagnostic command.
func (m *Monitor) RunNetworkTool(tool string, target string) (*domain.NetworkToolResult, error) {
	result, err := m.repo.RunNetworkTool(tool, target)
	return &result, err
}

// BrowseDir lists files in a directory.
func (m *Monitor) BrowseDir(path string) ([]domain.FileInfo, error) {
	return m.repo.BrowseDir(path)
}

// ReadFile reads a file's content.
func (m *Monitor) ReadFile(path string) (string, error) {
	return m.repo.ReadFile(path)
}

func (m *Monitor) pushHistory(cpu, mem float64, netRx, netTx uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.history.CPU = append(m.history.CPU, cpu)
	m.history.Memory = append(m.history.Memory, mem)
	m.history.NetRx = append(m.history.NetRx, netRx)
	m.history.NetTx = append(m.history.NetTx, netTx)

	if len(m.history.CPU) > m.maxPts {
		m.history.CPU = m.history.CPU[1:]
		m.history.Memory = m.history.Memory[1:]
		m.history.NetRx = m.history.NetRx[1:]
		m.history.NetTx = m.history.NetTx[1:]
	}
}

func (m *Monitor) getHistory() domain.HistoryData {
	m.mu.Lock()
	defer m.mu.Unlock()

	return domain.HistoryData{
		CPU:    append([]float64{}, m.history.CPU...),
		Memory: append([]float64{}, m.history.Memory...),
		NetRx:  append([]uint64{}, m.history.NetRx...),
		NetTx:  append([]uint64{}, m.history.NetTx...),
	}
}
