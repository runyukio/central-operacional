//go:build !windows

package secret

import (
	"fmt"
	"os"
)

func ProtectAndWrite(path string, plain []byte) error {
	return fmt.Errorf("DPAPI is only available on Windows")
}

func ReadAndUnprotect(path string) ([]byte, error) {
	if value := os.Getenv("RH_TEST_DEVICE_SECRET"); value != "" {
		return []byte(value), nil
	}
	return nil, fmt.Errorf("DPAPI is only available on Windows")
}
