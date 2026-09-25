import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@heroui/react/button'
import { Drawer } from '@heroui/react/drawer'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { TextField } from '@heroui/react/textfield'
import { CalendarIcon, TrashIcon } from './ui/icons'
import { onCalendarChange, readEvents } from '@/calendar/db'
import { addEvent, removeEvent, upcomingEvents } from '@/calendar/manage'
import type { CalendarEvent } from '@/calendar/types'
import { formatWhen, resolveWhen } from '@/calendar/when'
import { useT } from '@/i18n'

/**
 * The calendar Jarvis can actually operate.
 *
 * It lives in this browser, next to chats and memories. A Google or Apple
 * calendar cannot be driven from a static page without that account's own
 * sign-in, so this is the one the model adds to, moves and cancels.
 */
export function CalendarPanel() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState('')
  const [location, setLocation] = useState('')
  const t = useT()

  useEffect(() => {
    let live = true
    const refresh = (): void => {
      void readEvents().then((records) => {
        if (live) setEvents(upcomingEvents(records))
      })
    }
    refresh()
    const stop = onCalendarChange(refresh)
    return () => {
      live = false
      stop()
    }
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || !when.trim()) return
    let span: ReturnType<typeof resolveWhen>
    try {
      span = resolveWhen(when)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
      return
    }
    void addEvent({
      title: trimmed,
      start: span.start,
      ...(span.end ? { end: span.end } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      source: 'user',
    })
      .then(() => {
        setTitle('')
        setWhen('')
        setLocation('')
        setFailure(null)
      })
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <Drawer>
      <Button size="sm" variant="ghost">
        <CalendarIcon />
        {t('header.calendar')}
      </Button>

      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.Header>
              <Drawer.Heading>{t('header.calendar')}</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>

            <Drawer.Body className="flex flex-col gap-4">
              <p className="text-xs text-muted">
                Kept in this browser, in IndexedDB, and never sent anywhere. Jarvis can add, move and cancel
                these. It is not signed in to Google or Apple.
              </p>

              {failure && (
                <p className="text-xs text-danger" role="alert">
                  {failure}
                </p>
              )}

              {events.length === 0 ? (
                <p className="text-sm text-muted">
                  Nothing coming up. Ask Jarvis to book something, or add one below.
                </p>
              ) : (
                <ul aria-label="Upcoming events" className="space-y-2">
                  {events.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-xl border border-border/70 bg-surface-secondary/60 p-2.5 text-sm"
                    >
                      <p className="font-medium [overflow-wrap:anywhere]">{entry.title}</p>
                      <p className="text-xs text-muted">{formatWhen(entry.start, entry.end)}</p>
                      {entry.location && <p className="text-xs text-muted">{entry.location}</p>}
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted">
                          {entry.source === 'model' ? 'added by Jarvis' : 'added by you'}
                        </span>
                        <Button
                          aria-label={`Delete event: ${entry.title}`}
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          onPress={() => void removeEvent(entry.id)}
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form className="space-y-3 border-t border-border pt-3" onSubmit={submit}>
                <TextField value={title} onChange={setTitle}>
                  <Label>Title</Label>
                  <Input placeholder="Dentist" />
                </TextField>
                <TextField value={when} onChange={setWhen}>
                  <Label>When</Label>
                  <Input placeholder="Friday 15:00" />
                </TextField>
                <TextField value={location} onChange={setLocation}>
                  <Label>Where</Label>
                  <Input placeholder="Optional" />
                </TextField>
                <Button
                  fullWidth
                  isDisabled={!title.trim() || !when.trim()}
                  size="sm"
                  type="submit"
                  variant="secondary"
                >
                  Add event
                </Button>
              </form>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  )
}
