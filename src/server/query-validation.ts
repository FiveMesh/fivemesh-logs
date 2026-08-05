import type {
  LogsIdentifierFilter,
  LogsLevel,
  ViewerQueryInput,
} from "../shared/types";

const LEVELS = new Set<LogsLevel>([
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);
const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export class ViewerQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewerQueryValidationError";
  }
}

export function validateViewerQuery(
  value: unknown,
  now = new Date(),
): ViewerQueryInput {
  const input = asRecord(value);
  rejectUnknownKeys(input, [
    "from",
    "to",
    "level",
    "eventType",
    "resource",
    "message",
    "playerId",
    "identifier",
    "cursor",
    "limit",
  ]);

  const from = requiredDate(input.from, "from");
  const to = requiredDate(input.to, "to");
  if (
    from > to ||
    to.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS ||
    to.getTime() - from.getTime() > MAX_RANGE_MS
  ) {
    throw new ViewerQueryValidationError("The Logs time range is invalid.");
  }

  const level = optionalString(input.level, "level", 16) as
    | LogsLevel
    | undefined;
  if (level && !LEVELS.has(level)) {
    throw new ViewerQueryValidationError("The Logs level is invalid.");
  }

  const limit = input.limit === undefined ? 100 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ViewerQueryValidationError(
      "The Logs result limit must be between 1 and 100.",
    );
  }

  const query: ViewerQueryInput = {
    from: from.toISOString(),
    to: to.toISOString(),
    limit,
  };
  const eventType = optionalString(input.eventType, "eventType", 256);
  const resource = optionalString(input.resource, "resource", 256);
  const message = optionalString(input.message, "message", 512);
  const playerId = optionalString(input.playerId, "playerId", 128);
  const identifier = validateIdentifier(input.identifier);
  const cursor = optionalString(input.cursor, "cursor", 2_048);

  if (level) query.level = level;
  if (eventType) query.eventType = eventType;
  if (resource) query.resource = resource;
  if (message) query.message = message;
  if (playerId) query.playerId = playerId;
  if (identifier) query.identifier = identifier;
  if (cursor) query.cursor = cursor;
  return query;
}

function validateIdentifier(value: unknown): LogsIdentifierFilter | undefined {
  if (value === undefined || value === null) return undefined;
  const input = asRecord(value);
  rejectUnknownKeys(input, ["owner", "key", "value"]);
  const owner = optionalString(input.owner, "identifier.owner", 16);
  const key = optionalString(input.key, "identifier.key", 32);
  const identifierValue = optionalString(
    input.value,
    "identifier.value",
    256,
  );
  if (!owner && !key && !identifierValue) return undefined;
  if (
    (owner !== "player" && owner !== "target") ||
    !key ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(key) ||
    !identifierValue
  ) {
    throw new ViewerQueryValidationError(
      "The exact identifier filter is invalid.",
    );
  }
  return { owner, key, value: identifierValue };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ViewerQueryValidationError("The Logs query body is invalid.");
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) {
    throw new ViewerQueryValidationError(
      `The Logs query field "${unknown}" is not allowed.`,
    );
  }
}

function requiredDate(value: unknown, label: string): Date {
  if (typeof value !== "string") {
    throw new ViewerQueryValidationError(`${label} is required.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ViewerQueryValidationError(
      `${label} must be an RFC 3339 timestamp.`,
    );
  }
  return date;
}

function optionalString(
  value: unknown,
  label: string,
  maximum: number,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ViewerQueryValidationError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximum) {
    throw new ViewerQueryValidationError(
      `${label} must be ${maximum} characters or less.`,
    );
  }
  return normalized;
}
