package queue

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Item struct {
	Path string
	Data []byte
}

type Queue struct {
	Root      string
	FailedDir string
}

func (q Queue) Enqueue(kind string, payload any) (string, error) {
	if strings.TrimSpace(kind) == "" {
		return "", fmt.Errorf("queue kind is required")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode queue payload: %w", err)
	}
	dir := filepath.Join(q.Root, kind)
	if err := os.MkdirAll(dir, 0o770); err != nil {
		return "", fmt.Errorf("create queue directory: %w", err)
	}
	name := fmt.Sprintf("%s-%d.json", time.Now().UTC().Format("20060102T150405.000000000"), time.Now().UnixNano())
	path := filepath.Join(dir, name)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o660); err != nil {
		return "", fmt.Errorf("write queue item: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", fmt.Errorf("commit queue item: %w", err)
	}
	return path, nil
}

func (q Queue) List(kind string, limit int) ([]Item, error) {
	dir := filepath.Join(q.Root, kind)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read queue directory: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if limit > 0 && len(names) > limit {
		names = names[:limit]
	}
	items := make([]Item, 0, len(names))
	for _, name := range names {
		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read queue item %s: %w", name, err)
		}
		items = append(items, Item{Path: path, Data: data})
	}
	return items, nil
}

func (q Queue) Remove(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove queue item: %w", err)
	}
	return nil
}

func (q Queue) Quarantine(kind, path string) error {
	dir := filepath.Join(q.FailedDir, kind)
	if err := os.MkdirAll(dir, 0o770); err != nil {
		return fmt.Errorf("create failed directory: %w", err)
	}
	target := filepath.Join(dir, filepath.Base(path))
	if err := os.Rename(path, target); err != nil {
		return fmt.Errorf("quarantine queue item: %w", err)
	}
	return nil
}
