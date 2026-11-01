package bootstrap

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/config"
)

func TestProfilesRemainIsolatedAcrossUsersAndReconnects(t *testing.T) {
	tickets := map[string]string{}
	requests := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.HasSuffix(r.URL.Path, "enrollment-ticket") {
			code := fmt.Sprintf("%032d", requests)
			tickets[code] = body["windowsUser"]
			if body["deploymentCode"] != strings.Repeat("A", 32) {
				t.Error("wrong deployment authorization")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "enrollmentCode": code, "maxUses": 1})
		} else {
			if tickets[body["enrollmentCode"]] != body["windowsUser"] {
				t.Error("ticket identity changed")
			}
			key := []byte(strings.Repeat(body["windowsUser"][:1], 32))
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "deviceId": "device-" + body["windowsUser"], "deviceSecret": base64.RawURLEncoding.EncodeToString(key)})
		}
	}))
	defer server.Close()
	machine := config.Default()
	machine.BaseURL = server.URL
	machine.PerUserProfiles = true
	machine.WindowsUser = "installing-admin"
	options := Options{Root: filepath.Join(t.TempDir(), "alice"), Hostname: "SHARED-PC", User: `DOMAIN\Alice`, SessionID: 1, Version: "test", Client: server.Client(),
		ReadSecret: func(string) ([]byte, error) {
			return []byte(`{"deploymentCode":"` + strings.Repeat("A", 32) + `"}`), nil
		},
		WriteSecret: func(path string, key []byte) error {
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return err
			}
			return os.WriteFile(path, key, 0o600)
		}}
	alice, err := Ensure(context.Background(), machine, options)
	if err != nil {
		t.Fatal(err)
	}
	if !alice.Created || alice.Config.WindowsUser != "alice" {
		t.Fatal("interactive user was not used")
	}
	_ = os.MkdirAll(alice.Config.QueueDir, 0o700)
	_ = os.WriteFile(filepath.Join(alice.Config.QueueDir, "offline.json"), []byte("alice offline event"), 0o600)
	bobOptions := options
	bobOptions.Root = filepath.Join(t.TempDir(), "bob")
	bobOptions.User = `DOMAIN\Bob`
	bobOptions.SessionID = 2
	bob, err := Ensure(context.Background(), machine, bobOptions)
	if err != nil {
		t.Fatal(err)
	}
	if bob.Config.DeviceID == alice.Config.DeviceID || bob.Config.SecretFile == alice.Config.SecretFile || bob.Config.StateDir == alice.Config.StateDir || bob.Config.QueueDir == alice.Config.QueueDir {
		t.Fatal("users share identity, browser state or queue")
	}
	options.SessionID = 9
	resumed, err := Ensure(context.Background(), machine, options)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.Created || requests != 4 || resumed.Config.DeviceID != alice.Config.DeviceID {
		t.Fatal("reconnect should reuse the same user's credential without new enrollment")
	}
	if resumed.Config.StateDir == alice.Config.StateDir {
		t.Fatal("browser state from an old session was reused")
	}
	if data, err := os.ReadFile(filepath.Join(resumed.Config.QueueDir, "offline.json")); err != nil || string(data) != "alice offline event" {
		t.Fatal("offline queue was not preserved")
	}
	bobOptions.Root = options.Root
	if _, err := Ensure(context.Background(), machine, bobOptions); err == nil {
		t.Fatal("a profile belonging to another user must be rejected")
	}
}

func TestEnrollmentRollbackAfterLocalProtectionFailure(t *testing.T) {
	rolledBack := false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "enrollment-ticket"):
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "enrollmentCode": strings.Repeat("T", 32), "maxUses": 1})
		case strings.HasSuffix(r.URL.Path, "/enroll"):
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "deviceId": "pending-test-device", "deviceSecret": base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("K", 32)))})
		case strings.HasSuffix(r.URL.Path, "/rollback"):
			rolledBack = r.Header.Get("X-RH-Device-Id") == "pending-test-device" && r.Header.Get("X-RH-Signature") != ""
			_, _ = w.Write([]byte(`{"success":true}`))
		}
	}))
	defer server.Close()
	machine := config.Default()
	machine.BaseURL = server.URL
	root := t.TempDir()
	_, err := Ensure(context.Background(), machine, Options{Root: root, User: "test", Hostname: "TEST-PC", Version: "test", Client: server.Client(), ReadSecret: func(string) ([]byte, error) {
		return []byte(`{"deploymentCode":"` + strings.Repeat("A", 32) + `"}`), nil
	}, WriteSecret: func(string, []byte) error { return fmt.Errorf("DPAPI unavailable") }})
	if err == nil || !rolledBack {
		t.Fatal("a local failure must revoke the pending credential")
	}
	if _, err := os.Stat(filepath.Join(root, "config.json")); !os.IsNotExist(err) {
		t.Fatal("failed enrollment left an active profile")
	}
}
