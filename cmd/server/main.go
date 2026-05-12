package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	deliveryHTTP "netra-monitor/internal/handler/http"
	"netra-monitor/internal/repository/system"
	"netra-monitor/internal/service/monitor"
)

//go:embed all:static
var staticFS embed.FS

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "20265"
	}

	sub, _ := fs.Sub(staticFS, "static")

	repo := system.New()
	monitorUC := monitor.New(repo)
	router := deliveryHTTP.SetupRouter(sub, monitorUC)

	fmt.Printf("Netra Monitor running on http://localhost:%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, router))
}
