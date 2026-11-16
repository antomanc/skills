package notes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"example.com/notes/internal/clock"
)

func TestCreateAndRead(t *testing.T) {
	h := NewHandler(NewStore(clock.Fixed(time.Time{})))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/notes", strings.NewReader(`{"text":"hi"}`)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/notes/1", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "hi") {
		t.Fatalf("read: %d %s", rec.Code, rec.Body.String())
	}
}
