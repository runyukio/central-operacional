//go:build windows

package fileutil

import (
	"fmt"
	"syscall"
	"unsafe"
)

const (
	moveFileReplaceExisting = 0x1
	moveFileWriteThrough    = 0x8
)

var (
	kernel32FileUtil = syscall.NewLazyDLL("kernel32.dll")
	procMoveFileExW  = kernel32FileUtil.NewProc("MoveFileExW")
)

func replace(tempPath, finalPath string) error {
	tempPointer, err := syscall.UTF16PtrFromString(tempPath)
	if err != nil {
		return fmt.Errorf("invalid temporary path: %w", err)
	}
	finalPointer, err := syscall.UTF16PtrFromString(finalPath)
	if err != nil {
		return fmt.Errorf("invalid final path: %w", err)
	}
	ok, _, callErr := procMoveFileExW.Call(
		uintptr(unsafe.Pointer(tempPointer)),
		uintptr(unsafe.Pointer(finalPointer)),
		moveFileReplaceExisting|moveFileWriteThrough,
	)
	if ok == 0 {
		return fmt.Errorf("MoveFileExW failed: %v", callErr)
	}
	return nil
}
