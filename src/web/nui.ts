import type {
  LogsQueryResult,
  ViewerQueryInput,
} from "../shared/types";

declare global {
  interface Window {
    GetParentResourceName?: () => string;
  }
}

export async function postNui<T>(
  event: "close" | "query" | "ready",
  data: unknown = {},
): Promise<T> {
  if (!window.GetParentResourceName) {
    return mockResponse(event, data) as T;
  }

  const response = await fetch(
    `https://${window.GetParentResourceName()}/${event}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  return (await response.json()) as T;
}

function mockResponse(event: string, data: unknown): unknown {
  if (event === "close" || event === "ready") return { success: true };
  const query = data as ViewerQueryInput;
  const rows = mockEvents.filter((item) => {
    if (query.level && item.level !== query.level) return false;
    if (
      query.message &&
      !item.message.toLowerCase().includes(query.message.toLowerCase())
    ) {
      return false;
    }
    if (query.resource && item.resource !== query.resource) return false;
    return true;
  });
  return {
    success: true,
    events: rows,
    pagination: { hasMore: false, nextCursor: null },
    range: { from: query.from, to: query.to },
    requestId: "browser-preview",
  } satisfies LogsQueryResult;
}

const mockEvents: Extract<LogsQueryResult, { success: true }>["events"] = [
  {
    event_id: "evt_01J5MESH000000000000000001",
    server_id: "57gk77",
    level: "error",
    event_type: "inventory.transfer.failed",
    occurred_at: new Date(Date.now() - 42_000).toISOString(),
    ingested_at: new Date(Date.now() - 38_000).toISOString(),
    player_id: "18",
    target_player_id: "42",
    player_identifiers: {
      discord: "219425737212772352",
      license: "56a3d5a12e6f68d839d54d04fef3eb82",
    },
    target_player_identifiers: {
      discord: "316590837780430848",
      license: "ed772329901f881e383425b7517371ef",
    },
    resource: "ox_inventory",
    trace_id: "transfer_9812",
    environment: "production",
    message: "Player transfer was rejected because the target inventory was full",
    data: {
      item: "diamond",
      count: 5,
      from_slot: 2,
      to_inventory: "player:42",
      evidence: {
        image_url:
          "https://placehold.co/1200x675/png?text=FiveMesh+Log+Evidence",
        screenshots: [
          "https://placehold.co/900x900.jpg?text=Inventory+Snapshot",
        ],
      },
    },
  },
  {
    event_id: "evt_01J5MESH000000000000000002",
    server_id: "57gk77",
    level: "warn",
    event_type: "legacy.admin_logs.staff",
    occurred_at: new Date(Date.now() - 86_000).toISOString(),
    ingested_at: new Date(Date.now() - 79_000).toISOString(),
    player_id: "1",
    target_player_id: null,
    player_identifiers: {
      discord: "180321234567890123",
      license: "1788f13f00c841c2bcde9a1b73e25a92",
      ip: "192.0.2.42",
    },
    target_player_identifiers: null,
    resource: "_core",
    trace_id: null,
    environment: "production",
    message: "Sacul enabled noclip",
    data: { action: "noclip", enabled: true, staff_group: "admin" },
  },
  {
    event_id: "evt_01J5MESH000000000000000003",
    server_id: "57gk77",
    level: "info",
    event_type: "player.joined",
    occurred_at: new Date(Date.now() - 132_000).toISOString(),
    ingested_at: new Date(Date.now() - 126_000).toISOString(),
    player_id: "27",
    target_player_id: null,
    player_identifiers: {
      discord: "199522345678901234",
      fivem: "9821744",
      license: "64101de2cd23a16383635e31f65ef81a",
    },
    target_player_identifiers: null,
    resource: "fivemesh-sdk",
    trace_id: null,
    environment: "production",
    message: "Player Nova joined",
    data: { player_name: "Nova", ping: 42 },
  },
];
