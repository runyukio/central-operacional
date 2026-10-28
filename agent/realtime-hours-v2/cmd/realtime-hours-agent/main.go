package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/app"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/config"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/nativehost"
)

func main() {
	mode := flag.String("mode", inferMode(), "daemon, once, diagnose, native-host or version")
	configPath := flag.String("config", config.DefaultPath(), "path to config.json")
	stateDir := flag.String("state-dir", "", "browser state directory for native host")
	flag.Parse()

	if *mode == "version" {
		fmt.Println(app.Version)
		return
	}

	if *mode == "native-host" {
		dir := strings.TrimSpace(*stateDir)
		if dir == "" {
			if cfg, err := config.Load(*configPath); err == nil {
				dir = cfg.StateDir
			} else {
				dir = config.Default().StateDir
			}
		}
		if err := nativehost.Run(os.Stdin, os.Stdout, dir); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		fatal(err)
	}
	runtime, err := app.New(cfg)
	if err != nil {
		fatal(err)
	}

	switch *mode {
	case "daemon":
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := runtime.RunDaemon(ctx); err != nil && err != context.Canceled {
			fatal(err)
		}
	case "once":
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		if err := runtime.RunOnce(ctx); err != nil {
			fatal(err)
		}
	case "diagnose":
		data, _ := json.MarshalIndent(runtime.Diagnose(), "", "  ")
		fmt.Println(string(data))
	default:
		fatal(fmt.Errorf("unsupported mode %q", *mode))
	}
}

func inferMode() string {
	name := strings.ToLower(filepath.Base(os.Args[0]))
	if strings.Contains(name, "native") {
		return "native-host"
	}
	return "daemon"
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
