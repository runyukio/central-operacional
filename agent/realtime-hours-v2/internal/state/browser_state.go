package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/fileutil"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/domain"
)

type BrowserState struct {
	SchemaVersion int       `json:"schemaVersion"`
	Browser       string    `json:"browser"`
	Domain        string    `json:"domain"`
	Focused       bool      `json:"focused"`
	Private       bool      `json:"private"`
	CapturedAt    time.Time `json:"capturedAt"`
	Source        string    `json:"source"`
}

func FileName(browser string) string {
	return "browser-state-" + NormalizeBrowser(browser) + ".json"
}

func NormalizeBrowser(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "chrome", "google chrome":
		return "chrome"
	case "msedge", "edge", "microsoft edge":
		return "msedge"
	case "brave", "brave-browser":
		return "brave"
	case "firefox":
		return "firefox"
	default:
		return ""
	}
}

func Write(dir string, state BrowserState) error {
	state.Browser = NormalizeBrowser(state.Browser)
	state.Domain = domain.NormalizeHost(state.Domain)
	if state.Browser == "" {
		return fmt.Errorf("unsupported browser")
	}
	if state.CapturedAt.IsZero() {
		state.CapturedAt = time.Now().UTC()
	}
	state.SchemaVersion = 1
	if state.Source == "" {
		state.Source = "native-messaging"
	}
	if err := os.MkdirAll(dir, 0o770); err != nil {
		return fmt.Errorf("create browser state directory: %w", err)
	}
	path := filepath.Join(dir, FileName(state.Browser))
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode browser state: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o660); err != nil {
		return fmt.Errorf("write browser state: %w", err)
	}
	if err := fileutil.Replace(tmp, path); err != nil {
		return fmt.Errorf("replace browser state: %w", err)
	}
	return nil
}

func ReadFresh(dir, browser string, now time.Time, maxAge time.Duration) (BrowserState, bool, error) {
	browser = NormalizeBrowser(browser)
	if browser == "" {
		return BrowserState{}, false, nil
	}
	data, err := os.ReadFile(filepath.Join(dir, FileName(browser)))
	if os.IsNotExist(err) {
		return BrowserState{}, false, nil
	}
	if err != nil {
		return BrowserState{}, false, fmt.Errorf("read browser state: %w", err)
	}
	var result BrowserState
	if err := json.Unmarshal(data, &result); err != nil {
		return BrowserState{}, false, fmt.Errorf("decode browser state: %w", err)
	}
	result.Browser = NormalizeBrowser(result.Browser)
	result.Domain = domain.NormalizeHost(result.Domain)
	if result.Browser != browser || !result.Focused || result.CapturedAt.IsZero() {
		return result, false, nil
	}
	age := now.UTC().Sub(result.CapturedAt.UTC())
	if age < -5*time.Second || age > maxAge {
		return result, false, nil
	}
	// A fresh private state is valid even without a domain. The caller must
	// classify it as PRIVATE and never persist the URL or hostname.
	if result.Private {
		result.Domain = ""
		return result, true, nil
	}
	if result.Domain == "" {
		return result, false, nil
	}
	return result, true, nil
}
