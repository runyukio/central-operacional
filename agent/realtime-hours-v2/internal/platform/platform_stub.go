//go:build !windows

package platform

import "time"

func SessionID() uint32   { return 0 }
func SessionActive() bool { return true }

func Snapshot() (Foreground, error) {
	return Foreground{ProcessName: "unknown", IdleFor: 0 * time.Second}, nil
}
