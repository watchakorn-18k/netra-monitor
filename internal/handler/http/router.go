package http

import (
	"io/fs"
	"net/http"

	"netra-monitor/internal/service/monitor"
)

// SetupRouter configures all routes and returns an http.Handler.
func SetupRouter(staticFS fs.FS, m *monitor.Monitor) http.Handler {
	mux := http.NewServeMux()
	h := NewHandler(m)

	// API routes
	mux.HandleFunc("/api/stats", h.GetStats)
	mux.HandleFunc("/api/login", h.Login)
	mux.HandleFunc("/api/logout", h.Logout)
	mux.HandleFunc("/api/kill/", h.KillProcess)
	mux.HandleFunc("/api/restart/", h.RestartProcess)
	mux.HandleFunc("/api/container/", h.ContainerAction)
	mux.HandleFunc("/api/image/prune", h.PruneImages)
	mux.HandleFunc("/api/image/remove/", h.RemoveImage)

	// Static files — serve index.html at /
	fileServer := http.FileServer(http.FS(staticFS))
	mux.Handle("/", fileServer)

	return mux
}
