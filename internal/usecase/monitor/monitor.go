package monitor

import (
	"sync"

	"netra-monitor/internal/domain"
)

// Monitor is the use case that orchestrates system metric collection.
type Monitor struct {
	repo domain.SystemRepository

	mu      sync.Mutex
	history domain.HistoryData
	maxPts  int
}

// New creates a new Monitor use case.
func New(repo domain.SystemRepository) *Monitor {
	return &Monitor{
		repo:   repo,
		maxPts: 60,
	}
}

// Collect gathers all system metrics and updates history.
func (m *Monitor) Collect() (*domain.Stats, error) {
	cpu, err := m.repo.GetCPU()
	if err != nil {
		return nil, err
	}

	mem, err := m.repo.GetMemory()
	if err != nil {
		return nil, err
	}

	disks, err := m.repo.GetDisks()
	if err != nil {
		return nil, err
	}

	diskIO, err := m.repo.GetDiskIO()
	if err != nil {
		return nil, err
	}

	net, err := m.repo.GetNetwork()
	if err != nil {
		return nil, err
	}

	sysInfo, err := m.repo.GetSystemInfo()
	if err != nil {
		return nil, err
	}

	procs, err := m.repo.GetTopProcesses(8)
	if err != nil {
		return nil, err
	}

	m.pushHistory(cpu.Usage, mem.Percent, net.RxBytes, net.TxBytes)

	return &domain.Stats{
		CPU:      cpu,
		Memory:   mem,
		Disks:    disks,
		DiskIO:   diskIO,
		Network:  net,
		System:   sysInfo,
		TopProcs: procs,
		History:  m.getHistory(),
	}, nil
}

// Kill terminates a process by PID.
func (m *Monitor) Kill(pid int32) error {
	return m.repo.KillProcess(pid)
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
