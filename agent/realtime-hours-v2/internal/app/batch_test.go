package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/config"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/queue"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/segment"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/transport"
)

func activityTestPayload(id int) ActivityPayload {
	start := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC).Add(time.Duration(id) * time.Minute)
	return ActivityPayload{SchemaVersion: 2, AgentVersion: Version, CapturedAt: start.Add(time.Minute),
		Hostname: "TEST-PC", WindowsUser: "test", WBLogin: "test",
		Records: []segment.Segment{{EventID: fmt.Sprintf("event-%020d", id), SourceType: segment.TypeWeb,
			Domain: "example.com", ApplicationName: "chrome.exe", DetectionMethod: "browser-extension",
			StartedAt: start, EndedAt: start.Add(time.Minute), DurationSeconds: 60}}}
}

func uploadRuntime(t *testing.T, handler http.HandlerFunc) (*Runtime, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	root := t.TempDir()
	r := &Runtime{Queue: queue.Queue{Root: filepath.Join(root, "queue"), FailedDir: filepath.Join(root, "failed")},
		Logger:   log.New(io.Discard, "", 0),
		Hostname: "TEST-PC", User: "test",
		Client: transport.Client{BaseURL: server.URL, DeviceID: "test-device",
			Secret: []byte("01234567890123456789012345678901"), HTTPClient: server.Client()}}
	return r, server
}

func enqueueActivityTest(t *testing.T, r *Runtime, payload ActivityPayload) {
	t.Helper()
	r.queueMu.Lock()
	defer r.queueMu.Unlock()
	if _, err := r.Queue.Upsert("activity", payload.Records[0].EventID, payload); err != nil {
		t.Fatal(err)
	}
}

func acknowledgeActivity(t *testing.T, w http.ResponseWriter, request *http.Request) ActivityPayload {
	t.Helper()
	var payload ActivityPayload
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		t.Error(err)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "recordsProcessed": len(payload.Records)})
	return payload
}

func TestActivityBatchPreservesRecordsAndEnvelope(t *testing.T) {
	var received []ActivityPayload
	r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		received = append(received, acknowledgeActivity(t, w, request))
	})
	for i := 0; i < 10; i++ {
		enqueueActivityTest(t, r, activityTestPayload(i))
	}
	if err := r.flush(context.Background(), "activity"); err != nil {
		t.Fatal(err)
	}
	if len(received) != 1 || len(received[0].Records) != 10 {
		t.Fatalf("requests=%d, expected one complete 10-record batch", len(received))
	}
	for i, record := range received[0].Records {
		if !reflect.DeepEqual(record, activityTestPayload(i).Records[0]) {
			t.Fatalf("record %d changed while batching", i)
		}
	}
	if received[0].CapturedAt != activityTestPayload(9).CapturedAt || received[0].AgentVersion != Version ||
		received[0].Hostname != "TEST-PC" || received[0].WindowsUser != "test" {
		t.Fatal("batch identity/version or latest capture timestamp changed")
	}
	pending, _ := r.Queue.List("activity", 0)
	if len(pending) != 0 {
		t.Fatal("acknowledged batch not removed")
	}
}

func TestActivityBatchRespectsRecordCountAndByteLimits(t *testing.T) {
	t.Run("records", func(t *testing.T) {
		var sizes []int
		r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
			payload := acknowledgeActivity(t, w, request)
			sizes = append(sizes, len(payload.Records))
		})
		for i := 0; i < 501; i++ {
			enqueueActivityTest(t, r, activityTestPayload(i))
		}
		if err := r.flush(context.Background(), "activity"); err != nil {
			t.Fatal(err)
		}
		if err := r.flush(context.Background(), "activity"); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(sizes, []int{500, 1}) {
			t.Fatalf("batch record counts %v", sizes)
		}
	})
	t.Run("encoded-bytes", func(t *testing.T) {
		calls, records := 0, 0
		r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
			body, _ := io.ReadAll(request.Body)
			if len(body) > maxActivityBatchBytes {
				t.Errorf("body exceeds server limit: %d", len(body))
			}
			var payload ActivityPayload
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Error(err)
			}
			calls++
			records += len(payload.Records)
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "recordsProcessed": len(payload.Records)})
		})
		for i := 0; i < 500; i++ {
			payload := activityTestPayload(i)
			record := &payload.Records[0]
			record.SourceType, record.Domain = segment.TypeApp, ""
			// Valid bounded strings expand when JSON escapes U+2028.
			record.ApplicationName = strings.Repeat("\u2028", 120)
			record.DetectionMethod = strings.Repeat("\u2028", 80)
			enqueueActivityTest(t, r, payload)
		}
		if err := r.flush(context.Background(), "activity"); err != nil {
			t.Fatal(err)
		}
		if calls < 2 || records != 500 {
			t.Fatalf("calls=%d records=%d; byte limit did not split losslessly", calls, records)
		}
	})
}

