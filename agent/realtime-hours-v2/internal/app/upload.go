package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/fileutil"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/queue"
	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/segment"
)

const (
	maxActivityBatchRecords = 500
	maxActivityBatchBytes   = 512 * 1024
	maxActivityQueueItems   = 500
)

type uploadRetry struct {
	failures int
	after    time.Time
}

type activityBatch struct {
	payload           ActivityPayload
	items             []queue.Item
	hasOpenCheckpoint bool
}

// Serialize network uploads without holding queueMu: sampling must keep
// checkpointing locally while an acknowledgement is in flight.
func (r *Runtime) flush(ctx context.Context, kind string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if kind == "activity" {
		return r.flushActivityLocked(ctx)
	}
	return r.flushHeartbeatLocked(ctx)
}

func (r *Runtime) uploadTime() time.Time {
	if r.uploadNow != nil {
		return r.uploadNow()
	}
	return time.Now().UTC()
}

func (r *Runtime) retryPending(kind string) bool {
	return r.uploadTime().Before(r.uploadRetry[kind].after)
}

func (r *Runtime) retryUpload(kind string, deadline time.Time) {
	if r.uploadRetry == nil {
		r.uploadRetry = make(map[string]uploadRetry)
	}
	state := r.uploadRetry[kind]
	state.failures++
	// The first retry keeps the installed 30s upload cadence; subsequent
	// failures back off, avoiding repeated requests against an unavailable API.
	delay := 30 * time.Second
	for n := 1; n < state.failures && delay < 5*time.Minute; n++ {
		delay *= 2
	}
	if delay > 5*time.Minute {
		delay = 5 * time.Minute
	}
	state.after = r.uploadTime().Add(delay)
	if deadline.After(state.after) {
		state.after = deadline
	}
	r.uploadRetry[kind] = state
}

func (r *Runtime) uploadSucceeded(kind string) {
	delete(r.uploadRetry, kind)
}

func (r *Runtime) queuedItems(kind string, limit int) ([]queue.Item, error) {
	r.queueMu.Lock()
	defer r.queueMu.Unlock()
	return r.Queue.List(kind, limit)
}

func (r *Runtime) flushHeartbeatLocked(ctx context.Context) error {
	if r.retryPending("heartbeat") {
		return nil
	}
	items, err := r.queuedItems("heartbeat", 100)
	if err != nil {
		return err
	}
	for _, item := range items {
		var payload any
		if err := json.Unmarshal(item.Data, &payload); err != nil {
			if err := r.finishItem("heartbeat", item, true); err != nil {
				return err
			}
			continue
		}
		response, err := r.Client.PostJSONResponse(ctx, "/api/realtime-hours/v2/heartbeat", payload)
		if err != nil {
			r.retryUpload("heartbeat", time.Time{})
			return err
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			var acknowledgement struct {
				Success bool `json:"success"`
			}
			if err := json.Unmarshal(response.Body, &acknowledgement); err != nil || !acknowledgement.Success {
				r.retryUpload("heartbeat", response.RetryAfter)
				return fmt.Errorf("heartbeat upload did not receive a success acknowledgement")
			}
			r.uploadSucceeded("heartbeat")
			r.statusMu.Lock()
			r.heartbeatAcknowledgedAt = r.uploadTime()
			r.statusMu.Unlock()
			if err := r.finishItem("heartbeat", item, false); err != nil {
				return err
			}
			continue
		}
		if permanentPayloadRejection(response.StatusCode) {
			if err := r.finishItem("heartbeat", item, true); err != nil {
				return err
			}
			return fmt.Errorf("heartbeat payload quarantined: status=%d", response.StatusCode)
		}
		r.retryUpload("heartbeat", response.RetryAfter)
		return fmt.Errorf("heartbeat upload retained for retry: status=%d", response.StatusCode)
	}
	return nil
}

func compatibleActivity(a, b ActivityPayload) bool {
	return a.SchemaVersion == b.SchemaVersion && a.AgentVersion == b.AgentVersion &&
		a.Hostname == b.Hostname && a.WindowsUser == b.WindowsUser && a.WBLogin == b.WBLogin
}

