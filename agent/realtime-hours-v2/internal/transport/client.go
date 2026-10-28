package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/auth"
)

type Client struct {
	BaseURL    string
	DeviceID   string
	Secret     []byte
	HTTPClient *http.Client
}

func (c Client) PostJSON(ctx context.Context, path string, payload any) (int, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, fmt.Errorf("encode request: %w", err)
	}
	base, err := url.Parse(strings.TrimRight(c.BaseURL, "/"))
	if err != nil {
		return 0, nil, fmt.Errorf("invalid base URL: %w", err)
	}
	relative, err := url.Parse(path)
	if err != nil {
		return 0, nil, fmt.Errorf("invalid path: %w", err)
	}
	endpoint := base.ResolveReference(relative)
	signed, err := auth.Sign(c.DeviceID, c.Secret, http.MethodPost, endpoint.Path, body, time.Now())
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return 0, nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-RH-Device-Id", signed.DeviceID)
	req.Header.Set("X-RH-Timestamp", signed.Timestamp)
	req.Header.Set("X-RH-Nonce", signed.Nonce)
	req.Header.Set("X-RH-Body-SHA256", signed.BodyHash)
	req.Header.Set("X-RH-Signature", signed.Signature)

	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("read response: %w", err)
	}
	return resp.StatusCode, responseBody, nil
}
