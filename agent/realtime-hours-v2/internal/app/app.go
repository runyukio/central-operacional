package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/config"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/platform"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/queue"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/secret"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/segment"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/state"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/transport"
)

const Version = "1.0.0-alpha.1"

type Runtime struct {
	Config     config.Config
	ConfigPath string
	DeviceKey  []byte
	Logger     *log.Logger
	Queue      queue.Queue
	Client     transport.Client
	Hostname   string
	User       string
	Tracker    *segment.Tracker
	mu         sync.Mutex
}

type HeartbeatPayload struct {
	SchemaVersion   int       `json:"schemaVersion"`
	AgentVersion    string    `json:"agentVersion"`
	CapturedAt      time.Time `json:"capturedAt"`
	Hostname        string    `json:"hostname"`
	WindowsUser     string    `json:"windowsUser"`
	WBLogin         string    `json:"wbLogin,omitempty"`
	SessionState    string    `json:"sessionState"`
	IdleSeconds     int       `json:"idleSeconds"`
	ActiveProcess   string    `json:"activeProcessName,omitempty"`
	CurrentType     string    `json:"currentType,omitempty"`
	CurrentDomain   string    `json:"currentDomain,omitempty"`
	DetectionMethod string    `json:"detectionMethod,omitempty"`
}

type ActivityPayload struct {
	SchemaVersion int               `json:"schemaVersion"`
	AgentVersion  string            `json:"agentVersion"`
	CapturedAt    time.Time         `json:"capturedAt"`
	Hostname      string            `json:"hostname"`
	WindowsUser   string            `json:"windowsUser"`
	WBLogin       string            `json:"wbLogin,omitempty"`
	Records       []segment.Segment `json:"records"`
}

type DiagnoseResult struct {
	Success       bool            `json:"success"`
	AgentVersion  string          `json:"agentVersion"`
	ConfigPath    string          `json:"configPath"`
	Hostname      string          `json:"hostname"`
	WindowsUser   string          `json:"windowsUser"`
	Foreground    string          `json:"foreground"`
	Context       segment.Context `json:"context"`
	QueueCounts   map[string]int  `json:"queueCounts"`
	StateDir      string          `json:"stateDir"`
	DeviceID      string          `json:"deviceId"`
	CredentialOK  bool            `json:"credentialOk"`
	DiagnosticUTC time.Time       `json:"diagnosticUtc"`
	Error         string          `json:"error,omitempty"`
}

