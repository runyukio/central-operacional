//go:build windows

package secret

import (
	"bytes"
	"path/filepath"
	"testing"
)

func TestWindowsDPAPIScopes(t *testing.T) {
	for _, scope := range []struct {
		name  string
		write func(string, []byte) error
	}{{"machine", ProtectAndWrite}, {"current-user", ProtectForCurrentUser}} {
		t.Run(scope.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "protected.dpapi")
			plain := []byte("windows-dpapi-session-regression")
			if err := scope.write(path, plain); err != nil {
				t.Fatal(err)
			}
			restored, err := ReadAndUnprotect(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(plain, restored) {
				t.Fatal("DPAPI scope roundtrip failed")
			}
		})
	}
}
