package nativehost

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/runyukio/central-operacional/agent/realtime-hours-v2/internal/state"
)

const maxMessageBytes = 64 * 1024

type Message struct {
	Browser    string `json:"browser"`
	Domain     string `json:"domain"`
	Focused    bool   `json:"focused"`
	Private    bool   `json:"private"`
	CapturedAt string `json:"capturedAt"`
}

type Response struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func Run(input io.Reader, output io.Writer, stateDir string) error {
	reader := bufio.NewReader(input)
	for {
		lengthBuffer := make([]byte, 4)
		if _, err := io.ReadFull(reader, lengthBuffer); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return nil
			}
			return fmt.Errorf("read native message length: %w", err)
		}
		length := binary.LittleEndian.Uint32(lengthBuffer)
		if length == 0 || length > maxMessageBytes {
			_ = writeResponse(output, Response{Success: false, Error: "invalid message length"})
			return fmt.Errorf("native message length %d is invalid", length)
		}
		payload := make([]byte, length)
		if _, err := io.ReadFull(reader, payload); err != nil {
			return fmt.Errorf("read native message: %w", err)
		}
		var message Message
		if err := json.Unmarshal(payload, &message); err != nil {
			_ = writeResponse(output, Response{Success: false, Error: "invalid JSON"})
			continue
		}
		capturedAt, err := time.Parse(time.RFC3339Nano, message.CapturedAt)
		if err != nil {
			capturedAt = time.Now().UTC()
		}
		err = state.Write(stateDir, state.BrowserState{
			Browser:    message.Browser,
			Domain:     message.Domain,
			Focused:    message.Focused,
			Private:    message.Private,
			CapturedAt: capturedAt,
			Source:     "native-messaging",
		})
		if err != nil {
			_ = writeResponse(output, Response{Success: false, Error: err.Error()})
			continue
		}
		if err := writeResponse(output, Response{Success: true}); err != nil {
			return err
		}
	}
}

func writeResponse(output io.Writer, response Response) error {
	payload, err := json.Marshal(response)
	if err != nil {
		return err
	}
	length := make([]byte, 4)
	binary.LittleEndian.PutUint32(length, uint32(len(payload)))
	if _, err := output.Write(length); err != nil {
		return err
	}
	_, err = output.Write(payload)
	return err
}