func decodeActivity(item queue.Item) (ActivityPayload, error) {
	var payload ActivityPayload
	if err := json.Unmarshal(item.Data, &payload); err != nil {
		return payload, err
	}
	if payload.SchemaVersion != 2 || payload.AgentVersion == "" || payload.Hostname == "" ||
		payload.WindowsUser == "" || payload.CapturedAt.IsZero() ||
		len(payload.Records) == 0 || len(payload.Records) > maxActivityBatchRecords {
		return payload, fmt.Errorf("invalid queued activity envelope")
	}
	return payload, nil
}

func isOpenCheckpoint(item queue.Item) bool {
	marker, err := os.ReadFile(item.Path + ".open")
	digest := sha256.Sum256(item.Data)
	return err == nil && bytes.Equal(marker, digest[:])
}

// Sidecars keep persisted JSON compatible with older agents during rollback.
// Bind the marker to the exact queued version. A crash between the two atomic
// writes merely makes the checkpoint eligible sooner; observed time stays in
// the ordinary queue file.
func markOpenCheckpoint(path string, open bool) error {
	if !open {
		removeOpenCheckpoint(path)
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)
	tmp := path + ".open.tmp"
	if err := os.WriteFile(tmp, digest[:], 0o660); err != nil {
		return err
	}
	return fileutil.Replace(tmp, path+".open")
}

func removeOpenCheckpoint(path string) {
	_ = os.Remove(path + ".open")
}

func (r *Runtime) openCheckpointDue() bool {
	interval := r.Config.OpenCheckpointUploadIntervalSeconds
	return interval == 0 || r.openCheckpointDelay() <= 0
}

func (r *Runtime) openCheckpointDelay() time.Duration {
	r.statusMu.Lock()
	acknowledged := r.openCheckpointAcknowledgedAt
	r.statusMu.Unlock()
	if acknowledged.IsZero() {
		return 0
	}
	return acknowledged.Add(time.Duration(r.Config.OpenCheckpointUploadIntervalSeconds) * time.Second).Sub(r.uploadTime())
}

func batchForItems(items []queue.Item) (activityBatch, error) {
	var batch activityBatch
	for _, item := range items {
		payload, err := decodeActivity(item)
		if err != nil {
			return batch, err
		}
		if len(batch.items) == 0 {
			batch.payload = payload
			batch.payload.Records = append([]segmentRecord(nil), payload.Records...)
		} else {
			if !compatibleActivity(batch.payload, payload) {
				return batch, fmt.Errorf("incompatible activity envelopes")
			}
			batch.payload.Records = append(batch.payload.Records, payload.Records...)
			if payload.CapturedAt.After(batch.payload.CapturedAt) {
				batch.payload.CapturedAt = payload.CapturedAt
			}
		}
		batch.items = append(batch.items, item)
		batch.hasOpenCheckpoint = batch.hasOpenCheckpoint || isOpenCheckpoint(item)
	}
	return batch, nil
}

func (r *Runtime) flushActivityLocked(ctx context.Context) error {
	if r.retryPending("activity") {
		return nil
	}
	items, err := r.queuedItems("activity", maxActivityQueueItems)
	if err != nil {
		return err
	}
	var current activityBatch
	var quarantined []error
	send := func() error {
		if len(current.items) == 0 {
			return nil
		}
		retry, err := r.sendActivityBatchLocked(ctx, current)
		current = activityBatch{}
		if retry {
			return err
		}
		if err != nil {
			quarantined = append(quarantined, err)
		}
		return nil
	}
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		if isOpenCheckpoint(item) && !r.openCheckpointDue() {
			continue
		}
		payload, err := decodeActivity(item)
		if err != nil {
			if err := r.finishItem("activity", item, true); err != nil {
				return err
			}
			quarantined = append(quarantined, fmt.Errorf("invalid activity queue item quarantined"))
			continue
		}
		if len(current.items) > 0 && (!compatibleActivity(current.payload, payload) ||
			len(current.payload.Records)+len(payload.Records) > maxActivityBatchRecords) {
			if err := send(); err != nil {
				return errors.Join(append(quarantined, err)...)
			}
		}
		candidate := activityBatch{payload: payload, items: append(append([]queue.Item(nil), current.items...), item), hasOpenCheckpoint: current.hasOpenCheckpoint || isOpenCheckpoint(item)}
		if len(current.items) > 0 {
			candidate.payload = current.payload
			candidate.payload.Records = append(append([]segment.Segment(nil), current.payload.Records...), payload.Records...)
			if payload.CapturedAt.After(candidate.payload.CapturedAt) {
				candidate.payload.CapturedAt = payload.CapturedAt
			}
		}
		encoded, err := json.Marshal(candidate.payload)
		if err != nil {
			return err
		}
		if len(encoded) > maxActivityBatchBytes && len(current.items) > 0 {
			if err := send(); err != nil {
				return errors.Join(append(quarantined, err)...)
			}
			candidate = activityBatch{payload: payload, items: []queue.Item{item}, hasOpenCheckpoint: isOpenCheckpoint(item)}
			encoded, err = json.Marshal(candidate.payload)
			if err != nil {
				return err
			}
		}
		if len(encoded) > maxActivityBatchBytes {
			if err := r.finishItem("activity", item, true); err != nil {
				return err
			}
			quarantined = append(quarantined, fmt.Errorf("oversized activity queue item quarantined"))
			continue
		}
		current = candidate
	}
	if err := send(); err != nil {
		return errors.Join(append(quarantined, err)...)
	}
	return errors.Join(quarantined...)
}

