//go:build windows

package platform

import (
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	processQueryLimitedInformation = 0x1000
	desktopSwitchDesktop           = 0x0100
)

type lastInputInfo struct {
	CbSize uint32
	DwTime uint32
}

var (
	user32                        = syscall.NewLazyDLL("user32.dll")
	kernel32                      = syscall.NewLazyDLL("kernel32.dll")
	procGetForegroundWindow       = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcessID  = user32.NewProc("GetWindowThreadProcessId")
	procGetLastInputInfo          = user32.NewProc("GetLastInputInfo")
	procOpenInputDesktop          = user32.NewProc("OpenInputDesktop")
	procCloseDesktop              = user32.NewProc("CloseDesktop")
	procOpenProcess               = kernel32.NewProc("OpenProcess")
	procCloseHandle               = kernel32.NewProc("CloseHandle")
	procQueryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")
	procGetTickCount64            = kernel32.NewProc("GetTickCount64")
)

func Snapshot() (Foreground, error) {
	locked := isLocked()
	idle := idleDuration()
	if locked {
		return Foreground{Locked: true, IdleFor: idle}, nil
	}
	window, _, _ := procGetForegroundWindow.Call()
	if window == 0 {
		return Foreground{IdleFor: idle}, nil
	}
	var pid uint32
	_, _, _ = procGetWindowThreadProcessID.Call(window, uintptr(unsafe.Pointer(&pid)))
	return Foreground{ProcessName: processName(pid), PID: pid, IdleFor: idle}, nil
}

func idleDuration() time.Duration {
	info := lastInputInfo{CbSize: uint32(unsafe.Sizeof(lastInputInfo{}))}
	ok, _, _ := procGetLastInputInfo.Call(uintptr(unsafe.Pointer(&info)))
	if ok == 0 {
		return 0
	}
	ticks, _, _ := procGetTickCount64.Call()
	elapsed := uint64(ticks) - uint64(info.DwTime)
	return time.Duration(elapsed) * time.Millisecond
}

func isLocked() bool {
	handle, _, _ := procOpenInputDesktop.Call(0, 0, desktopSwitchDesktop)
	if handle == 0 {
		return true
	}
	_, _, _ = procCloseDesktop.Call(handle)
	return false
}

func processName(pid uint32) string {
	if pid == 0 {
		return ""
	}
	handle, _, _ := procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if handle == 0 {
		return ""
	}
	defer procCloseHandle.Call(handle)
	buffer := make([]uint16, 32768)
	size := uint32(len(buffer))
	ok, _, _ := procQueryFullProcessImageName.Call(handle, 0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)))
	if ok == 0 || size == 0 {
		return ""
	}
	name := filepath.Base(syscall.UTF16ToString(buffer[:size]))
	name = strings.TrimSuffix(strings.ToLower(name), ".exe")
	return name
}
