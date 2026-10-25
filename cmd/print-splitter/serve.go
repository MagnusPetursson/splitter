package main

import (
	"flag"
	iofs "io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/MagnusPetursson/splitter/internal/server"
	"github.com/MagnusPetursson/splitter/web"
)

var version = "dev"

func cmdServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", "127.0.0.1:8097", "listen address")
	home, _ := os.UserHomeDir()
	data := fs.String("data", filepath.Join(home, ".local", "state", "print-splitter"), "data directory for exports")
	maxMB := fs.Int64("max-upload-mb", 300, "upload size limit (MB)")
	ttl := fs.Duration("ttl", 6*time.Hour, "idle lifetime of uploaded models and exports")
	webDir := fs.String("web-dir", "", "serve the UI from this directory instead of the embedded copy (development)")
	fs.Parse(args)
	var ui iofs.FS = web.FS
	if *webDir != "" {
		ui = os.DirFS(*webDir)
	}
	s := server.New(server.Config{Addr: *addr, DataDir: *data, MaxUpload: *maxMB << 20, TTL: *ttl, Web: ui, Version: version})
	return s.ListenAndServe()
}
