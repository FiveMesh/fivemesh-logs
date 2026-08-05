import type {
  LogsQueryResult,
  ViewerCloseMessage,
  ViewerOpenMessage,
  ViewerQueryInput,
} from "../shared/types";

type NuiCallback = (result: LogsQueryResult | { success: true }) => void;

const QUERY_EVENT = "fivemesh-logs:query";
const QUERY_RESULT_EVENT = "fivemesh-logs:query-result";
const OPEN_EVENT = "fivemesh-logs:open";
const QUERY_TIMEOUT_MS = 35_000;
const pendingQueries = new Map<
  string,
  { callback: NuiCallback; timeout: ReturnType<typeof setTimeout> }
>();
let nuiReady = false;
let pendingOpenPayload: ViewerOpenMessage["payload"] | null = null;

onNet(
  OPEN_EVENT,
  (payload: ViewerOpenMessage["payload"]) => {
    SetNuiFocus(true, true);
    if (nuiReady) {
      sendNuiMessage({ type: "open", payload });
    } else {
      pendingOpenPayload = payload;
    }
  },
);

onNet(
  QUERY_RESULT_EVENT,
  (requestId: string, result: LogsQueryResult) => {
    const pending = pendingQueries.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingQueries.delete(requestId);
    pending.callback(result);
  },
);

RegisterNuiCallbackType("query");
on(
  "__cfx_nui:query",
  (payload: ViewerQueryInput, callback: NuiCallback) => {
    const requestId = createRequestId();
    const timeout = setTimeout(() => {
      pendingQueries.delete(requestId);
      callback({
        success: false,
        error: {
          code: "QUERY_TIMEOUT",
          message: "FiveMesh Logs did not respond in time.",
        },
      });
    }, QUERY_TIMEOUT_MS);
    pendingQueries.set(requestId, { callback, timeout });
    emitNet(QUERY_EVENT, requestId, payload);
  },
);

RegisterNuiCallbackType("close");
on("__cfx_nui:close", (_payload: unknown, callback: NuiCallback) => {
  closeViewer();
  callback({ success: true });
});

RegisterNuiCallbackType("ready");
on("__cfx_nui:ready", (_payload: unknown, callback: NuiCallback) => {
  nuiReady = true;
  callback({ success: true });
  if (!pendingOpenPayload) return;

  const payload = pendingOpenPayload;
  pendingOpenPayload = null;
  sendNuiMessage({ type: "open", payload });
});

on("onClientResourceStop", (resourceName: string) => {
  if (resourceName !== GetCurrentResourceName()) return;
  closeViewer();
});

function closeViewer(): void {
  pendingOpenPayload = null;
  SetNuiFocus(false, false);
  if (nuiReady) sendNuiMessage({ type: "close" });
}

function sendNuiMessage(message: ViewerOpenMessage | ViewerCloseMessage): void {
  SendNuiMessage(JSON.stringify(message));
}

function createRequestId(): string {
  return `${GetGameTimer().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}-${Date.now().toString(36)}`;
}
