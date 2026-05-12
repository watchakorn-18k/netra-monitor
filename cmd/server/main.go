package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	deliveryHTTP "netra-monitor/internal/delivery/http"
	"netra-monitor/internal/repository/system"
	"netra-monitor/internal/usecase/monitor"
)

//go:embed all:static
var staticFS embed.FS

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}

	sub, _ := fs.Sub(staticFS, "static")

	repo := system.New()
	monitorUC := monitor.New(repo)
	router := deliveryHTTP.SetupRouter(sub, monitorUC)

	fmt.Printf("Netra Monitor running on http://localhost:%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, router))
}
