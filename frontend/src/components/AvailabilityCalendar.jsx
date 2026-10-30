import React, { useMemo } from 'react'

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * Computes exact time overlap between two slot intervals on the same day
 * e.g., A: 17:00-20:00, B: 18:00-21:00 => Overlap: 18:00-20:00
 */
export function computeSlotOverlap(slotA, slotB) {
  if (slotA.day !== slotB.day) return null
  const start = slotA.from > slotB.from ? slotA.from : slotB.from
  const end   = slotA.to   < slotB.to   ? slotA.to   : slotB.to
  if (start < end) {
    return { day: slotA.day, from: start, to: end }
  }
  return null
}

export function findMutualOverlaps(slotsA = [], slotsB = []) {
  const overlaps = []
  for (const a of slotsA) {
    for (const b of slotsB) {
      const overlap = computeSlotOverlap(a, b)
      if (overlap) {
        overlaps.push(overlap)
      }
    }
  }
  return overlaps
}

export default function AvailabilityCalendar({ slots = [], peerSlots = [], title = 'Weekly Availability Schedule', onSelectSlot }) {
  const mutualOverlaps = useMemo(() => {
    if (!peerSlots || peerSlots.length === 0) return []
    return findMutualOverlaps(slots, peerSlots)
  }, [slots, peerSlots])

  // Group slots by day
  const slotsByDay = useMemo(() => {
    const map = {}
    for (const d of DAYS_OF_WEEK) {
      map[d] = []
    }
    for (const s of slots) {
      if (map[s.day]) {
        map[s.day].push(s)
      }
    }
    return map
  }, [slots])

  return (
    <div className="availability-calendar-card">
      <div className="avail-calendar-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>📅</span>
          <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700 }}>{title}</h4>
        </div>
        {mutualOverlaps.length > 0 && (
          <span className="badge badge-green" style={{ fontSize: '0.75rem' }}>
            🤝 {mutualOverlaps.length} Overlapping Slot{mutualOverlaps.length > 1 ? 's' : ''} Found
          </span>
        )}
      </div>

      {mutualOverlaps.length > 0 && (
        <div className="mutual-overlap-banner">
          <div className="mutual-banner-title">⚡ Best Times for Mutual Learning:</div>
          <div className="mutual-pills-row">
            {mutualOverlaps.map((o, idx) => (
              <button
                type="button"
                key={idx}
                className="mutual-slot-pill"
                onClick={() => onSelectSlot && onSelectSlot(o)}
                title={onSelectSlot ? "Click to schedule session at this time" : undefined}
                style={{ cursor: onSelectSlot ? 'pointer' : 'default' }}
              >
                <span className="pill-day">{o.day}</span>
                <span className="pill-hours">{o.from} – {o.to}</span>
                {onSelectSlot && <span className="pill-action">Pick →</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 7-Day Grid View */}
      <div className="calendar-week-grid">
        {DAYS_OF_WEEK.map(day => {
          const daySlots = slotsByDay[day] || []
          const hasOverlap = mutualOverlaps.some(o => o.day === day)

          return (
            <div
              key={day}
              className={`calendar-day-col ${daySlots.length > 0 ? 'has-slots' : 'no-slots'} ${hasOverlap ? 'has-overlap' : ''}`}
            >
              <div className="day-col-header">
                <span className="day-name">{day.slice(0, 3)}</span>
                {hasOverlap && <span className="overlap-indicator" title="Mutual overlap on this day">●</span>}
              </div>

              <div className="day-slots-list">
                {daySlots.length === 0 ? (
                  <span className="empty-day-dash">—</span>
                ) : (
                  daySlots.map((s, idx) => (
                    <div
                      key={idx}
                      className="calendar-slot-chip"
                      onClick={() => onSelectSlot && onSelectSlot(s)}
                    >
                      {s.from} - {s.to}
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
