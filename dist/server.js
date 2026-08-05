"use strict";

// src/server/query-validation.ts
var LEVELS = /* @__PURE__ */ new Set([
  "debug",
  "info",
  "warn",
  "error",
  "fatal"
]);
var MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1e3;
var MAX_FUTURE_SKEW_MS = 5 * 60 * 1e3;
var ViewerQueryValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ViewerQueryValidationError";
  }
};
function validateViewerQuery(value, now = /* @__PURE__ */ new Date()) {
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
    "limit"
  ]);
  const from = requiredDate(input.from, "from");
  const to = requiredDate(input.to, "to");
  if (from > to || to.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new ViewerQueryValidationError("The Logs time range is invalid.");
  }
  const level = optionalString(input.level, "level", 16);
  if (level && !LEVELS.has(level)) {
    throw new ViewerQueryValidationError("The Logs level is invalid.");
  }
  const limit = input.limit === void 0 ? 100 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ViewerQueryValidationError(
      "The Logs result limit must be between 1 and 100."
    );
  }
  const query = {
    from: from.toISOString(),
    to: to.toISOString(),
    limit
  };
  const eventType = optionalString(input.eventType, "eventType", 256);
  const resource = optionalString(input.resource, "resource", 256);
  const message = optionalString(input.message, "message", 512);
  const playerId = optionalString(input.playerId, "playerId", 128);
  const identifier = validateIdentifier(input.identifier);
  const cursor = optionalString(input.cursor, "cursor", 2048);
  if (level) query.level = level;
  if (eventType) query.eventType = eventType;
  if (resource) query.resource = resource;
  if (message) query.message = message;
  if (playerId) query.playerId = playerId;
  if (identifier) query.identifier = identifier;
  if (cursor) query.cursor = cursor;
  return query;
}
function validateIdentifier(value) {
  if (value === void 0 || value === null) return void 0;
  const input = asRecord(value);
  rejectUnknownKeys(input, ["owner", "key", "value"]);
  const owner = optionalString(input.owner, "identifier.owner", 16);
  const key = optionalString(input.key, "identifier.key", 32);
  const identifierValue = optionalString(
    input.value,
    "identifier.value",
    256
  );
  if (!owner && !key && !identifierValue) return void 0;
  if (owner !== "player" && owner !== "target" || !key || !/^[a-z][a-z0-9_]{0,31}$/.test(key) || !identifierValue) {
    throw new ViewerQueryValidationError(
      "The exact identifier filter is invalid."
    );
  }
  return { owner, key, value: identifierValue };
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ViewerQueryValidationError("The Logs query body is invalid.");
  }
  return value;
}
function rejectUnknownKeys(value, allowed) {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) {
    throw new ViewerQueryValidationError(
      `The Logs query field "${unknown}" is not allowed.`
    );
  }
}
function requiredDate(value, label) {
  if (typeof value !== "string") {
    throw new ViewerQueryValidationError(`${label} is required.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ViewerQueryValidationError(
      `${label} must be an RFC 3339 timestamp.`
    );
  }
  return date;
}
function optionalString(value, label, maximum) {
  if (value === void 0 || value === null || value === "") return void 0;
  if (typeof value !== "string") {
    throw new ViewerQueryValidationError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) return void 0;
  if (normalized.length > maximum) {
    throw new ViewerQueryValidationError(
      `${label} must be ${maximum} characters or less.`
    );
  }
  return normalized;
}

// src/server/dedupe.ts
function dedupeLogEvents(events) {
  const seen = /* @__PURE__ */ new Set();
  return events.filter((event) => {
    if (!event.event_id || seen.has(event.event_id)) return false;
    seen.add(event.event_id);
    return true;
  });
}

// src/server/index.ts
var SDK_RESOURCE = "fivemesh-sdk";
var QUERY_EVENT = "fivemesh-logs:query";
var QUERY_RESULT_EVENT = "fivemesh-logs:query-result";
var OPEN_EVENT = "fivemesh-logs:open";
var MIN_QUERY_INTERVAL_MS = 750;
var command = GetConvar("FIVEMESH_LOGS_VIEWER_COMMAND", "fmlogs").trim();
var acePermission = GetConvar(
  "FIVEMESH_LOGS_VIEWER_ACE",
  "fivemesh.logs.view"
).trim();
var inFlightPlayers = /* @__PURE__ */ new Set();
var lastQueryAtByPlayer = /* @__PURE__ */ new Map();
RegisterCommand(
  command,
  (playerSource) => {
    if (playerSource <= 0) {
      console.log(
        `[FiveMesh Logs] The /${command} command can only be used in game.`
      );
      return;
    }
    if (!canViewLogs(playerSource)) {
      emitNet(
        "chat:addMessage",
        playerSource,
        {
          color: [220, 70, 70],
          args: ["FiveMesh Logs", "You are not allowed to view server logs."]
        }
      );
      return;
    }
    emitNet(OPEN_EVENT, playerSource, {
      command,
      ingestionDelaySeconds: { minimum: 60, maximum: 120 }
    });
  },
  false
);
onNet(QUERY_EVENT, async (requestId, payload) => {
  const playerSource = Number(global.source);
  if (!Number.isInteger(playerSource) || playerSource <= 0 || typeof requestId !== "string" || requestId.length < 8 || requestId.length > 128) {
    return;
  }
  if (!canViewLogs(playerSource)) {
    sendFailure(
      playerSource,
      requestId,
      "FORBIDDEN",
      "You are not allowed to view server logs."
    );
    return;
  }
  if (GetResourceState(SDK_RESOURCE) !== "started") {
    sendFailure(
      playerSource,
      requestId,
      "SDK_UNAVAILABLE",
      "The FiveMesh SDK is not running."
    );
    return;
  }
  const now = Date.now();
  const lastQueryAt = lastQueryAtByPlayer.get(playerSource) ?? 0;
  if (inFlightPlayers.has(playerSource) || now - lastQueryAt < MIN_QUERY_INTERVAL_MS) {
    sendFailure(
      playerSource,
      requestId,
      "QUERY_RATE_LIMITED",
      "Wait for the current Logs search to finish."
    );
    return;
  }
  let query;
  try {
    query = validateViewerQuery(payload);
  } catch (error) {
    sendFailure(
      playerSource,
      requestId,
      "VALIDATION_ERROR",
      error instanceof ViewerQueryValidationError ? error.message : "The Logs query is invalid."
    );
    return;
  }
  inFlightPlayers.add(playerSource);
  lastQueryAtByPlayer.set(playerSource, now);
  try {
    const sdk = exports[SDK_RESOURCE];
    if (typeof sdk?.queryLogs !== "function") {
      sendFailure(
        playerSource,
        requestId,
        "SDK_UNAVAILABLE",
        "The installed FiveMesh SDK does not support Logs queries."
      );
      return;
    }
    const result = await sdk.queryLogs(query);
    emitNet(QUERY_RESULT_EVENT, playerSource, requestId, sanitizeResult(result));
  } catch (error) {
    console.error("[FiveMesh Logs] SDK query failed.", {
      playerSource,
      reason: error instanceof Error ? error.message : String(error)
    });
    sendFailure(
      playerSource,
      requestId,
      "QUERY_FAILED",
      "FiveMesh Logs is temporarily unavailable."
    );
  } finally {
    inFlightPlayers.delete(playerSource);
  }
});
on("playerDropped", () => {
  const playerSource = Number(global.source);
  inFlightPlayers.delete(playerSource);
  lastQueryAtByPlayer.delete(playerSource);
});
on("onResourceStart", (resourceName) => {
  if (resourceName !== GetCurrentResourceName()) return;
  if (GetResourceState(SDK_RESOURCE) !== "started") {
    console.error(
      `[FiveMesh Logs] Required resource "${SDK_RESOURCE}" is not started.`
    );
    return;
  }
  console.log(
    `[FiveMesh Logs] Ready. Command: /${command}. ACE: ${acePermission}.`
  );
});
function canViewLogs(playerSource) {
  return Boolean(
    acePermission && IsPlayerAceAllowed(String(playerSource), acePermission)
  );
}
function sanitizeResult(result) {
  if (result?.success) {
    return {
      ...result,
      events: dedupeLogEvents(result.events)
    };
  }
  return {
    success: false,
    error: {
      code: safeText(result?.error?.code, "QUERY_FAILED", 64),
      message: safeText(
        result?.error?.message,
        "FiveMesh Logs search failed.",
        300
      )
    },
    requestId: safeOptionalText(result?.requestId, 128)
  };
}
function sendFailure(playerSource, requestId, code, message) {
  const result = {
    success: false,
    error: { code, message }
  };
  emitNet(QUERY_RESULT_EVENT, playerSource, requestId, result);
}
function safeText(value, fallback, maximum) {
  return typeof value === "string" && value ? value.slice(0, maximum) : fallback;
}
function safeOptionalText(value, maximum) {
  return typeof value === "string" && value ? value.slice(0, maximum) : void 0;
}
