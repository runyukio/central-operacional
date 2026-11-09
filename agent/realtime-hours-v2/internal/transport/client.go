package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
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
	response, err := c.PostJSONResponse(ctx, path, payload)
	return response.StatusCode, response.Body, err
}

type Response struct {
	StatusCode int
	Body       []byte
	RetryAfter time.Time
}

func (c Client) PostJSONResponse(ctx context.Context, path string, payload any) (Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return Response{}, fmt.Errorf("encode request: %w", err)
	}
	base, err := url.Parse(strings.TrimRight(c.BaseURL, "/"))
	if err != nil {
		return Response{}, fmt.Errorf("invalid base URL: %w", err)
	}
	relative, err := url.Parse(path)
	if err != nil {
		return Response{}, fmt.Errorf("invalid path: %w", err)
	}
	endpoint := base.ResolveReference(relative)
	signed, err := auth.Sign(c.DeviceID, c.Secret, http.MethodPost, endpoint.Path, body, time.Now())
	if err != nil {
		return Response{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return Response{}, fmt.Errorf("create request: %w", err)
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
	// Signed device credentials must never follow a redirect to another endpoint.
	requestClient := *client
	requestClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	resp, err := requestClient.Do(req)
	if err != nil {
		return Response{}, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Response{StatusCode: resp.StatusCode}, fmt.Errorf("read response: %w", err)
	}
	return Response{StatusCode: resp.StatusCode, Body: responseBody, RetryAfter: retryAfter(resp.Header.Get("Retry-After"), time.Now())}, nil
}

func retryAfter(value string, now time.Time) time.Time {
	if seconds, err := strconv.ParseInt(strings.TrimSpace(value), 10, 32); err == nil && seconds > 0 {
		return now.Add(time.Duration(seconds) * time.Second)
	}
	if deadline, err := http.ParseTime(value); err == nil && deadline.After(now) {
		return deadline
	}
	return time.Time{}
}
