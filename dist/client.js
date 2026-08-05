"use strict";
(() => {
  // src/client/index.ts
  var QUERY_EVENT = "fivemesh-logs:query";
  var QUERY_RESULT_EVENT = "fivemesh-logs:query-result";
  var OPEN_EVENT = "fivemesh-logs:open";
  var QUERY_TIMEOUT_MS = 35e3;
  var pendingQueries = /* @__PURE__ */ new Map();
  var nuiReady = false;
  var pendingOpenPayload = null;
  onNet(
    OPEN_EVENT,
    (payload) => {
      SetNuiFocus(true, true);
      if (nuiReady) {
        sendNuiMessage({ type: "open", payload });
      } else {
        pendingOpenPayload = payload;
      }
    }
  );
  onNet(
    QUERY_RESULT_EVENT,
    (requestId, result) => {
      const pending = pendingQueries.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingQueries.delete(requestId);
      pending.callback(result);
    }
  );
  RegisterNuiCallbackType("query");
  on(
    "__cfx_nui:query",
    (payload, callback) => {
      const requestId = createRequestId();
      const timeout = setTimeout(() => {
        pendingQueries.delete(requestId);
        callback({
          success: false,
          error: {
            code: "QUERY_TIMEOUT",
            message: "FiveMesh Logs did not respond in time."
          }
        });
      }, QUERY_TIMEOUT_MS);
      pendingQueries.set(requestId, { callback, timeout });
      emitNet(QUERY_EVENT, requestId, payload);
    }
  );
  RegisterNuiCallbackType("close");
  on("__cfx_nui:close", (_payload, callback) => {
    closeViewer();
    callback({ success: true });
  });
  RegisterNuiCallbackType("ready");
  on("__cfx_nui:ready", (_payload, callback) => {
    nuiReady = true;
    callback({ success: true });
    if (!pendingOpenPayload) return;
    const payload = pendingOpenPayload;
    pendingOpenPayload = null;
    sendNuiMessage({ type: "open", payload });
  });
  on("onClientResourceStop", (resourceName) => {
    if (resourceName !== GetCurrentResourceName()) return;
    closeViewer();
  });
  function closeViewer() {
    pendingOpenPayload = null;
    SetNuiFocus(false, false);
    if (nuiReady) sendNuiMessage({ type: "close" });
  }
  function sendNuiMessage(message) {
    SendNuiMessage(JSON.stringify(message));
  }
  function createRequestId() {
    return `${GetGameTimer().toString(36)}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
})();
