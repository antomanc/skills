// Package clock is the only place that reads the system time.
package clock

import "time"

// Clock tells the time. Code that needs now takes a Clock, so tests can fix it.
type Clock interface {
	Now() time.Time
}

// System is the real clock.
type System struct{}

// Now returns the current time.
func (System) Now() time.Time { return time.Now() }

// Fixed always returns the same time.
type Fixed time.Time

// Now returns the fixed time.
func (f Fixed) Now() time.Time { return time.Time(f) }
