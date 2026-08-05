import type {
  LogsQueryFailure,
  LogsQueryResult,
  ViewerQueryInput,
} from "../shared/types";
import {
  validateViewerQuery,
  ViewerQueryValidationError,
} from "./query-validation";
import { dedupeLogEvents } from "./dedupe";

const SDK_RESOURCE = "fivemesh-sdk";
const QUERY_EVENT = "fivemesh-logs:query";
const QUERY_RESULT_EVENT = "fivemesh-logs:query-result";
const OPEN_EVENT = "fivemesh-logs:open";
const MIN_QUERY_INTERVAL_MS = 750;

const command = GetConvar("FIVEMESH_LOGS_VIEWER_COMMAND", "fmlogs").trim();
const acePermission = GetConvar(
  "FIVEMESH_LOGS_VIEWER_ACE",
  "fivemesh.logs.view",
).trim();
const inFlightPlayers = new Set<number>();
const lastQueryAtByPlayer = new Map<number, number>();

RegisterCommand(
  command,
  (playerSource: number) => {
    if (playerSource <= 0) {
      console.log(
        `[FiveMesh Logs] The /${command} command can only be used in game.`,
      );
      return;
    }
    if (!canViewLogs(playerSource)) {
      emitNet(
        "chat:addMessage",
        playerSource,
        {
          color: [220, 70, 70],
          args: ["FiveMesh Logs", "You are not allowed to view server logs."],
        },
      );
      return;
    }
    emitNet(OPEN_EVENT, playerSource, {
      command,
      ingestionDelaySeconds: { minimum: 60, maximum: 120 },
    });
  },
  false,
);

onNet(QUERY_EVENT, async (requestId: unknown, payload: unknown) => {
  const playerSource = Number(global.source);
  if (
    !Number.isInteger(playerSource) ||
    playerSource <= 0 ||
    typeof requestId !== "string" ||
    requestId.length < 8 ||
    requestId.length > 128
  ) {
    return;
  }

  if (!canViewLogs(playerSource)) {
    sendFailure(
      playerSource,
      requestId,
      "FORBIDDEN",
      "You are not allowed to view server logs.",
    );
    return;
  }
  if (GetResourceState(SDK_RESOURCE) !== "started") {
    sendFailure(
      playerSource,
      requestId,
      "SDK_UNAVAILABLE",
      "The FiveMesh SDK is not running.",
    );
    return;
  }

  const now = Date.now();
  const lastQueryAt = lastQueryAtByPlayer.get(playerSource) ?? 0;
  if (
    inFlightPlayers.has(playerSource) ||
    now - lastQueryAt < MIN_QUERY_INTERVAL_MS
  ) {
    sendFailure(
      playerSource,
      requestId,
      "QUERY_RATE_LIMITED",
      "Wait for the current Logs search to finish.",
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
      error instanceof ViewerQueryValidationError
        ? error.message
        : "The Logs query is invalid.",
    );
    return;
  }

  inFlightPlayers.add(playerSource);
  lastQueryAtByPlayer.set(playerSource, now);
  try {
    const sdk = exports[SDK_RESOURCE] as
      | {
          queryLogs?: (input: ViewerQueryInput) => Promise<LogsQueryResult>;
        }
      | undefined;
    if (typeof sdk?.queryLogs !== "function") {
      sendFailure(
        playerSource,
        requestId,
        "SDK_UNAVAILABLE",
        "The installed FiveMesh SDK does not support Logs queries.",
      );
      return;
    }
    const result = await sdk.queryLogs(query);
    emitNet(QUERY_RESULT_EVENT, playerSource, requestId, sanitizeResult(result));
  } catch (error) {
    console.error("[FiveMesh Logs] SDK query failed.", {
      playerSource,
      reason: error instanceof Error ? error.message : String(error),
    });
    sendFailure(
      playerSource,
      requestId,
      "QUERY_FAILED",
      "FiveMesh Logs is temporarily unavailable.",
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

on("onResourceStart", (resourceName: string) => {
  if (resourceName !== GetCurrentResourceName()) return;
  if (GetResourceState(SDK_RESOURCE) !== "started") {
    console.error(
      `[FiveMesh Logs] Required resource "${SDK_RESOURCE}" is not started.`,
    );
    return;
  }
  console.log(
    `[FiveMesh Logs] Ready. Command: /${command}. ACE: ${acePermission}.`,
  );
});

function canViewLogs(playerSource: number): boolean {
  return Boolean(
    acePermission &&
      IsPlayerAceAllowed(String(playerSource), acePermission),
  );
}

function sanitizeResult(result: LogsQueryResult): LogsQueryResult {
  if (result?.success) {
    return {
      ...result,
      events: dedupeLogEvents(result.events),
    };
  }
  return {
    success: false,
    error: {
      code: safeText(result?.error?.code, "QUERY_FAILED", 64),
      message: safeText(
        result?.error?.message,
        "FiveMesh Logs search failed.",
        300,
      ),
    },
    requestId: safeOptionalText(result?.requestId, 128),
  };
}

function sendFailure(
  playerSource: number,
  requestId: string,
  code: string,
  message: string,
): void {
  const result: LogsQueryFailure = {
    success: false,
    error: { code, message },
  };
  emitNet(QUERY_RESULT_EVENT, playerSource, requestId, result);
}

function safeText(
  value: unknown,
  fallback: string,
  maximum: number,
): string {
  return typeof value === "string" && value
    ? value.slice(0, maximum)
    : fallback;
}

function safeOptionalText(
  value: unknown,
  maximum: number,
): string | undefined {
  return typeof value === "string" && value
    ? value.slice(0, maximum)
    : undefined;
}
