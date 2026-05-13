package http

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"netra-monitor/internal/service/monitor"
)

const cookieName = "netra_session"
const cookieMaxAge = 86400 * 7 // 7 days

// Handler handles HTTP requests for the monitor API.
type Handler struct {
	monitor  *monitor.Monitor
	authKey  []byte
	password string
}

// NewHandler creates a new HTTP handler.
func NewHandler(m *monitor.Monitor) *Handler {
	password := os.Getenv("AUTH_PASSWORD")
	if password == "" {
		password = "123456"
	}
	h := &Handler{
		monitor:  m,
		password: password,
	}
	h.authKey = make([]byte, 32)
	rand.Read(h.authKey)

	if h.password != "" {
		fmt.Println("🔐 Auth enabled — login required to kill processes")
	} else {
		fmt.Println("⚠️  Auth disabled — viewing public, kill PID blocked")
	}
	return h
}

func (h *Handler) AuthEnabled() bool  { return h.password != "" }
func (h *Handler) Authenticated(r *http.Request) bool {
	if h.password == "" {
		return false
	}
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	return h.validateToken(c.Value)
}

// ── GET /api/stats ───────────────────────────────────

func (h *Handler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.monitor.Collect()
	if err != nil {
		http.Error(w, "failed to collect stats", http.StatusInternalServerError)
		return
	}

	resp := make(map[string]interface{})
	resp["cpu"] = stats.CPU
	resp["memory"] = stats.Memory
	resp["disks"] = stats.Disks
	resp["diskIO"] = stats.DiskIO
	resp["network"] = stats.Network
	resp["system"] = stats.System
	resp["topProcesses"] = stats.TopProcs
	resp["topMemory"] = stats.TopMem
	resp["containers"] = stats.Containers
	resp["images"] = stats.Images
	resp["services"] = stats.Services
	resp["sslCerts"] = stats.SSLCerts
	resp["stacks"] = stats.Stacks
	resp["cronJobs"] = stats.CronJobs
	resp["uptimeChecks"] = stats.UptimeURLs
	resp["history"] = stats.History
	resp["authEnabled"] = h.AuthEnabled()
	resp["authenticated"] = h.Authenticated(r)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// ── POST /api/login ──────────────────────────────────

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if !h.AuthEnabled() {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "auth not configured"})
		return
	}

	var body struct{ Password string `json:"password"` }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "invalid body"})
		return
	}

	if body.Password != h.password {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "wrong password"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    h.generateToken(),
		Path:     "/",
		MaxAge:   cookieMaxAge,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	writeJSON(w, 200, map[string]interface{}{"ok": true})
}

// ── POST /api/logout ─────────────────────────────────

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:   cookieName,
		Value:  "",
		Path:   "/",
		MaxAge: -1,
	})
	writeJSON(w, 200, map[string]interface{}{"ok": true})
}

// ── POST /api/kill/{pid} ─────────────────────────────

func (h *Handler) KillProcess(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}

	// Extract PID from path
	pidStr := strings.TrimPrefix(r.URL.Path, "/api/kill/")
	pid, err := strconv.ParseInt(pidStr, 10, 32)
	if err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "invalid pid"})
		return
	}

	if err := h.monitor.Kill(int32(pid)); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]interface{}{"ok": true, "pid": pid})
}

// ── POST /api/restart/{pid} ──────────────────────────

func (h *Handler) RestartProcess(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}

	pidStr := strings.TrimPrefix(r.URL.Path, "/api/restart/")
	pid, err := strconv.ParseInt(pidStr, 10, 32)
	if err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "invalid pid"})
		return
	}

	if err := h.monitor.Restart(int32(pid)); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]interface{}{"ok": true, "pid": pid})
}

// ── POST /api/container/{action}/{id} ──────────────────

func (h *Handler) ContainerAction(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}

	// path: /api/container/{action}/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/container/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "invalid path, use /api/container/{action}/{id}"})
		return
	}
	action, id := parts[0], parts[1]

	if err := h.monitor.ContainerAction(id, action); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]interface{}{"ok": true, "action": action, "id": id})
}

// ── POST /api/image/remove/{id} ────────────────────────

func (h *Handler) RemoveImage(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/image/remove/")
	if id == "" {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "missing image id"})
		return
	}

	if err := h.monitor.RemoveImage(id); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]interface{}{"ok": true, "id": id})
}

// ── POST /api/image/prune ──────────────────────────────

func (h *Handler) PruneImages(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}

	count, err := h.monitor.PruneImages()
	if err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]interface{}{"ok": true, "removed": count})
}

// ── GET /api/container/logs/{id} ────────────────────────

func (h *Handler) ContainerLogs(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/container/logs/")
	if id == "" {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "missing container id"})
		return
	}

	tailStr := r.URL.Query().Get("tail")
	tail := 100
	if tailStr != "" {
		if t, err := strconv.Atoi(tailStr); err == nil {
			tail = t
		}
	}

	logs, err := h.monitor.GetContainerLogs(id, tail)
	if err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]interface{}{"ok": true, "logs": logs})
}

// ── POST /api/service/{action}/{name} ──────────────────

