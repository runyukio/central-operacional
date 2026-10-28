package fileutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReplaceOverwritesExistingFile(t *testing.T) {
	dir := t.TempDir()
	finalPath := filepath.Join(dir, "state.json")
	tempPath := filepath.Join(dir, "state.json.tmp")
	if err := os.WriteFile(finalPath, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tempPath, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Replace(tempPath, finalPath); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(finalPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new" {
		t.Fatalf("got %q, want new", data)
	}
	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Fatalf("temporary file still exists: %v", err)
	}
}
