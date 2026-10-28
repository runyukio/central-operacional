package domain

import "testing"

func TestNormalizeHost(t *testing.T) {
	tests := map[string]string{
		"https://www.youtube.com/watch?v=abc": "youtube.com",
		"chatgpt.com/c/secret?x=1":            "chatgpt.com",
		"HTTPS://OUTLOOK.OFFICE.COM/mail":     "outlook.office.com",
		"chrome://settings":                   "",
		"file:///c:/secret.txt":               "",
		"localhost:3000":                      "",
		"192.168.0.1":                         "",
		"bad host":                            "",
	}
	for input, expected := range tests {
		if actual := NormalizeHost(input); actual != expected {
			t.Fatalf("NormalizeHost(%q) = %q, want %q", input, actual, expected)
		}
	}
}
