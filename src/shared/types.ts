export type LogsLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogsIdentifierFilter = {
  owner: "player" | "target";
  key: string;
  value: string;
};

export type ViewerQueryInput = {
  from: string;
  to: string;
  level?: LogsLevel;
  eventType?: string;
  resource?: string;
  message?: string;
  playerId?: string;
  identifier?: LogsIdentifierFilter;
  cursor?: string;
  limit?: number;
};

export type LogsEvent = {
  event_id: string;
  server_id: string;
  level: LogsLevel;
  event_type: string;
  occurred_at: string;
  ingested_at: string;
  player_id: string | null;
  target_player_id: string | null;
  player_identifiers: Record<string, string> | null;
  target_player_identifiers: Record<string, string> | null;
  resource: string | null;
  trace_id: string | null;
  environment: string | null;
  message: string;
  data: Record<string, unknown> | null;
};

export type LogsQuerySuccess = {
  success: true;
  events: LogsEvent[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
  range: {
    from: string;
    to: string;
  };
  requestId?: string;
};

export type LogsQueryFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
};

export type LogsQueryResult = LogsQuerySuccess | LogsQueryFailure;

export type ViewerOpenMessage = {
  type: "open";
  payload: {
    command: string;
    ingestionDelaySeconds: {
      minimum: number;
      maximum: number;
    };
  };
};

export type ViewerCloseMessage = {
  type: "close";
};