func (h *Handler) ServiceAction(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/service/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "invalid path"})
		return
	}
	action, name := parts[0], parts[1]

	if err := h.monitor.ServiceAction(name, action); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]interface{}{"ok": true, "action": action, "name": name})
}

// ── POST /api/compose/{action}/{name} ──────────────────

func (h *Handler) ComposeAction(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/compose/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "invalid path"})
		return
	}
	action, name := parts[0], parts[1]

	if err := h.monitor.ComposeAction(name, action); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]interface{}{"ok": true, "action": action, "name": name})
}

// ── WebSocket /api/container/terminal/{id} ────────────

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *Handler) ContainerTerminal(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		http.Error(w, "authentication required", http.StatusForbidden)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/container/terminal/")
	if id == "" {
		http.Error(w, "missing container id", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Start podman exec with /bin/sh (fallback to /bin/bash)
	cmd := exec.Command("podman", "exec", "-it", id, "/bin/sh")
	if _, err := exec.Command("podman", "exec", id, "test", "-x", "/bin/sh").CombinedOutput(); err != nil {
		cmd = exec.Command("podman", "exec", "-it", id, "/bin/bash")
	}

	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Error: %v\r\n", err)))
		return
	}

	// stdout/stderr -> websocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				conn.WriteMessage(websocket.TextMessage, buf[:n])
			}
			if err != nil {
				break
			}
		}
	}()
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				conn.WriteMessage(websocket.TextMessage, buf[:n])
			}
			if err != nil {
				break
			}
		}
	}()

	// websocket -> stdin
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		stdin.Write(msg)
	}

	cmd.Process.Kill()
	cmd.Wait()
}

// ── POST /api/nettool ────────────────────────────────

func (h *Handler) NetworkTool(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}
	var body struct {
		Tool   string `json:"tool"`   // ping, dns, traceroute, port
		Target string `json:"target"` // hostname or IP
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "invalid body"})
		return
	}
	if body.Tool == "" || body.Target == "" {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "tool and target required"})
		return
	}

	result, err := h.monitor.RunNetworkTool(body.Tool, body.Target)
	if err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, result)
}

// ── GET /api/files/browse?path=... ────────────────────

func (h *Handler) FileBrowse(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}
	path := r.URL.Query().Get("path")
	files, err := h.monitor.BrowseDir(path)
	if err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]interface{}{"ok": true, "files": files, "path": path})
}

// ── GET /api/files/read?path=... ──────────────────────

func (h *Handler) FileRead(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		writeJSON(w, 403, map[string]interface{}{"ok": false, "error": "authentication required"})
		return
	}
	path := r.URL.Query().Get("path")
	content, err := h.monitor.ReadFile(path)
	if err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]interface{}{"ok": true, "content": content, "path": path})
}

// ── GET /api/export ──────────────────────────────────

func (h *Handler) ExportStats(w http.ResponseWriter, r *http.Request) {
	if !h.Authenticated(r) {
		http.Error(w, "authentication required", http.StatusForbidden)
		return
	}
	stats, err := h.monitor.Collect()
	if err != nil {
		http.Error(w, "failed to collect stats", http.StatusInternalServerError)
		return
	}

	format := r.URL.Query().Get("format")
	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=netra-stats.csv")
		fmt.Fprintf(w, "metric,value\n")
		fmt.Fprintf(w, "cpu_usage,%.1f\n", stats.CPU.Usage)
		fmt.Fprintf(w, "cpu_cores,%d\n", stats.CPU.Cores)
		fmt.Fprintf(w, "mem_total,%d\n", stats.Memory.Total)
		fmt.Fprintf(w, "mem_used,%d\n", stats.Memory.Used)
		fmt.Fprintf(w, "mem_percent,%.1f\n", stats.Memory.Percent)
		fmt.Fprintf(w, "swap_total,%d\n", stats.Memory.SwapTotal)
		fmt.Fprintf(w, "swap_used,%d\n", stats.Memory.SwapUsed)
		fmt.Fprintf(w, "uptime,%d\n", stats.System.Uptime)
		fmt.Fprintf(w, "containers,%d\n", len(stats.Containers))
		for i, d := range stats.Disks {
			fmt.Fprintf(w, "disk_%d_mount,%s\n", i, d.Mount)
			fmt.Fprintf(w, "disk_%d_percent,%.1f\n", i, d.Percent)
		}
	default:
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=netra-stats.json")
		json.NewEncoder(w).Encode(stats)
	}
}

// ── Token helpers ────────────────────────────────────

func (h *Handler) generateToken() string {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, h.authKey)
	mac.Write([]byte(ts))
	return ts + "." + hex.EncodeToString(mac.Sum(nil))
}

func (h *Handler) validateToken(token string) bool {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return false
	}
	ts, sig := parts[0], parts[1]
	t, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return false
	}
	if time.Now().Unix()-t > int64(cookieMaxAge) {
		return false
	}
	mac := hmac.New(sha256.New, h.authKey)
	mac.Write([]byte(ts))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(sig), []byte(expected))
}

// ── Helper ───────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
