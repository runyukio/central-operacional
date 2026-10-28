package state

import (
	"path/filepath"
	"testing"
	"time"
)

func TestReadFresh(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	if err := Write(dir, BrowserState{Browser: "chrome", Domain: "https://www.youtube.com/watch?v=x", Focused: true, CapturedAt: now}); err != nil {
		t.Fatal(err)
	}
	got, ok, err := ReadFresh(dir, "chrome", now.Add(5*time.Second), 20*time.Second)
	if err != nil || !ok || got.Domain != "youtube.com" {
		t.Fatalf("got=%+v ok=%v err=%v", got, ok, err)
	}
	if _, ok, err := ReadFresh(dir, "msedge", now, 20*time.Second); err != nil || ok {
		t.Fatalf("unexpected edge state: ok=%v err=%v", ok, err)
	}
	if filepath.Base(FileName("Google Chrome")) != "browser-state-chrome.json" {
		t.Fatal("unexpected file name")
	}
}

func TestPrivateStateMustBeFresh(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	if err := Write(dir, BrowserState{
		Browser:    "chrome",
		Domain:     "https://secret.example/path",
		Focused:    true,
		Private:    true,
		CapturedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	fresh, ok, err := ReadFresh(dir, "chrome", now.Add(5*time.Second), 20*time.Second)
	if err != nil || !ok || !fresh.Private || fresh.Domain != "" {
		t.Fatalf("fresh=%+v ok=%v err=%v", fresh, ok, err)
	}
	stale, ok, err := ReadFresh(dir, "chrome", now.Add(time.Minute), 20*time.Second)
	if err != nil || ok || !stale.Private {
		t.Fatalf("stale=%+v ok=%v err=%v", stale, ok, err)
	}
}
