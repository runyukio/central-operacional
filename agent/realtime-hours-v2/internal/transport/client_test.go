package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPostJSONSignsRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/test" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		for _, header := range []string{"X-RH-Device-Id", "X-RH-Timestamp", "X-RH-Nonce", "X-RH-Body-SHA256", "X-RH-Signature"} {
			if r.Header.Get(header) == "" {
				t.Fatalf("missing header %s", header)
			}
		}
		var body map[string]bool
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !body["ok"] {
			t.Fatalf("unexpected body: %v err=%v", body, err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer server.Close()

	client := Client{
		BaseURL:    server.URL,
		DeviceID:   "device-test",
		Secret:     []byte("01234567890123456789012345678901"),
		HTTPClient: server.Client(),
	}
	status, _, err := client.PostJSON(context.Background(), "/api/test", map[string]bool{"ok": true})
	if err != nil || status != http.StatusOK {
		t.Fatalf("status=%d err=%v", status, err)
	}
}
