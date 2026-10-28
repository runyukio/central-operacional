package auth

import (
	"testing"
	"time"
)

func TestSignStableFields(t *testing.T) {
	headers, err := Sign("device-1", []byte("01234567890123456789012345678901"), "post", "/api/test", []byte(`{"ok":true}`), time.Unix(100, 0))
	if err != nil {
		t.Fatal(err)
	}
	if headers.DeviceID != "device-1" || headers.Timestamp != "100" || headers.BodyHash == "" || headers.Signature == "" || headers.Nonce == "" {
		t.Fatalf("unexpected headers: %+v", headers)
	}
}
