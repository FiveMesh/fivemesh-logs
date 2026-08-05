import type { LogsEvent } from "../shared/types";

export function dedupeLogEvents(events: LogsEvent[]): LogsEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!event.event_id || seen.has(event.event_id)) return false;
    seen.add(event.event_id);
    return true;
  });
}
