//go:build windows

package instance

import (
	"fmt"
	"syscall"
	"unsafe"
)

const errorAlreadyExists syscall.Errno = 183

var (
	kernel32Instance = syscall.NewLazyDLL("kernel32.dll")
	procCreateMutexW = kernel32Instance.NewProc("CreateMutexW")
	procCloseHandle  = kernel32Instance.NewProc("CloseHandle")
)

type windowsGuard struct {
	handle syscall.Handle
}

func Acquire(name string) (Guard, error) {
	pointer, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return nil, fmt.Errorf("invalid mutex name: %w", err)
	}
	handle, _, callErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(pointer)))
	if handle == 0 {
		return nil, fmt.Errorf("CreateMutexW failed: %v", callErr)
	}
	if errno, ok := callErr.(syscall.Errno); ok && errno == errorAlreadyExists {
		_, _, _ = procCloseHandle.Call(handle)
		return nil, ErrAlreadyRunning
	}
	return &windowsGuard{handle: syscall.Handle(handle)}, nil
}

func (g *windowsGuard) Close() error {
	if g == nil || g.handle == 0 {
		return nil
	}
	ok, _, callErr := procCloseHandle.Call(uintptr(g.handle))
	g.handle = 0
	if ok == 0 {
		return fmt.Errorf("CloseHandle failed: %v", callErr)
	}
	return nil
}
