package bootstrap

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/config"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/secret"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/transport"
)

type Options struct {
	Root        string
	Hostname    string
	User        string
	SessionID   uint32
	Version     string
	Client      *http.Client
	ReadSecret  func(string) ([]byte, error)
	WriteSecret func(string, []byte) error
}

type Result struct {
	Config  config.Config
	Path    string
	Created bool
}

func Ensure(ctx context.Context, machine config.Config, options Options) (Result, error) {
	user := NormalizeUser(options.User)
	if user == "" || options.Root == "" {
		return Result{}, fmt.Errorf("interactive user profile is unavailable")
	}
	profilePath := filepath.Join(options.Root, "config.json")
	if existing, err := config.Load(profilePath); err == nil {
		if !strings.EqualFold(existing.WindowsUser, user) {
			return Result{}, fmt.Errorf("profile belongs to a different Windows user")
		}
		existing.StateDir = filepath.Join(options.Root, "browser-state", fmt.Sprint(options.SessionID))
		existing.HeartbeatIntervalSeconds = machine.HeartbeatIntervalSeconds
		existing.UploadIntervalSeconds = machine.UploadIntervalSeconds
		existing.StatusFile = filepath.Join(options.Root, "agent-status.json")
		return Result{Config: existing, Path: profilePath}, nil
	} else if _, statErr := os.Stat(profilePath); !os.IsNotExist(statErr) {
		return Result{}, fmt.Errorf("existing user profile could not be loaded")
	}
	read := options.ReadSecret
	if read == nil {
		read = secret.ReadAndUnprotect
	}
	write := options.WriteSecret
	if write == nil {
		write = secret.ProtectForCurrentUser
	}
	plain, err := read(machine.BootstrapFile)
	if err != nil {
		return Result{}, fmt.Errorf("read machine enrollment authorization: %w", err)
	}
	defer clear(plain)
	var authorization struct {
		DeploymentCode string `json:"deploymentCode"`
	}
	if json.Unmarshal(plain, &authorization) != nil || len(authorization.DeploymentCode) != 32 {
		return Result{}, fmt.Errorf("machine enrollment authorization is invalid")
	}
	client := options.Client
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	}
	var ticket struct {
		Success bool   `json:"success"`
		Code    string `json:"enrollmentCode"`
		MaxUses int    `json:"maxUses"`
	}
	if err := post(ctx, client, machine.BaseURL+"/api/realtime-hours/v2/enrollment-ticket", map[string]string{"deploymentCode": authorization.DeploymentCode, "hostname": options.Hostname, "windowsUser": user}, &ticket); err != nil {
		return Result{}, err
	}
	if !ticket.Success || ticket.Code == "" || ticket.MaxUses != 1 {
		return Result{}, fmt.Errorf("individual enrollment ticket was not authorized")
	}
	var enrolled struct {
		Success bool   `json:"success"`
		ID      string `json:"deviceId"`
		Secret  string `json:"deviceSecret"`
	}
	if err := post(ctx, client, machine.BaseURL+"/api/realtime-hours/v2/enroll", map[string]string{"enrollmentCode": ticket.Code, "hostname": options.Hostname, "windowsUser": user, "agentVersion": options.Version}, &enrolled); err != nil {
		return Result{}, err
	}
	key, err := base64.RawURLEncoding.DecodeString(enrolled.Secret)
	if err != nil || !enrolled.Success || enrolled.ID == "" || len(key) < 32 {
		return Result{}, fmt.Errorf("individual device credential was not authorized")
	}
	defer clear(key)
	saved := false
	defer func() {
		if !saved {
			cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_, _, _ = (transport.Client{BaseURL: machine.BaseURL, DeviceID: enrolled.ID, Secret: key, HTTPClient: client}).PostJSON(cleanup, "/api/realtime-hours/v2/rollback", map[string]any{})
		}
	}()
	cfg := machine
	cfg.PerUserProfiles = false
	cfg.BootstrapFile = ""
	cfg.DeviceID = enrolled.ID
	cfg.WindowsUser = user
	cfg.SecretFile = filepath.Join(options.Root, "device-secret.dpapi")
	cfg.StateDir = filepath.Join(options.Root, "browser-state", fmt.Sprint(options.SessionID))
	cfg.QueueDir = filepath.Join(options.Root, "queue")
	cfg.FailedDir = filepath.Join(options.Root, "failed")
	cfg.LogDir = filepath.Join(options.Root, "logs")
	cfg.StatusFile = filepath.Join(options.Root, "agent-status.json")
	cfg.EnrolledAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := write(cfg.SecretFile, key); err != nil {
		return Result{}, err
	}
	if err := config.Save(profilePath, cfg); err != nil {
		return Result{}, err
	}
	saved = true
	return Result{Config: cfg, Path: profilePath, Created: true}, nil
}

func NormalizeUser(value string) string {
	value = strings.TrimSpace(value)
	if index := strings.LastIndex(value, `\`); index >= 0 {
		value = value[index+1:]
	}
	return strings.ToLower(value)
}

func post(ctx context.Context, client *http.Client, endpoint string, value any, output any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("automatic enrollment connection failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("automatic enrollment rejected (HTTP %d)", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 16*1024)).Decode(output); err != nil {
		return fmt.Errorf("automatic enrollment response is invalid")
	}
	return nil
}