func TestActivityBatchDoesNotMixProfilesOrAgentVersions(t *testing.T) {
	var received []ActivityPayload
	r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		received = append(received, acknowledgeActivity(t, w, request))
	})
	first := activityTestPayload(0)
	second := activityTestPayload(1)
	second.AgentVersion = "1.0.0-alpha.2"
	third := activityTestPayload(2)
	third.WindowsUser, third.WBLogin = "other", "other"
	for _, payload := range []ActivityPayload{first, second, third} {
		enqueueActivityTest(t, r, payload)
	}
	if err := r.flush(context.Background(), "activity"); err != nil {
		t.Fatal(err)
	}
	if len(received) != 3 || received[1].AgentVersion != second.AgentVersion ||
		received[2].WindowsUser != "other" {
		t.Fatal("incompatible stored envelopes were mixed")
	}
}

func TestActivityPartialAcknowledgementRetainsWholeBatchAndBacksOff(t *testing.T) {
	for _, body := range []string{`{"success":true,"recordsProcessed":1}`, `{"success":true}`, `{"success":false}`, "<html>Login</html>"} {
		t.Run(body, func(t *testing.T) {
			calls := 0
			response := body
			now := time.Now().UTC()
			r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
				calls++
				_, _ = io.WriteString(w, response)
			})
			r.uploadNow = func() time.Time { return now }
			enqueueActivityTest(t, r, activityTestPayload(1))
			enqueueActivityTest(t, r, activityTestPayload(2))
			if err := r.flush(context.Background(), "activity"); err == nil {
				t.Fatal("incomplete acknowledgement accepted")
			}
			pending, _ := r.Queue.List("activity", 0)
			if len(pending) != 2 {
				t.Fatal("unacknowledged items removed")
			}
			if err := r.flush(context.Background(), "activity"); err != nil || calls != 1 {
				t.Fatal("backoff did not prevent an immediate retry")
			}
			now = now.Add(31 * time.Second)
			response = `{"success":true,"recordsProcessed":2}`
			if err := r.flush(context.Background(), "activity"); err != nil {
				t.Fatal(err)
			}
			pending, _ = r.Queue.List("activity", 0)
			if len(pending) != 0 {
				t.Fatal("offline batch did not recover")
			}
		})
	}
}

func TestActivityPermanentRejectionIsolatesPoisonItem(t *testing.T) {
	var delivered []string
	r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		var payload ActivityPayload
		_ = json.NewDecoder(request.Body).Decode(&payload)
		for _, record := range payload.Records {
			if record.EventID == activityTestPayload(1).Records[0].EventID {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
		}
		for _, record := range payload.Records {
			delivered = append(delivered, record.EventID)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "recordsProcessed": len(payload.Records)})
	})
	for i := 0; i < 3; i++ {
		enqueueActivityTest(t, r, activityTestPayload(i))
	}
	if err := r.flush(context.Background(), "activity"); err == nil {
		t.Fatal("quarantined poison item was not reported")
	}
	pending, _ := r.Queue.List("activity", 0)
	failed := queue.Queue{Root: r.Queue.FailedDir}
	quarantined, _ := failed.List("activity", 0)
	if len(pending) != 0 || len(quarantined) != 1 || len(delivered) != 2 {
		t.Fatalf("pending=%d quarantined=%d delivered=%d", len(pending), len(quarantined), len(delivered))
	}
}

func TestActivityRetryableFailuresKeepAllItems(t *testing.T) {
	for _, status := range []int{401, 403, 404, 408, 409, 429, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
				w.WriteHeader(status)
			})
			enqueueActivityTest(t, r, activityTestPayload(1))
			enqueueActivityTest(t, r, activityTestPayload(2))
			if err := r.flush(context.Background(), "activity"); err == nil {
				t.Fatal("failure accepted")
			}
			pending, _ := r.Queue.List("activity", 0)
			if len(pending) != 2 {
				t.Fatal("retryable batch was discarded")
			}
		})
	}
}

