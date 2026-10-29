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
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/instance"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/nativehost"
)

func main() {
	mode := flag.String("mode", inferMode(), "daemon, once, diagnose, native-host, rollback or version")
	configPath := flag.String("config", config.DefaultPath(), "path to config.json")
	stateDir := flag.String("state-dir", "", "browser state directory for native host")
	outputPath := flag.String("output", "", "optional output file for version and diagnose modes")
	flag.Parse()

	if *mode == "version" {
		emit([]byte(app.Version+"\n"), *outputPath)
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
	runtime, err := app.New(cfg, *configPath)
	if err != nil {
		fatal(err)
	}

	var guard instance.Guard
	if *mode == "daemon" {
		guard, err = instance.Acquire(`Global\CentralOperacionalRealtimeHoursV2`)
		if err != nil {
			fatal(err)
		}
		defer guard.Close()
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
	case "rollback":
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		status, body, err := runtime.Client.PostJSON(ctx, "/api/realtime-hours/v2/rollback", map[string]any{})
		var result struct {
			Success bool `json:"success"`
		}
		if err != nil || status != 200 || json.Unmarshal(body, &result) != nil || !result.Success {
			fatal(fmt.Errorf("server rollback failed: status=%d", status))
		}
	case "diagnose":
		data, _ := json.MarshalIndent(runtime.Diagnose(), "", "  ")
		emit(append(data, '\n'), *outputPath)
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

func emit(data []byte, outputPath string) {
	if strings.TrimSpace(outputPath) == "" {
		_, _ = os.Stdout.Write(data)
		return
	}
	if err := os.WriteFile(outputPath, data, 0o600); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