// retry is false only when the batch was fully acknowledged or permanently
// rejected items were isolated and preserved in failed/. A transport failure or
// partial/missing acknowledgement keeps all unacknowledged versions in queue/.
func (r *Runtime) sendActivityBatchLocked(ctx context.Context, batch activityBatch) (retry bool, err error) {
	// A backlog must not delay presence until every activity batch has drained.
	if err := r.flushHeartbeatLocked(ctx); err != nil && r.Logger != nil {
		r.Logger.Printf("heartbeat retry pending before activity: %v", err)
	}
	response, err := r.Client.PostJSONResponse(ctx, "/api/realtime-hours/v2/activity", batch.payload)
	if err != nil {
		r.retryUpload("activity", time.Time{})
		return true, err
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		var acknowledgement struct {
			Success          bool `json:"success"`
			RecordsProcessed *int `json:"recordsProcessed"`
		}
		if err := json.Unmarshal(response.Body, &acknowledgement); err != nil ||
			!acknowledgement.Success || acknowledgement.RecordsProcessed == nil ||
			*acknowledgement.RecordsProcessed != len(batch.payload.Records) {
			r.retryUpload("activity", response.RetryAfter)
			return true, fmt.Errorf("activity upload did not acknowledge the complete batch")
		}
		r.uploadSucceeded("activity")
		if batch.hasOpenCheckpoint {
			r.statusMu.Lock()
			r.openCheckpointAcknowledgedAt = r.uploadTime()
			r.statusMu.Unlock()
			select {
			case r.openCheckpointUpdates <- struct{}{}:
			default:
			}
		}
		for _, item := range batch.items {
			if err := r.finishItem("activity", item, false); err != nil {
				return true, err
			}
		}
		return false, nil
	}
	if permanentPayloadRejection(response.StatusCode) {
		// Never quarantine a whole valid batch because one record is invalid.
		// Split by persisted queue item; the original agent writes one segment
		// per item, so healthy siblings can still be delivered.
		if len(batch.items) > 1 {
			middle := len(batch.items) / 2
			left, leftErr := batchForItems(batch.items[:middle])
			right, rightErr := batchForItems(batch.items[middle:])
			if leftErr != nil || rightErr != nil {
				return true, errors.Join(leftErr, rightErr)
			}
			retry, firstErr := r.sendActivityBatchLocked(ctx, left)
			if retry {
				return true, firstErr
			}
			retry, secondErr := r.sendActivityBatchLocked(ctx, right)
			return retry, errors.Join(firstErr, secondErr)
		}
		if err := r.finishItem("activity", batch.items[0], true); err != nil {
			return true, err
		}
		return false, fmt.Errorf("activity payload quarantined: status=%d", response.StatusCode)
	}
	r.retryUpload("activity", response.RetryAfter)
	return true, fmt.Errorf("activity upload retained for retry: status=%d", response.StatusCode)
}

func permanentPayloadRejection(status int) bool {
	return status == 400 || status == 413 || status == 422
}

// Keep the wire type in one place so batching preserves all segment fields.
type segmentRecord = segment.Segment