func TestActivityBatchKeepsNewerCheckpointAfterAcknowledgement(t *testing.T) {
	var r *Runtime
	first := activityTestPayload(1)
	updated := activityTestPayload(1)
	updated.Records[0].EndedAt = updated.Records[0].EndedAt.Add(10 * time.Second)
	updated.Records[0].DurationSeconds += 10
	calls := 0
	r, _ = uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		calls++
		if calls == 1 {
			enqueueActivityTest(t, r, updated)
		}
		acknowledgeActivity(t, w, request)
	})
	enqueueActivityTest(t, r, first)
	enqueueActivityTest(t, r, activityTestPayload(2))
	if err := r.flush(context.Background(), "activity"); err != nil {
		t.Fatal(err)
	}
	pending, _ := r.Queue.List("activity", 0)
	if len(pending) != 1 {
		t.Fatal("newer in-flight checkpoint was removed")
	}
	var payload ActivityPayload
	_ = json.Unmarshal(pending[0].Data, &payload)
	if payload.Records[0].DurationSeconds != 70 {
		t.Fatal("newer checkpoint changed")
	}
	if err := r.flush(context.Background(), "activity"); err != nil {
		t.Fatal(err)
	}
	pending, _ = r.Queue.List("activity", 0)
	if len(pending) != 0 {
		t.Fatal("latest checkpoint did not drain")
	}
}

func TestHeartbeatIsPrioritizedBetweenActivityBatches(t *testing.T) {
	var r *Runtime
	var sequence []string
	activities := 0
	r, _ = uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/heartbeat") {
			sequence = append(sequence, "heartbeat")
			_, _ = io.WriteString(w, `{"success":true}`)
			return
		}
		sequence = append(sequence, "activity")
		activities++
		if activities == 1 {
			r.queueMu.Lock()
			_, err := r.Queue.Upsert("heartbeat", "current", map[string]bool{"ok": true})
			r.queueMu.Unlock()
			if err != nil {
				t.Error(err)
			}
		}
		acknowledgeActivity(t, w, request)
	})
	_, _ = r.Queue.Upsert("heartbeat", "current", map[string]bool{"ok": true})
	enqueueActivityTest(t, r, activityTestPayload(1))
	second := activityTestPayload(2)
	second.AgentVersion = "previous"
	enqueueActivityTest(t, r, second)
	if err := r.flush(context.Background(), "activity"); err != nil {
		t.Fatal(err)
	}
	want := []string{"heartbeat", "activity", "heartbeat", "activity"}
	if !reflect.DeepEqual(sequence, want) {
		t.Fatalf("sequence %v, want %v", sequence, want)
	}
}

func TestRetryAfterIsRespectedWithoutLosingQueuedActivity(t *testing.T) {
	now := time.Now().UTC()
	calls := 0
	r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		calls++
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	r.uploadNow = func() time.Time { return now }
	enqueueActivityTest(t, r, activityTestPayload(1))
	if err := r.flush(context.Background(), "activity"); err == nil {
		t.Fatal("throttle not reported")
	}
	now = now.Add(time.Minute)
	if err := r.flush(context.Background(), "activity"); err != nil || calls != 1 {
		t.Fatal("server retry deadline ignored")
	}
	now = now.Add(time.Minute + time.Second)
	_ = r.flush(context.Background(), "activity")
	if calls != 2 {
		t.Fatal("retry did not resume after deadline")
	}
}

