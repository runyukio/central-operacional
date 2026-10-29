package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/fileutil"
	"strings"
	"time"
)

const SchemaVersion = 1

type Config struct {
	SchemaVersion             int    `json:"schemaVersion"`
	BaseURL                   string `json:"baseUrl"`
	DeviceID                  string `json:"deviceId"`
	WindowsUser               string `json:"windowsUser,omitempty"`
	SecretFile                string `json:"secretFile"`
	StateDir                  string `json:"stateDir"`
	QueueDir                  string `json:"queueDir"`
	FailedDir                 string `json:"failedDir"`
	LogDir                    string `json:"logDir"`
	SampleIntervalSeconds     int    `json:"sampleIntervalSeconds"`
	HeartbeatIntervalSeconds  int    `json:"heartbeatIntervalSeconds"`
	UploadIntervalSeconds     int    `json:"uploadIntervalSeconds"`
	IdleThresholdSeconds      int    `json:"idleThresholdSeconds"`
	MaxSegmentSeconds         int    `json:"maxSegmentSeconds"`
	BrowserStateMaxAgeSeconds int    `json:"browserStateMaxAgeSeconds"`
}

func DefaultRoot() string {
	if runtime.GOOS == "windows" {
		if programData := strings.TrimSpace(os.Getenv("ProgramData")); programData != "" {
			return filepath.Join(programData, "CentralOperacional", "RealtimeHoursV2")
		}
		return `C:\ProgramData\CentralOperacional\RealtimeHoursV2`
	}
	return filepath.Join(os.TempDir(), "central-operacional", "realtime-hours-v2")
}

func DefaultPath() string { return filepath.Join(DefaultRoot(), "config.json") }

func Default() Config {
	root := DefaultRoot()
	return Config{
		SchemaVersion:             SchemaVersion,
		BaseURL:                   "https://eastriverbrasil.com",
		SecretFile:                filepath.Join(root, "device-secret.dpapi"),
		StateDir:                  filepath.Join(root, "browser-state"),
		QueueDir:                  filepath.Join(root, "queue"),
		FailedDir:                 filepath.Join(root, "failed"),
		LogDir:                    filepath.Join(root, "logs"),
		SampleIntervalSeconds:     2,
		HeartbeatIntervalSeconds:  300,
		UploadIntervalSeconds:     300,
		IdleThresholdSeconds:      300,
		MaxSegmentSeconds:         3600,
		BrowserStateMaxAgeSeconds: 45,
	}
}

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	cfg := Default()
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func Save(path string, cfg Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o640); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	if err := fileutil.Replace(tmp, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	return nil
}

func (c Config) Validate() error {
	if c.SchemaVersion != SchemaVersion {
		return fmt.Errorf("unsupported config schema version %d", c.SchemaVersion)
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(c.BaseURL)), "https://") {
		return errors.New("baseUrl must use https")
	}
	if c.SampleIntervalSeconds < 1 || c.SampleIntervalSeconds > 30 {
		return errors.New("sampleIntervalSeconds must be between 1 and 30")
	}
	if c.HeartbeatIntervalSeconds < 60 || c.HeartbeatIntervalSeconds > 1800 {
		return errors.New("heartbeatIntervalSeconds must be between 60 and 1800")
	}
	if c.UploadIntervalSeconds < 30 || c.UploadIntervalSeconds > 1800 {
		return errors.New("uploadIntervalSeconds must be between 30 and 1800")
	}
	if c.IdleThresholdSeconds < 60 || c.IdleThresholdSeconds > 3600 {
		return errors.New("idleThresholdSeconds must be between 60 and 3600")
	}
	if c.MaxSegmentSeconds < 300 || c.MaxSegmentSeconds > int((24*time.Hour).Seconds()) {
		return errors.New("maxSegmentSeconds must be between 300 and 86400")
	}
	if c.BrowserStateMaxAgeSeconds < 5 || c.BrowserStateMaxAgeSeconds > 120 {
		return errors.New("browserStateMaxAgeSeconds must be between 5 and 120")
	}
	for name, value := range map[string]string{
		"secretFile": c.SecretFile,
		"stateDir":   c.StateDir,
		"queueDir":   c.QueueDir,
		"failedDir":  c.FailedDir,
		"logDir":     c.LogDir,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required", name)
		}
	}
	return nil
}
