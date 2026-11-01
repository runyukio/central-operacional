//go:build windows

package platform

import (
	"os"
	"syscall"
	"unsafe"
)

var (
	wts32          = syscall.NewLazyDLL("wtsapi32.dll")
	querySession   = wts32.NewProc("WTSQuerySessionInformationW")
	freeSession    = wts32.NewProc("WTSFreeMemory")
	processSession = kernel32.NewProc("ProcessIdToSessionId")
)

func SessionID() uint32 {
	var id uint32
	processSession.Call(uintptr(os.Getpid()), uintptr(unsafe.Pointer(&id)))
	return id
}

func SessionActive() bool {
	id := SessionID()
	if id == 0 {
		return false
	}
	var data *uint32
	var size uint32
	// WTSConnectState (8), WTSActive (0). Never collect another session's desktop.
	ok, _, _ := querySession.Call(0, uintptr(id), 8, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&size)))
	if ok == 0 || data == nil {
		return false
	}
	defer freeSession.Call(uintptr(unsafe.Pointer(data)))
	return size >= 4 && *data == 0
}
