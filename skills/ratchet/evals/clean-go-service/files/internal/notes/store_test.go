package notes

import (
	"errors"
	"testing"
	"time"

	"example.com/notes/internal/clock"
)

func TestAddStampsWithTheClock(t *testing.T) {
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	s := NewStore(clock.Fixed(at))
	n := s.Add("hello")
	if !n.Created.Equal(at) {
		t.Fatalf("created %v, want %v", n.Created, at)
	}
}

func TestGetMissing(t *testing.T) {
	s := NewStore(clock.Fixed(time.Time{}))
	if _, err := s.Get(42); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err %v, want ErrNotFound", err)
	}
}