func TestOpenCheckpointCadenceKeepsClosedActivityAndLocalRecovery(t *testing.T) {
	now := time.Now().UTC()
	var received []ActivityPayload
	r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		if strings.Contains(string(body), "_openCheckpoint") {
			t.Error("local queue metadata leaked into the strict HTTP contract")
		}
		var payload ActivityPayload
		_ = json.Unmarshal(body, &payload)
		received = append(received, payload)
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "recordsProcessed": len(payload.Records)})
	})
	r.uploadNow = func() time.Time { return now }
	r.Config.OpenCheckpointUploadIntervalSeconds = 60
	open := activityTestPayload(1)
	if err := r.enqueueObservedActivity(open.Records, open.Records[0].EventID); err != nil {
		t.Fatal(err)
	}
	if err := r.flush(context.Background(), "activity"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(30 * time.Second)
	open.Records[0].DurationSeconds += 30
	open.Records[0].EndedAt = open.Records[0].EndedAt.Add(30 * time.Second)
	_ = r.enqueueObservedActivity(open.Records, open.Records[0].EventID)
	if err := r.flush(context.Background(), "activity"); err != nil || len(received) != 1 {
		t.Fatal("open checkpoint sent before the configured interval")
	}
	// Completed intervals remain eligible on the ordinary upload cadence.
	closed := activityTestPayload(2)
	_ = r.enqueueActivity(closed.Records)
	if err := r.flush(context.Background(), "activity"); err != nil || len(received) != 2 ||
		received[1].Records[0].EventID != closed.Records[0].EventID {
		t.Fatal("deferred open checkpoint blocked a completed interval")
	}
	pending, _ := r.Queue.List("activity", 0)
	if len(pending) != 1 {
		t.Fatal("open checkpoint was not persisted locally")
	}
	var stored ActivityPayload
	_ = json.Unmarshal(pending[0].Data, &stored)
	if !isOpenCheckpoint(pending[0]) || stored.Records[0].DurationSeconds != 90 {
		t.Fatal("local checkpoint lost newly observed time")
	}
	now = now.Add(30 * time.Second)
	if err := r.flush(context.Background(), "activity"); err != nil || len(received) != 3 ||
		received[2].Records[0].DurationSeconds != 90 {
		t.Fatal("deferred checkpoint did not arrive when due")
	}
	// A closing update to the same event bypasses the open-only interval.
	closedOpen := open.Records[0]
	closedOpen.DurationSeconds += 2
	closedOpen.EndedAt = closedOpen.EndedAt.Add(2 * time.Second)
	_ = r.enqueueActivity([]segment.Segment{closedOpen})
	if err := r.flush(context.Background(), "activity"); err != nil || len(received) != 4 {
		t.Fatal("closing update waited for another open checkpoint interval")
	}
	// A crash/restart does not need an in-memory timer to recover persisted work.
	_ = r.enqueueObservedActivity(open.Records, open.Records[0].EventID)
	restarted := &Runtime{Config: r.Config, Queue: r.Queue, Client: r.Client, Logger: r.Logger, uploadNow: r.uploadNow}
	if err := restarted.flush(context.Background(), "activity"); err != nil || len(received) != 5 {
		t.Fatal("persisted checkpoint could not recover after restart")
	}
}

func TestUnconfiguredOpenCheckpointCadencePreservesCurrentUploads(t *testing.T) {
	calls := 0
	r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		calls++
		acknowledgeActivity(t, w, request)
	})
	payload := activityTestPayload(1)
	for i := 0; i < 2; i++ {
		_ = r.enqueueObservedActivity(payload.Records, payload.Records[0].EventID)
		if err := r.flush(context.Background(), "activity"); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 2 {
		t.Fatal("zero/omitted option changed the existing dispatch cadence")
	}
}

func TestOpenCheckpointDeadlineDoesNotWaitForOrdinaryUploadTick(t *testing.T) {
	activityRequests := make(chan time.Time, 4)
	r, _ := uploadRuntime(t, func(w http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/heartbeat") {
			_, _ = io.WriteString(w, `{"success":true}`)
			return
		}
		select {
		case activityRequests <- time.Now():
		default:
		}
		acknowledgeActivity(t, w, request)
	})
	r.Config = config.Default()
	r.Config.SampleIntervalSeconds = 1
	r.Config.HeartbeatIntervalSeconds = 60
	r.Config.UploadIntervalSeconds = 30
	// Scale only the deadline for this runtime test. Persisted configuration
	// validation separately rejects values below 30s.
	r.Config.OpenCheckpointUploadIntervalSeconds = 2
	r.Tracker = segment.New(time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); _ = r.RunDaemon(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("daemon did not stop")
		}
	}()
	deadline := time.After(8 * time.Second)
	for i := 0; i < 2; i++ {
		select {
		case <-activityRequests:
		case <-deadline:
			t.Fatal("open checkpoints waited for the 30s ordinary upload tick")
		}
	}
}
