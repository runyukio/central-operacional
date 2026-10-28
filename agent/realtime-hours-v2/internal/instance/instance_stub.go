//go:build !windows

package instance

type noopGuard struct{}

func (noopGuard) Close() error { return nil }

func Acquire(_ string) (Guard, error) { return noopGuard{}, nil }
