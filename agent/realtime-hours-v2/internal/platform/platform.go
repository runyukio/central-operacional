package platform

import "time"

type Foreground struct {
	ProcessName string
	PID         uint32
	Locked      bool
	IdleFor     time.Duration
}
