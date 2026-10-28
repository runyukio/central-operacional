//go:build !windows

package platform

import "time"

func Snapshot() (Foreground, error) {
	return Foreground{ProcessName: "unknown", IdleFor: 0 * time.Second}, nil
}
