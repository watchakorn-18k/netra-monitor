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
	"strconv"
	"strings"
	"time"

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
	h := &Handler{
		monitor:  m,
		password: os.Getenv("AUTH_PASSWORD"),
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
