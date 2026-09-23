/** One appointment on the calendar that lives in this browser. */
export interface CalendarEvent {
  id: string
  title: string
  /**
   * Local wall time, `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DD` when the event lasts
   * the whole day. Stored as a string so a later timezone change cannot slide it.
   */
  start: string
  /** Same shape as `start`. Absent when the event is a single moment or one all-day date. */
  end?: string
  location?: string
  notes?: string
  /** Who wrote it. The panel and the model share the store, and the list says which. */
  source: 'model' | 'user'
  createdAt: number
  updatedAt: number
}

/**
 * How many appointments this browser keeps. A calendar the model can add to
 * without a cap grows for as long as the tab is used.
 */
export const MAX_EVENTS = 200

/** Events older than this are dropped the next time one is saved. Future ones are not. */
export const PRUNE_AFTER_DAYS = 90

export const MAX_TITLE_CHARS = 120
export const MAX_LOCATION_CHARS = 80
export const MAX_NOTES_CHARS = 240
