package segment

import (
	"testing"
	"time"
)

func TestTrackerClosesOnContextChange(t *testing.T) {
	start := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	tracker := New(time.Hour)
	if got := tracker.Update(Context{Type: TypeWeb, Application: "chrome", Domain: "youtube.com"}, start); len(got) != 0 {
		t.Fatalf("unexpected initial segments: %v", got)
	}
	closed := tracker.Update(Context{Type: TypeWeb, Application: "chrome", Domain: "chatgpt.com"}, start.Add(10*time.Minute))
	if len(closed) != 1 || closed[0].Domain != "youtube.com" || closed[0].DurationSeconds != 600 {
		t.Fatalf("unexpected closed segment: %+v", closed)
	}
}
