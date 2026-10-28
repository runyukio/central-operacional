package fileutil

// Replace atomically promotes a temporary file to its final path whenever the
// operating system supports it. Platform-specific implementations are used to
// preserve overwrite semantics on Windows.
func Replace(tempPath, finalPath string) error {
	return replace(tempPath, finalPath)
}
