//go:build !windows

package fileutil

import "os"

func replace(tempPath, finalPath string) error {
	return os.Rename(tempPath, finalPath)
}
