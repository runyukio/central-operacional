package config

import (
	"path/filepath"
	"testing"
)

func TestSaveAndLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := Default()
	cfg.DeviceID = "device-test"
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.DeviceID != cfg.DeviceID || loaded.BrowserStateMaxAgeSeconds != 45 {
		t.Fatalf("unexpected config: %+v", loaded)
	}
}

func TestValidateRejectsInsecureBaseURL(t *testing.T) {
	cfg := Default()
	cfg.BaseURL = "http://example.test"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected insecure base URL to be rejected")
	}
}
