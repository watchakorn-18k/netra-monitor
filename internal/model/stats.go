package domain

import "time"

// Stats is the aggregate root containing all system metrics.
type Stats struct {
	CPU        CPUStats        `json:"cpu"`
	Memory     MemoryStats     `json:"memory"`
	Disks      []DiskStats     `json:"disks"`
	DiskIO     DiskIOStats     `json:"diskIO"`
	Network    NetworkStats    `json:"network"`
	System     SystemInfo      `json:"system"`
	TopProcs   []ProcessInfo   `json:"topProcesses"`
	TopMem     []ProcessInfo   `json:"topMemory"`
	Containers []ContainerInfo `json:"containers"`
	Images     []ImageInfo     `json:"images"`
	Services   []ServiceInfo   `json:"services"`
	History    HistoryData     `json:"history"`
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
	Name     string  `json:"name"`
	Service  string  `json:"service,omitempty"`
	PID      int32   `json:"pid"`
	CPU      float64 `json:"cpu"`
	Mem      float32 `json:"mem"`
	MemBytes uint64  `json:"memBytes"`
}

// HistoryData holds time-series data for sparkline charts.
type HistoryData struct {
	CPU    []float64 `json:"cpu"`
	Memory []float64 `json:"memory"`
	NetRx  []uint64  `json:"netRx"`
	NetTx  []uint64  `json:"netTx"`
}

// ContainerInfo represents a Podman container.
type ContainerInfo struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Image    string  `json:"image"`
	State    string  `json:"state"`
	Status   string  `json:"status"`
	Ports    string  `json:"ports"`
	Created  string  `json:"created"`
	MemLimit string  `json:"memLimit,omitempty"`
	CPU      float64 `json:"cpu,omitempty"`
	MemUsage string  `json:"memUsage,omitempty"`
	MemPct   float64 `json:"memPct,omitempty"`
	NetIO    string  `json:"netIO,omitempty"`
	BlockIO  string  `json:"blockIO,omitempty"`
	PIDs     int     `json:"pids,omitempty"`
	Uptime   string  `json:"uptime,omitempty"`
}

// ImageInfo represents a Podman image.
type ImageInfo struct {
	ID         string   `json:"id"`
	RepoTags   []string `json:"repoTags"`
	Size       int64    `json:"size"`
	Created    int64    `json:"created"`
	Containers int      `json:"containers"`
}

// ServiceInfo represents a systemd service.
type ServiceInfo struct {
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Active      string    `json:"active"`   // active, inactive, failed
	Sub         string    `json:"sub"`      // running, exited, dead
	Enabled     bool      `json:"enabled"`
	Uptime      string    `json:"uptime,omitempty"`
	PID         int32     `json:"pid,omitempty"`
	MemBytes    uint64    `json:"memBytes,omitempty"`
	CPUPct      float64   `json:"cpuPct,omitempty"`
}

// ContainerLog represents a container log entry.
type ContainerLog struct {
	Line      string    `json:"line"`
	Timestamp time.Time `json:"timestamp,omitempty"`
	Type      string    `json:"type,omitempty"` // stdout, stderr
}

// AlertConfig holds alert notification settings.
type AlertConfig struct {
	Type     string `json:"type"` // telegram, discord
	Token    string `json:"token"`
	ChatID   string `json:"chatId"`
	Webhook  string `json:"webhook,omitempty"`
	CPU      int    `json:"cpu,omitempty"`
	Mem      int    `json:"mem,omitempty"`
	Disk     int    `json:"disk,omitempty"`
	Interval int    `json:"interval,omitempty"` // seconds between alerts
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
	GetTopMemoryProcesses(limit int) ([]ProcessInfo, error)
	GetContainers() ([]ContainerInfo, error)
	GetImages() ([]ImageInfo, error)
	GetServices() ([]ServiceInfo, error)
	GetContainerLogs(id string, tail int) ([]ContainerLog, error)
	KillProcess(pid int32) error
	RestartProcess(pid int32) error
	ContainerAction(id string, action string) error
	RemoveImage(id string) error
	PruneImages() (int, error)
	ServiceAction(name string, action string) error
}
