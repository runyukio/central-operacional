package domain

import (
	"net"
	"net/url"
	"strings"
)

// NormalizeHost keeps only a DNS hostname. It never returns a URL path, query,
// fragment, credentials or port.
func NormalizeHost(raw string) string {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return ""
	}

	lower := strings.ToLower(candidate)
	blockedSchemes := []string{"chrome:", "edge:", "about:", "file:", "data:", "view-source:", "chrome-extension:", "moz-extension:"}
	for _, prefix := range blockedSchemes {
		if strings.HasPrefix(lower, prefix) {
			return ""
		}
	}

	if !strings.Contains(candidate, "://") {
		candidate = "https://" + candidate
	}

	parsed, err := url.Parse(candidate)
	if err != nil {
		return ""
	}

	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	host = strings.TrimPrefix(host, "www.")
	if host == "" || len(host) > 253 || net.ParseIP(host) != nil {
		return ""
	}

	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return ""
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
				return ""
			}
		}
	}

	if !strings.Contains(host, ".") {
		return ""
	}
	return host
}
