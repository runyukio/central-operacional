package app

import (
	"context"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/queue"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/transport"
)

func TestUploadAcknowledgementAndOfflineRecovery(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		status               int
		body                 string
		wantErr, quarantined bool
	}{
		{"accepted", 200, `{"success":true}`, false, false},
		{"unauthorized", 401, `{"success":false}`, true, true},
		{"refused-with-200", 200, `{"success":false}`, true, false},
		{"login-html", 200, `<html>Sign in</html>`, true, false},
		{"offline", 503, `unavailable`, true, false},
		{"throttled", 429, `retry`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := tc.status, tc.body
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				_, _ = io.WriteString(w, body)
			}))
			defer server.Close()
			dir := t.TempDir()
			r := &Runtime{Queue: queue.Queue{Root: filepath.Join(dir, "queue"), FailedDir: filepath.Join(dir, "failed")},
				Client: transport.Client{BaseURL: server.URL, DeviceID: "test-device", Secret: []byte("01234567890123456789012345678901"), HTTPClient: server.Client()},
				Logger: log.New(io.Discard, "", 0)}
			if _, err := r.Queue.Upsert("heartbeat", "current", map[string]bool{"ok": true}); err != nil {
				t.Fatal(err)
			}
			err := r.flush(context.Background(), "heartbeat")
			if (err != nil) != tc.wantErr {
				t.Fatalf("err=%v wantErr=%v", err, tc.wantErr)
			}
			pending, err := r.Queue.List("heartbeat", 100)
			if err != nil {
				t.Fatal(err)
			}
			retained := tc.wantErr && !tc.quarantined
			if (len(pending) == 1) != retained {
				t.Fatalf("pending=%d wantRetained=%v", len(pending), retained)
			}
			if retained {
				status, body = 200, `{"success":true}`
				if err := r.flush(context.Background(), "heartbeat"); err != nil {
					t.Fatal(err)
				}
				pending, _ = r.Queue.List("heartbeat", 100)
				if len(pending) != 0 {
					t.Fatal("queue was not drained after recovery")
				}
			}
		})
	}
}
