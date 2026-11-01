package app

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/config"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/queue"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/segment"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/transport"
)

func TestSleepGapIsExcludedFromActivity(t *testing.T) {
	tracker := segment.New(time.Hour)
	start := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	current := segment.Context{Type: segment.TypeWeb, Domain: "example.com"}
	observedSegments(tracker, current, time.Time{}, start, 6*time.Second)
	before := observedSegments(tracker, current, start, start.Add(2*time.Second), 6*time.Second)
	if len(before) != 1 || before[0].DurationSeconds != 2 {
		t.Fatal("observed activity was not checkpointed")
	}
	resumed := start.Add(2 * time.Hour)
	closed := observedSegments(tracker, current, start.Add(2*time.Second), resumed, 6*time.Second)
	if len(closed) != 1 || closed[0].DurationSeconds != 2 {
		t.Fatal("sleep duration was counted as site usage")
	}
	after := observedSegments(tracker, current, resumed, resumed.Add(2*time.Second), 6*time.Second)
	if len(after) != 1 || after[0].DurationSeconds != 2 || after[0].EventID == before[0].EventID {
		t.Fatal("resumed activity did not start a new interval")
	}
}

func TestAcknowledgingOldCheckpointRetainsNewerObservedTime(t *testing.T) {
	dir := t.TempDir()
	r := &Runtime{Queue: queue.Queue{Root: filepath.Join(dir, "queue"), FailedDir: filepath.Join(dir, "failed")}, Logger: log.New(io.Discard, "", 0)}
	writes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		writes++
		if writes == 1 {
			r.queueMu.Lock()
			_, err := r.Queue.Upsert("activity", "same-event", map[string]int{"durationSeconds": 20})
			r.queueMu.Unlock()
			if err != nil {
				t.Error(err)
			}
		}
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer server.Close()
	r.Client = transport.Client{BaseURL: server.URL, DeviceID: "test", Secret: []byte("01234567890123456789012345678901"), HTTPClient: server.Client()}
	_, _ = r.Queue.Upsert("activity", "same-event", map[string]int{"durationSeconds": 10})
	if err := r.flush(context.Background(), "activity"); err != nil {
		t.Fatal(err)
	}
	pending, err := r.Queue.List("activity", 10)
	if err != nil || len(pending) != 1 {
		t.Fatal("newer checkpoint was deleted by an older acknowledgement")
	}
	var value map[string]int
	_ = json.Unmarshal(pending[0].Data, &value)
	if value["durationSeconds"] != 20 {
		t.Fatal("latest observed duration was lost")
	}
	if err := r.flush(context.Background(), "activity"); err != nil {
		t.Fatal(err)
	}
	pending, _ = r.Queue.List("activity", 10)
	if len(pending) != 0 {
		t.Fatal("queue did not drain after the latest version was acknowledged")
	}
}

func TestNetworkWaitDoesNotStopLocalSampling(t *testing.T) {
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	started := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-release:
		case <-request.Context().Done():
		}
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer func() { unblock(); server.Close() }()
	dir := t.TempDir()
	cfg := config.Default()
	cfg.SampleIntervalSeconds = 1
	r := &Runtime{Config: cfg, Queue: queue.Queue{Root: filepath.Join(dir, "queue"), FailedDir: filepath.Join(dir, "failed")}, Logger: log.New(io.Discard, "", 0), Tracker: segment.New(time.Hour), Hostname: "TEST-PC", User: "test", Client: transport.Client{BaseURL: server.URL, DeviceID: "test", Secret: []byte("01234567890123456789012345678901"), HTTPClient: server.Client()}}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); _ = r.RunDaemon(ctx) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		cancel()
		t.Fatal("upload did not begin")
	}
	deadline := time.Now().Add(3 * time.Second)
	checkpointed := false
	for time.Now().Before(deadline) {
		r.queueMu.Lock()
		items, _ := r.Queue.List("activity", 10)
		r.queueMu.Unlock()
		if len(items) > 0 {
			checkpointed = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	unblock()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("daemon did not stop")
	}
	if !checkpointed {
		t.Fatal("network wait prevented local checkpoints")
	}
}
