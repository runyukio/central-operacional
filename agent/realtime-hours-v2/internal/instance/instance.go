package instance

import "errors"

var ErrAlreadyRunning = errors.New("another agent instance is already running")

type Guard interface {
	Close() error
}
