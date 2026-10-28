//go:build windows

package secret

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

type dataBlob struct {
	cbData uint32
	pbData *byte
}

const cryptProtectLocalMachine = 0x4

var (
	crypt32              = syscall.NewLazyDLL("crypt32.dll")
	kernel32Secret       = syscall.NewLazyDLL("kernel32.dll")
	procCryptProtectData = crypt32.NewProc("CryptProtectData")
	procCryptUnprotect   = crypt32.NewProc("CryptUnprotectData")
	procLocalFree        = kernel32Secret.NewProc("LocalFree")
)

func ProtectAndWrite(path string, plain []byte) error {
	protected, err := protect(plain)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("create secret directory: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, protected, 0o600); err != nil {
		return fmt.Errorf("write protected secret: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replace protected secret: %w", err)
	}
	return nil
}

func ReadAndUnprotect(path string) ([]byte, error) {
	protected, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read protected secret: %w", err)
	}
	return unprotect(protected)
}

func protect(plain []byte) ([]byte, error) {
	if len(plain) == 0 {
		return nil, fmt.Errorf("secret is empty")
	}
	input := dataBlob{cbData: uint32(len(plain)), pbData: &plain[0]}
	var output dataBlob
	ok, _, callErr := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&input)),
		0,
		0,
		0,
		0,
		cryptProtectLocalMachine,
		uintptr(unsafe.Pointer(&output)),
	)
	if ok == 0 {
		return nil, fmt.Errorf("CryptProtectData failed: %v", callErr)
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(output.pbData)))
	return append([]byte(nil), unsafe.Slice(output.pbData, output.cbData)...), nil
}

func unprotect(protected []byte) ([]byte, error) {
	if len(protected) == 0 {
		return nil, fmt.Errorf("protected secret is empty")
	}
	input := dataBlob{cbData: uint32(len(protected)), pbData: &protected[0]}
	var output dataBlob
	ok, _, callErr := procCryptUnprotect.Call(
		uintptr(unsafe.Pointer(&input)),
		0,
		0,
		0,
		0,
		0,
		uintptr(unsafe.Pointer(&output)),
	)
	if ok == 0 {
		return nil, fmt.Errorf("CryptUnprotectData failed: %v", callErr)
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(output.pbData)))
	return append([]byte(nil), unsafe.Slice(output.pbData, output.cbData)...), nil
}