func New(cfg config.Config, configPath string) (*Runtime, error) {
	hostname, _ := os.Hostname()
	user := strings.TrimSpace(os.Getenv("USERNAME"))
	if user == "" {
		user = strings.TrimSpace(os.Getenv("USER"))
	}
	key, err := secret.ReadAndUnprotect(cfg.SecretFile)
	if err != nil {
		return nil, err
	}
	if len(key) < 32 {
		return nil, fmt.Errorf("device secret must contain at least 32 bytes")
	}
	if strings.TrimSpace(cfg.DeviceID) == "" {
		return nil, fmt.Errorf("deviceId is not configured")
	}
	for _, dir := range []string{cfg.StateDir, cfg.QueueDir, cfg.FailedDir, cfg.LogDir} {
		if err := os.MkdirAll(dir, 0o770); err != nil {
			return nil, fmt.Errorf("create runtime directory %s: %w", dir, err)
		}
	}
	logFile, err := os.OpenFile(filepath.Join(cfg.LogDir, "agent-v2.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o660)
	if err != nil {
		return nil, fmt.Errorf("open log: %w", err)
	}
	logger := log.New(logFile, "", log.Ldate|log.Ltime|log.LUTC|log.Lmicroseconds)
	return &Runtime{
		Config:     cfg,
		ConfigPath: configPath,
		DeviceKey:  key,
		Logger:     logger,
		Queue:      queue.Queue{Root: cfg.QueueDir, FailedDir: cfg.FailedDir},
		Client: transport.Client{
			BaseURL:  cfg.BaseURL,
			DeviceID: cfg.DeviceID,
			Secret:   key,
		},
		Hostname: hostname,
		User:     strings.ToLower(user),
		Tracker:  segment.New(time.Duration(cfg.MaxSegmentSeconds) * time.Second),
	}, nil
}

func (r *Runtime) RunDaemon(ctx context.Context) error {
	r.Logger.Printf("agent %s started in daemon mode", Version)
	sampleTicker := time.NewTicker(time.Duration(r.Config.SampleIntervalSeconds) * time.Second)
	heartbeatTicker := time.NewTicker(time.Duration(r.Config.HeartbeatIntervalSeconds) * time.Second)
	uploadTicker := time.NewTicker(time.Duration(r.Config.UploadIntervalSeconds) * time.Second)
	defer sampleTicker.Stop()
	defer heartbeatTicker.Stop()
	defer uploadTicker.Stop()

	lastContext, err := r.SampleContext(time.Now().UTC())
	if err != nil {
		r.Logger.Printf("initial context error: %v", err)
		lastContext = segment.Context{Type: segment.TypeUnknown}
	}
	_ = r.Tracker.Update(lastContext, time.Now().UTC())
	_ = r.enqueueHeartbeat(lastContext, time.Now().UTC())
	_ = r.flush(ctx, "heartbeat")

	for {
		select {
		case <-ctx.Done():
			if closed := r.Tracker.Flush(time.Now().UTC()); closed != nil {
				_ = r.enqueueActivity([]segment.Segment{*closed})
			}
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = r.flush(shutdownCtx, "activity")
			cancel()
			r.Logger.Printf("agent stopped: %v", ctx.Err())
			return ctx.Err()
		case now := <-sampleTicker.C:
			current, err := r.SampleContext(now.UTC())
			if err != nil {
				r.Logger.Printf("sample context error: %v", err)
				continue
			}
			closed := r.Tracker.Update(current, now.UTC())
			if len(closed) > 0 {
				if err := r.enqueueActivity(closed); err != nil {
					r.Logger.Printf("enqueue closed activity error: %v", err)
				}
			}
			lastContext = current
		case now := <-heartbeatTicker.C:
			if err := r.enqueueHeartbeat(lastContext, now.UTC()); err != nil {
				r.Logger.Printf("enqueue heartbeat error: %v", err)
			}
			if err := r.flush(ctx, "heartbeat"); err != nil {
				r.Logger.Printf("flush heartbeat error: %v", err)
			}
		case <-uploadTicker.C:
			if snapshot := r.Tracker.Snapshot(time.Now().UTC()); snapshot != nil {
				if err := r.enqueueActivity([]segment.Segment{*snapshot}); err != nil {
					r.Logger.Printf("enqueue activity snapshot error: %v", err)
				}
			}
			if err := r.flush(ctx, "activity"); err != nil {
				r.Logger.Printf("flush activity error: %v", err)
			}
		}
	}
}

func (r *Runtime) RunOnce(ctx context.Context) error {
	now := time.Now().UTC()
	current, err := r.SampleContext(now)
	if err != nil {
		return err
	}
	if err := r.enqueueHeartbeat(current, now); err != nil {
		return err
	}
	r.Tracker.Update(current, now)
	timer := time.NewTimer(time.Duration(r.Config.SampleIntervalSeconds) * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
	}
	if snapshot := r.Tracker.Snapshot(time.Now().UTC()); snapshot != nil {
		if err := r.enqueueActivity([]segment.Segment{*snapshot}); err != nil {
			return err
		}
	}
	if err := r.flush(ctx, "heartbeat"); err != nil {
		return err
	}
	return r.flush(ctx, "activity")
}

func (r *Runtime) SampleContext(now time.Time) (segment.Context, error) {
	foreground, err := platform.Snapshot()
	if err != nil {
		return segment.Context{}, err
	}
	if foreground.Locked {
		return segment.Context{Type: segment.TypeLocked, Method: "windows-session"}, nil
	}
	if foreground.IdleFor >= time.Duration(r.Config.IdleThresholdSeconds)*time.Second {
		return segment.Context{Type: segment.TypeIdle, Method: "windows-last-input"}, nil
	}
	processName := strings.ToLower(strings.TrimSpace(foreground.ProcessName))
	if processName == "" {
		return segment.Context{Type: segment.TypeUnknown, Method: "foreground-process"}, nil
	}
	browser := state.NormalizeBrowser(processName)
	if browser != "" {
		browserState, fresh, readErr := state.ReadFresh(
			r.Config.StateDir,
			browser,
			now.UTC(),
			time.Duration(r.Config.BrowserStateMaxAgeSeconds)*time.Second,
		)
		if readErr != nil {
			r.Logger.Printf("read browser state error: %v", readErr)
		}
		if fresh && browserState.Private {
			return segment.Context{Type: segment.TypePrivate, Application: processName, Method: "browser-extension"}, nil
		}
		if fresh {
			return segment.Context{
				Type:        segment.TypeWeb,
				Application: processName,
				Domain:      browserState.Domain,
				Method:      "browser-extension",
			}, nil
		}
	}
	return segment.Context{Type: segment.TypeApp, Application: processName, Method: "foreground-process"}, nil
}

func (r *Runtime) Diagnose() DiagnoseResult {
	result := DiagnoseResult{
		Success:       true,
		AgentVersion:  Version,
		ConfigPath:    r.ConfigPath,
		Hostname:      r.Hostname,
		WindowsUser:   r.User,
		StateDir:      r.Config.StateDir,
		DeviceID:      r.Config.DeviceID,
		CredentialOK:  len(r.DeviceKey) >= 32,
		DiagnosticUTC: time.Now().UTC(),
		QueueCounts:   map[string]int{},
	}
	foreground, err := platform.Snapshot()
	if err != nil {
		result.Success = false
		result.Error = err.Error()
		return result
	}
	result.Foreground = foreground.ProcessName
	ctx, err := r.SampleContext(time.Now().UTC())
	if err != nil {
		result.Success = false
		result.Error = err.Error()
		return result
	}
	result.Context = ctx
	for _, kind := range []string{"heartbeat", "activity"} {
		items, listErr := r.Queue.List(kind, 10_000)
		if listErr != nil {
			result.Success = false
			result.Error = listErr.Error()
			return result
		}
		result.QueueCounts[kind] = len(items)
	}
	return result
}

func (r *Runtime) enqueueHeartbeat(current segment.Context, now time.Time) error {
	foreground, _ := platform.Snapshot()
	stateValue := "ACTIVE"
	if current.Type == segment.TypeLocked {
		stateValue = "LOCKED"
	} else if current.Type == segment.TypeIdle {
		stateValue = "IDLE"
	}
	payload := HeartbeatPayload{
		SchemaVersion:   2,
		AgentVersion:    Version,
		CapturedAt:      now.UTC(),
		Hostname:        r.Hostname,
		WindowsUser:     r.User,
		WBLogin:         r.User,
		SessionState:    stateValue,
		IdleSeconds:     int(foreground.IdleFor.Round(time.Second).Seconds()),
		ActiveProcess:   foreground.ProcessName,
		CurrentType:     string(current.Type),
		CurrentDomain:   current.Domain,
		DetectionMethod: current.Method,
	}
	_, err := r.Queue.Upsert("heartbeat", "current", payload)
	return err
}

func (r *Runtime) enqueueActivity(records []segment.Segment) error {
	for _, record := range records {
		payload := ActivityPayload{
			SchemaVersion: 2,
			AgentVersion:  Version,
			CapturedAt:    time.Now().UTC(),
			Hostname:      r.Hostname,
			WindowsUser:   r.User,
			WBLogin:       r.User,
			Records:       []segment.Segment{record},
		}
		if _, err := r.Queue.Upsert("activity", record.EventID, payload); err != nil {
			return err
		}
	}
	return nil
}

func (r *Runtime) flush(ctx context.Context, kind string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	items, err := r.Queue.List(kind, 100)
	if err != nil {
		return err
	}
	path := "/api/realtime-hours/v2/heartbeat"
	if kind == "activity" {
		path = "/api/realtime-hours/v2/activity"
	}
	for _, item := range items {
		var payload any
		if err := json.Unmarshal(item.Data, &payload); err != nil {
			_ = r.Queue.Quarantine(kind, item.Path)
			continue
		}
		status, body, postErr := r.Client.PostJSON(ctx, path, payload)
		if postErr != nil {
			return postErr
		}
		if status >= 200 && status < 300 {
			var acknowledgement struct {
				Success bool `json:"success"`
			}
			if err := json.Unmarshal(body, &acknowledgement); err != nil || !acknowledgement.Success {
				return fmt.Errorf("%s upload did not receive a success acknowledgement", kind)
			}
			if err := r.Queue.Remove(item.Path); err != nil {
				return err
			}
			continue
		}
		if status >= 400 && status < 500 && status != 408 && status != 429 {
			r.Logger.Printf("permanent %s rejection status=%d body=%s", kind, status, strings.TrimSpace(string(body)))
			if err := r.Queue.Quarantine(kind, item.Path); err != nil {
				return err
			}
			return fmt.Errorf("%s upload rejected: status=%d", kind, status)
		}
		return fmt.Errorf("temporary %s upload failure: status=%d body=%s", kind, status, strings.TrimSpace(string(body)))
	}
	return nil
}
