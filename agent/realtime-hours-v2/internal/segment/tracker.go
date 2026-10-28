package segment

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

type ContextType string

const (
	TypeWeb     ContextType = "WEB"
	TypeApp     ContextType = "APP"
	TypeIdle    ContextType = "IDLE"
	TypeLocked  ContextType = "LOCKED"
	TypePrivate ContextType = "PRIVATE"
	TypeUnknown ContextType = "UNKNOWN"
)

type Context struct {
	Type        ContextType `json:"sourceType"`
	Application string      `json:"applicationName,omitempty"`
	Domain      string      `json:"domain,omitempty"`
	Method      string      `json:"detectionMethod,omitempty"`
}

func (c Context) Key() string {
	return string(c.Type) + "|" + c.Application + "|" + c.Domain + "|" + c.Method
}

type Segment struct {
	EventID         string      `json:"eventId"`
	SourceType      ContextType `json:"sourceType"`
	ApplicationName string      `json:"applicationName,omitempty"`
	Domain          string      `json:"domain,omitempty"`
	DetectionMethod string      `json:"detectionMethod,omitempty"`
	StartedAt       time.Time   `json:"startedAt"`
	EndedAt         time.Time   `json:"endedAt"`
	DurationSeconds int         `json:"durationSeconds"`
}

type Tracker struct {
	current    *Segment
	currentKey string
	maxAge     time.Duration
}

func New(maxAge time.Duration) *Tracker {
	return &Tracker{maxAge: maxAge}
}

func (t *Tracker) Update(ctx Context, at time.Time) []Segment {
	at = at.UTC()
	if t.current == nil {
		t.start(ctx, at)
		return nil
	}
	changed := ctx.Key() != t.currentKey
	expired := at.Sub(t.current.StartedAt) >= t.maxAge
	if !changed && !expired {
		return nil
	}
	closed := t.close(at)
	t.start(ctx, at)
	if closed.DurationSeconds <= 0 {
		return nil
	}
	return []Segment{closed}
}

func (t *Tracker) Flush(at time.Time) *Segment {
	if t.current == nil {
		return nil
	}
	closed := t.close(at.UTC())
	t.current = nil
	t.currentKey = ""
	if closed.DurationSeconds <= 0 {
		return nil
	}
	return &closed
}

func (t *Tracker) Snapshot(at time.Time) *Segment {
	if t.current == nil {
		return nil
	}
	copy := *t.current
	copy.EndedAt = at.UTC()
	copy.DurationSeconds = int(copy.EndedAt.Sub(copy.StartedAt).Round(time.Second).Seconds())
	if copy.DurationSeconds < 1 {
		return nil
	}
	return &copy
}

func (t *Tracker) start(ctx Context, at time.Time) {
	t.currentKey = ctx.Key()
	t.current = &Segment{
		EventID:         newID(),
		SourceType:      ctx.Type,
		ApplicationName: ctx.Application,
		Domain:          ctx.Domain,
		DetectionMethod: ctx.Method,
		StartedAt:       at,
	}
}

func (t *Tracker) close(at time.Time) Segment {
	closed := *t.current
	closed.EndedAt = at
	closed.DurationSeconds = int(closed.EndedAt.Sub(closed.StartedAt).Round(time.Second).Seconds())
	return closed
}

func newID() string {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(data)
}
