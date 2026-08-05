import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Filter,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  LogsEvent,
  LogsIdentifierFilter,
  LogsLevel,
  LogsQueryResult,
  ViewerOpenMessage,
  ViewerQueryInput,
} from "../shared/types";
import {
  extractImageUrls,
  type StructuredImage,
} from "./image-urls";
import { postNui } from "./nui";
import fiveMeshLogo from "./white_fivemesh.svg";

type DraftFilters = {
  eventType: string;
  identifierKey: string;
  identifierOwner: LogsIdentifierFilter["owner"];
  identifierValue: string;
  level: "" | LogsLevel;
  lookbackMinutes: number;
  message: string;
  playerId: string;
  resource: string;
};

const DEFAULT_FILTERS: DraftFilters = {
  eventType: "",
  identifierKey: "",
  identifierOwner: "player",
  identifierValue: "",
  level: "",
  lookbackMinutes: 360,
  message: "",
  playerId: "",
  resource: "",
};

const LEVELS: Array<"" | LogsLevel> = [
  "",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

const TIME_RANGES = [
  { label: "15 minutes", value: 15 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "24 hours", value: 1_440 },
  { label: "7 days", value: 10_080 },
];

export function App() {
  const browserPreview =
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).get("preview") === "1";
  const [visible, setVisible] = useState(browserPreview);
  const [openSequence, setOpenSequence] = useState(0);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [events, setEvents] = useState<LogsEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState<ViewerQueryInput | null>(null);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [previewImage, setPreviewImage] =
    useState<StructuredImage | null>(null);
  const openedOnce = useRef(false);
  const queryInFlight = useRef(false);

  const selectedEvent = useMemo(
    () => events.find((event) => event.event_id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = normalizeNuiMessage(event.data) as
        | ViewerOpenMessage
        | { type?: "close"; payload?: never };
      if (message?.type === "open") {
        setVisible(true);
        setOpenSequence((value) => value + 1);
      } else if (message?.type === "close") {
        setPreviewImage(null);
        setVisible(false);
      }
    };
    window.addEventListener("message", handleMessage);
    void postNui("ready").catch(() => undefined);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !visible) return;
      if (previewImage) {
        setPreviewImage(null);
        return;
      }
      void closeViewer();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage, visible]);

  useEffect(() => {
    if (!visible) return;
    if (!openedOnce.current || openSequence > 0) {
      openedOnce.current = true;
      void searchFromDraft();
    }
    // A command open is the explicit action that initiates the first search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSequence, visible]);

  async function closeViewer() {
    setPreviewImage(null);
    setVisible(false);
    await postNui("close");
  }

  function buildDraftQuery(): ViewerQueryInput | null {
    const hasIdentifierPart =
      filters.identifierKey || filters.identifierValue;
    if (
      hasIdentifierPart &&
      (!filters.identifierKey || !filters.identifierValue)
    ) {
      setAdvancedOpen(true);
      setError("Identifier key and value must be provided together.");
      return null;
    }

    const to = new Date();
    const from = new Date(
      to.getTime() - filters.lookbackMinutes * 60 * 1_000,
    );
    return compactQuery({
      from: from.toISOString(),
      to: to.toISOString(),
      level: filters.level || undefined,
      eventType: filters.eventType,
      resource: filters.resource,
      message: filters.message,
      playerId: filters.playerId,
      identifier:
        filters.identifierKey && filters.identifierValue
          ? {
              owner: filters.identifierOwner,
              key: filters.identifierKey.trim().toLowerCase(),
              value: filters.identifierValue.trim(),
            }
          : undefined,
      limit: 100,
    });
  }

  async function searchFromDraft() {
    const query = buildDraftQuery();
    if (!query) return;
    await executeQuery(query, null, 0, [null]);
  }

  async function executeQuery(
    baseQuery: ViewerQueryInput,
    cursor: string | null,
    requestedPage: number,
    requestedCursors: Array<string | null>,
  ) {
    if (queryInFlight.current) return;
    queryInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await postNui<LogsQueryResult>("query", {
        ...baseQuery,
        cursor: cursor || undefined,
      });
      if (!result.success) {
        setError(result.error.message);
        setRequestId(result.requestId ?? null);
        return;
      }

      setEvents(result.events);
      setSelectedEventId((current) =>
        result.events.some((event) => event.event_id === current)
          ? current
          : null,
      );
      setNextCursor(result.pagination.nextCursor);
      setPageIndex(requestedPage);
      setCursors(requestedCursors);
      setActiveQuery(baseQuery);
      setRequestId(result.requestId ?? null);
      setLastUpdatedAt(new Date());
    } catch {
      setError("The Logs viewer could not reach the game client.");
    } finally {
      queryInFlight.current = false;
      setLoading(false);
    }
  }

  async function refresh() {
    if (!activeQuery) {
      await searchFromDraft();
      return;
    }
    const previousFrom = new Date(activeQuery.from).getTime();
    const previousTo = new Date(activeQuery.to).getTime();
    const rangeDuration = Math.max(60_000, previousTo - previousFrom);
    const refreshedTo = new Date();
    const refreshedQuery = {
      ...activeQuery,
      from: new Date(refreshedTo.getTime() - rangeDuration).toISOString(),
      to: refreshedTo.toISOString(),
      cursor: undefined,
    };
    await executeQuery(refreshedQuery, null, 0, [null]);
  }

  async function nextPage() {
    if (!activeQuery || !nextCursor) return;
    const nextCursors = [
      ...cursors.slice(0, pageIndex + 1),
      nextCursor,
    ];
    await executeQuery(
      activeQuery,
      nextCursor,
      pageIndex + 1,
      nextCursors,
    );
  }

  async function previousPage() {
    if (!activeQuery || pageIndex === 0) return;
    const previousPage = pageIndex - 1;
    await executeQuery(
      activeQuery,
      cursors[previousPage] ?? null,
      previousPage,
      cursors,
    );
  }

  if (!visible) return null;

  return (
    <main className="viewport">
      <section className="viewer" aria-label="FiveMesh Logs viewer">
        <header className="topbar">
          <div className="brand">
            <img
              className="brand-logo"
              src={fiveMeshLogo}
              alt=""
              aria-hidden="true"
            />
            <div className="brand-title">
              <span>FiveMesh</span>
              <strong>Logs</strong>
            </div>
          </div>

          <div className="topbar-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh results"
              title="Refresh results"
            >
              <RefreshCw size={16} className={loading ? "spinning" : ""} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void closeViewer()}
              aria-label="Close Logs viewer"
              title="Close"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <section className="filter-region" aria-label="Log filters">
          <div className="primary-filters">
            <Field label="Time range" icon={<Clock3 size={14} />}>
              <div className="select-wrap">
                <select
                  value={filters.lookbackMinutes}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      lookbackMinutes: Number(event.target.value),
                    }))
                  }
                >
                  {TIME_RANGES.map((range) => (
                    <option key={range.value} value={range.value}>
                      Last {range.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </div>
            </Field>

            <Field label="Level" icon={<Filter size={14} />}>
              <div className="select-wrap">
                <select
                  value={filters.level}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      level: event.target.value as DraftFilters["level"],
                    }))
                  }
                >
                  {LEVELS.map((level) => (
                    <option key={level || "all"} value={level}>
                      {level ? titleCase(level) : "All levels"}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </div>
            </Field>

            <Field label="Message" className="filter-grow">
              <div className="input-with-icon">
                <Search size={14} />
                <input
                  value={filters.message}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  placeholder="Contains text"
                  maxLength={512}
                />
              </div>
            </Field>

            <Field label="Event type">
              <input
                value={filters.eventType}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    eventType: event.target.value,
                  }))
                }
                placeholder="player.joined"
                maxLength={256}
              />
            </Field>

            <Field label="Resource">
              <input
                value={filters.resource}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    resource: event.target.value,
                  }))
                }
                placeholder="ox_inventory"
                maxLength={256}
              />
            </Field>

            <button
              className="search-button"
              type="button"
              onClick={() => void searchFromDraft()}
              disabled={loading}
            >
              {loading ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <Search size={15} />
              )}
              Search
            </button>
          </div>

          <div className="secondary-filter-toggle">
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              aria-expanded={advancedOpen}
            >
              <SlidersHorizontal size={14} />
              Player and identifier filters
              <ChevronDown
                size={13}
                className={advancedOpen ? "rotated" : ""}
              />
            </button>
            {hasAdvancedFilters(filters) && (
              <span className="active-filter-note">
                <Check size={12} /> Active
              </span>
            )}
          </div>

          {advancedOpen && (
            <div className="advanced-filters">
              <Field label="Player handle" icon={<UserRound size={14} />}>
                <input
                  value={filters.playerId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      playerId: event.target.value,
                    }))
                  }
                  placeholder="42"
                  maxLength={128}
                />
              </Field>
              <Field label="Identifier owner">
                <div className="select-wrap">
                  <select
                    value={filters.identifierOwner}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        identifierOwner: event.target
                          .value as LogsIdentifierFilter["owner"],
                      }))
                    }
                  >
                    <option value="player">Player</option>
                    <option value="target">Target player</option>
                  </select>
                  <ChevronDown size={13} />
                </div>
              </Field>
              <Field label="Identifier key">
                <input
                  value={filters.identifierKey}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      identifierKey: event.target.value,
                    }))
                  }
                  placeholder="discord"
                  maxLength={32}
                />
              </Field>
              <Field label="Exact identifier value" className="filter-grow">
                <input
                  value={filters.identifierValue}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      identifierValue: event.target.value,
                    }))
                  }
                  placeholder="219425737212772352"
                  maxLength={256}
                />
              </Field>
              <button
                type="button"
                className="clear-button"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    playerId: "",
                    identifierKey: "",
                    identifierValue: "",
                  }))
                }
              >
                Clear
              </button>
            </div>
          )}
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
            {requestId && <code>Request {requestId}</code>}
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="content">
          <section className="results" aria-label="Log events">
            <div className="results-heading">
              <div>
                <h1>Events</h1>
                <p>
                  {loading
                    ? "Searching FiveMesh Logs…"
                    : `${events.length} event${events.length === 1 ? "" : "s"} on page ${pageIndex + 1}`}
                </p>
              </div>
              <div className="results-meta">
                {lastUpdatedAt && (
                  <span>Updated {formatRelative(lastUpdatedAt)}</span>
                )}
                <span className="sort-order">
                  <span />
                  Newest first
                </span>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Level</th>
                    <th>Event</th>
                    <th>Resource</th>
                    <th>Player</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && events.length === 0 ? (
                    <LoadingRows />
                  ) : (
                    events.map((event) => (
                      <tr
                        key={event.event_id}
                        className={
                          selectedEventId === event.event_id ? "selected" : ""
                        }
                        onClick={() => {
                          setPreviewImage(null);
                          setSelectedEventId(event.event_id);
                        }}
                      >
                        <td>
                          <time dateTime={event.occurred_at}>
                            {formatTime(event.occurred_at)}
                          </time>
                        </td>
                        <td>
                          <LevelLabel level={event.level} />
                        </td>
                        <td>
                          <code className="event-type">
                            {event.event_type}
                          </code>
                        </td>
                        <td>
                          <span className="resource-name">
                            {event.resource || "—"}
                          </span>
                        </td>
                        <td>
                          <span className="player-handle">
                            {event.player_id || "—"}
                            {event.target_player_id && (
                              <small>→ {event.target_player_id}</small>
                            )}
                          </span>
                        </td>
                        <td>
                          <span className="message-cell">{event.message}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {!loading && events.length === 0 && (
                <div className="empty-state">
                  <Search size={23} />
                  <h2>No events found</h2>
                  <p>
                    Try a wider time range or remove one of the exact filters.
                  </p>
                </div>
              )}
            </div>

            <footer className="pagination">
              <button
                type="button"
                onClick={() => void previousPage()}
                disabled={loading || pageIndex === 0}
              >
                <ArrowLeft size={14} />
                Previous
              </button>
              <span>Page {pageIndex + 1}</span>
              <button
                type="button"
                onClick={() => void nextPage()}
                disabled={loading || !nextCursor}
              >
                Next
                <ArrowRight size={14} />
              </button>
            </footer>
          </section>

          {selectedEvent && (
            <EventDetails
              event={selectedEvent}
              onClose={() => {
                setPreviewImage(null);
                setSelectedEventId(null);
              }}
              onPreviewImage={setPreviewImage}
            />
          )}
        </div>
        {previewImage && (
          <ImageLightbox
            image={previewImage}
            onClose={() => setPreviewImage(null)}
          />
        )}
      </section>
    </main>
  );
}

function Field({
  children,
  className = "",
  icon,
  label,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  label: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span>
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

function LevelLabel({ level }: { level: LogsLevel }) {
  return (
    <span className={`level level-${level}`}>
      <span />
      {level}
    </span>
  );
}

function EventDetails({
  event,
  onClose,
  onPreviewImage,
}: {
  event: LogsEvent;
  onClose: () => void;
  onPreviewImage: (image: StructuredImage) => void;
}) {
  const [copied, setCopied] = useState(false);
  const structuredImages = useMemo(
    () => extractImageUrls(event.data),
    [event.data],
  );

  async function copyEvent() {
    try {
      await writeClipboard(JSON.stringify(event, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="details" aria-label="Event details">
      <div className="details-header">
        <div>
          <span className="details-kicker">Event details</span>
          <h2>{event.event_type}</h2>
        </div>
        <div>
          <button
            type="button"
            className="icon-button"
            onClick={() => void copyEvent()}
            aria-label="Copy event JSON"
            title="Copy event JSON"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close event details"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="details-scroll">
        <section className="message-detail">
          <LevelLabel level={event.level} />
          <p>{event.message}</p>
        </section>

        <section className="detail-section">
          <h3>
            <Clock3 size={14} /> Timing
          </h3>
          <DetailRow label="Occurred" value={formatDateTime(event.occurred_at)} />
          <DetailRow label="Ingested" value={formatDateTime(event.ingested_at)} />
        </section>

        <section className="detail-section">
          <h3>
            <Server size={14} /> Context
          </h3>
          <DetailRow label="Server" value={event.server_id} mono />
          <DetailRow label="Resource" value={event.resource || "—"} mono />
          <DetailRow label="Environment" value={event.environment || "—"} />
          <DetailRow label="Trace ID" value={event.trace_id || "—"} mono />
          <DetailRow label="Event ID" value={event.event_id} mono />
        </section>

        <IdentifierSection
          title="Player"
          icon={<UserRound size={14} />}
          handle={event.player_id}
          identifiers={event.player_identifiers}
        />
        <IdentifierSection
          title="Target player"
          icon={<UsersRound size={14} />}
          handle={event.target_player_id}
          identifiers={event.target_player_identifiers}
        />

        {event.data && (
          <section className="detail-section">
            <h3>
              <Braces size={14} /> Structured data
            </h3>
            <pre>{JSON.stringify(event.data, null, 2)}</pre>
            {structuredImages.length > 0 && (
              <div className="structured-images">
                {structuredImages.map((image) => (
                  <StructuredImageThumbnail
                    key={image.url}
                    image={image}
                    onOpen={onPreviewImage}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function StructuredImageThumbnail({
  image,
  onOpen,
}: {
  image: StructuredImage;
  onOpen: (image: StructuredImage) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <button
      className="structured-image"
      type="button"
      onClick={() => onOpen(image)}
      aria-label={`Enlarge image from ${image.path}`}
      title="Click to enlarge"
    >
      <img
        src={image.url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      <span>
        <ImageIcon size={12} />
        <span>{image.path}</span>
        <Maximize2 size={12} />
      </span>
    </button>
  );
}

function ImageLightbox({
  image,
  onClose,
}: {
  image: StructuredImage;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Structured data image preview"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="image-lightbox-content">
        <div className="image-lightbox-header">
          <span>
            <ImageIcon size={13} />
            {image.path}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close image preview"
          >
            <X size={17} />
          </button>
        </div>
        {failed ? (
          <div className="image-load-error">
            <AlertCircle size={18} />
            This image could not be loaded.
          </div>
        ) : (
          <img
            src={image.url}
            alt={`Preview from ${image.path}`}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

function normalizeNuiMessage(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function IdentifierSection({
  handle,
  icon,
  identifiers,
  title,
}: {
  handle: string | null;
  icon: ReactNode;
  identifiers: Record<string, string> | null;
  title: string;
}) {
  if (!handle && !identifiers) return null;
  return (
    <section className="detail-section">
      <h3>
        {icon} {title}
      </h3>
      <DetailRow label="Handle" value={handle || "—"} mono />
      {Object.entries(identifiers ?? {}).map(([key, value]) => (
        <DetailRow key={key} label={key} value={value} mono />
      ))}
    </section>
  );
}

function DetailRow({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <span className={mono ? "mono" : ""}>{value}</span>
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => (
        <tr className="loading-row" key={index}>
          {Array.from({ length: 6 }, (_, cell) => (
            <td key={cell}>
              <span style={{ width: `${42 + ((index + cell) % 4) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function compactQuery(input: ViewerQueryInput): ViewerQueryInput {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== "" && value !== undefined),
  ) as ViewerQueryInput;
}

function hasAdvancedFilters(filters: DraftFilters): boolean {
  return Boolean(
    filters.playerId || filters.identifierKey || filters.identifierValue,
  );
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date);
}

function formatRelative(value: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - value.getTime()) / 1_000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
