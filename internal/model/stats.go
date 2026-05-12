package domain

// Stats is the aggregate root containing all system metrics.
type Stats struct {
	CPU      CPUStats      `json:"cpu"`
	Memory   MemoryStats   `json:"memory"`
	Disks    []DiskStats   `json:"disks"`
	DiskIO   DiskIOStats   `json:"diskIO"`
	Network  NetworkStats  `json:"network"`
	System   SystemInfo    `json:"system"`
	TopProcs []ProcessInfo `json:"topProcesses"`
	History  HistoryData   `json:"history"`
}

// CPUStats represents CPU utilization metrics.
type CPUStats struct {
	Usage   float64   `json:"usage"`
	Cores   int       `json:"cores"`
	PerCore []float64 `json:"perCore"`
}

// MemoryStats represents memory and swap utilization.
type MemoryStats struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	Percent     float64 `json:"percent"`
	SwapTotal   uint64  `json:"swapTotal"`
	SwapUsed    uint64  `json:"swapUsed"`
	SwapPercent float64 `json:"swapPercent"`
}

// DiskStats represents a single disk partition usage.
type DiskStats struct {
	Device  string  `json:"device"`
	Mount   string  `json:"mount"`
	Total   uint64  `json:"total"`
	Used    uint64  `json:"used"`
	Free    uint64  `json:"free"`
	Percent float64 `json:"percent"`
}

// DiskIOStats represents disk I/O counters.
type DiskIOStats struct {
	ReadBytes  uint64 `json:"readBytes"`
	WriteBytes uint64 `json:"writeBytes"`
}

// NetworkStats represents network interface counters.
type NetworkStats struct {
	Interface string `json:"interface"`
	RxBytes   uint64 `json:"rxBytes"`
	TxBytes   uint64 `json:"txBytes"`
}

// SystemInfo represents static host information.
type SystemInfo struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Kernel   string `json:"kernel"`
	Uptime   uint64 `json:"uptime"`
}

// ProcessInfo represents a running process summary.
type ProcessInfo struct {
	Name    string  `json:"name"`
	Service string  `json:"service,omitempty"`
	PID     int32   `json:"pid"`
	CPU     float64 `json:"cpu"`
	Mem     float32 `json:"mem"`
}

// HistoryData holds time-series data for sparkline charts.
type HistoryData struct {
	CPU    []float64 `json:"cpu"`
	Memory []float64 `json:"memory"`
	NetRx  []uint64  `json:"netRx"`
	NetTx  []uint64  `json:"netTx"`
}

// SystemRepository is the port for collecting system metrics.
type SystemRepository interface {
	GetCPU() (CPUStats, error)
	GetMemory() (MemoryStats, error)
	GetDisks() ([]DiskStats, error)
	GetDiskIO() (DiskIOStats, error)
	GetNetwork() (NetworkStats, error)
	GetSystemInfo() (SystemInfo, error)
	GetTopProcesses(limit int) ([]ProcessInfo, error)
	KillProcess(pid int32) error
}
