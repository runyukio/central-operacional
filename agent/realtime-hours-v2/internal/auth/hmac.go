package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type SignedHeaders struct {
	DeviceID  string
	Timestamp string
	Nonce     string
	BodyHash  string
	Signature string
}

func Sign(deviceID string, secret []byte, method, path string, body []byte, now time.Time) (SignedHeaders, error) {
	if strings.TrimSpace(deviceID) == "" || len(secret) < 32 {
		return SignedHeaders{}, fmt.Errorf("device credentials are incomplete")
	}
	timestamp := strconv.FormatInt(now.UTC().Unix(), 10)
	nonce, err := randomHex(16)
	if err != nil {
		return SignedHeaders{}, err
	}
	bodyDigest := sha256.Sum256(body)
	bodyHash := hex.EncodeToString(bodyDigest[:])
	canonical := strings.Join([]string{
		strings.ToUpper(method),
		path,
		timestamp,
		nonce,
		bodyHash,
	}, "\n")
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(canonical))
	return SignedHeaders{
		DeviceID:  deviceID,
		Timestamp: timestamp,
		Nonce:     nonce,
		BodyHash:  bodyHash,
		Signature: base64.RawURLEncoding.EncodeToString(mac.Sum(nil)),
	}, nil
}

func randomHex(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	return hex.EncodeToString(data), nil
}
