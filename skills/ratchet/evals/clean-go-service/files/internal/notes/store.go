package notes

import (
	"errors"
	"sync"
	"time"

	"example.com/notes/internal/clock"
)

// ErrNotFound means no note has that id.
var ErrNotFound = errors.New("note not found")

// Note is one saved note.
type Note struct {
	ID      int       `json:"id"`
	Text    string    `json:"text"`
	Created time.Time `json:"created"`
}

// Store keeps notes in memory.
type Store struct {
	mu    sync.Mutex
	clock clock.Clock
	next  int
	notes map[int]Note
}

// NewStore returns an empty store that stamps notes with c.
func NewStore(c clock.Clock) *Store {
	return &Store{clock: c, next: 1, notes: map[int]Note{}}
}

// Add saves a note and returns it.
func (s *Store) Add(text string) Note {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := Note{ID: s.next, Text: text, Created: s.clock.Now()}
	s.notes[n.ID] = n
	s.next++
	return n
}

// Get returns the note with id.
func (s *Store) Get(id int) (Note, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.notes[id]
	if !ok {
		return Note{}, ErrNotFound
	}
	return n, nil
}
