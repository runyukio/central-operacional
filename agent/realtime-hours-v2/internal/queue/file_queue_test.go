package queue

import (
	"encoding/json"
	"testing"
)

func TestUpsertReplacesSameKey(t *testing.T) {
	root := t.TempDir()
	q := Queue{Root: root, FailedDir: t.TempDir()}
	if _, err := q.Upsert("heartbeat", "current", map[string]int{"value": 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.Upsert("heartbeat", "current", map[string]int{"value": 2}); err != nil {
		t.Fatal(err)
	}
	items, err := q.List("heartbeat", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("got %d items, want 1", len(items))
	}
	var payload map[string]int
	if err := json.Unmarshal(items[0].Data, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["value"] != 2 {
		t.Fatalf("got payload %v", payload)
	}
}

func TestUpsertRejectsUnsafeKey(t *testing.T) {
	q := Queue{Root: t.TempDir(), FailedDir: t.TempDir()}
	if _, err := q.Upsert("activity", "../escape", map[string]bool{"ok": true}); err == nil {
		t.Fatal("expected unsafe key to be rejected")
	}
}
