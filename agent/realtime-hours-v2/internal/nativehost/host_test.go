package nativehost

import (
	"bytes"
	"encoding/binary"
	"testing"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/state"
)

func TestRunWritesBrowserState(t *testing.T) {
	dir := t.TempDir()
	payload := []byte(`{"browser":"chrome","domain":"https://www.youtube.com/watch?v=x","focused":true,"private":false,"capturedAt":"2026-10-28T12:00:00Z"}`)
	input := bytes.NewBuffer(nil)
	length := make([]byte, 4)
	binary.LittleEndian.PutUint32(length, uint32(len(payload)))
	input.Write(length)
	input.Write(payload)
	output := bytes.NewBuffer(nil)
	if err := Run(input, output, dir); err != nil {
		t.Fatal(err)
	}
	got, ok, err := state.ReadFresh(dir, "chrome", time.Date(2026, 10, 28, 12, 0, 5, 0, time.UTC), 20*time.Second)
	if err != nil || !ok || got.Domain != "youtube.com" {
		t.Fatalf("got=%+v ok=%v err=%v", got, ok, err)
	}
}
