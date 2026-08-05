import assert from "node:assert/strict";
import test from "node:test";

import { validateViewerQuery } from "../src/server/query-validation";
import { dedupeLogEvents } from "../src/server/dedupe";
import type { LogsEvent } from "../src/shared/types";
import { extractImageUrls } from "../src/web/image-urls";

const now = new Date("2026-08-05T12:00:00.000Z");

test("accepts the public filter contract without tenant fields", () => {
  assert.deepEqual(
    validateViewerQuery(
      {
        from: "2026-08-05T06:00:00.000Z",
        to: "2026-08-05T12:00:00.000Z",
        level: "error",
        playerId: "42",
        identifier: {
          owner: "player",
          key: "discord",
          value: "123",
        },
        limit: 50,
      },
      now,
    ),
    {
      from: "2026-08-05T06:00:00.000Z",
      to: "2026-08-05T12:00:00.000Z",
      level: "error",
      playerId: "42",
      identifier: {
        owner: "player",
        key: "discord",
        value: "123",
      },
      limit: 50,
    },
  );
});

test("omits empty bridge fields instead of forwarding null", () => {
  const query = validateViewerQuery(
    {
      from: "2026-08-05T06:00:00.000Z",
      to: "2026-08-05T12:00:00.000Z",
      level: null,
      identifier: null,
    },
    now,
  );

  assert.equal("level" in query, false);
  assert.equal("identifier" in query, false);
});

test("rejects server and workspace overrides from NUI", () => {
  assert.throws(
    () =>
      validateViewerQuery(
        {
          from: "2026-08-05T06:00:00.000Z",
          to: "2026-08-05T12:00:00.000Z",
          serverId: "another-server",
        },
        now,
      ),
    /serverId.*not allowed/,
  );
  assert.throws(
    () =>
      validateViewerQuery(
        {
          from: "2026-08-05T06:00:00.000Z",
          to: "2026-08-05T12:00:00.000Z",
          workspaceId: "another-workspace",
        },
        now,
      ),
    /workspaceId.*not allowed/,
  );
});

test("rejects incomplete identifiers and over-wide ranges", () => {
  assert.throws(
    () =>
      validateViewerQuery(
        {
          from: "2026-08-05T06:00:00.000Z",
          to: "2026-08-05T12:00:00.000Z",
          identifier: { owner: "player", key: "discord" },
        },
        now,
      ),
    /identifier filter is invalid/,
  );
  assert.throws(
    () =>
      validateViewerQuery(
        {
          from: "2026-07-28T12:00:00.000Z",
          to: "2026-08-05T12:00:00.000Z",
        },
        now,
      ),
    /time range is invalid/,
  );
});

test("hides replayed Pipeline rows with the same event id", () => {
  const base: LogsEvent = {
    event_id: "event_replayed_0001",
    server_id: "57gk77",
    level: "info",
    event_type: "player.joined",
    occurred_at: "2026-08-05T12:00:00.000Z",
    ingested_at: "2026-08-05T12:00:01.000Z",
    player_id: "42",
    target_player_id: null,
    player_identifiers: null,
    target_player_identifiers: null,
    resource: "fivem",
    trace_id: null,
    environment: "production",
    message: "Player joined",
    data: null,
  };

  assert.deepEqual(
    dedupeLogEvents([
      base,
      { ...base, ingested_at: "2026-08-05T12:01:00.000Z" },
      { ...base, event_id: "event_distinct_0002" },
    ]).map((event) => event.event_id),
    ["event_replayed_0001", "event_distinct_0002"],
  );
});

test("finds and deduplicates safe image URLs in nested structured data", () => {
  const images = extractImageUrls({
    evidence: {
      image_url: "https://cdn.example.com/signed/evidence?id=12",
      screenshots: [
        "https://cdn.example.com/scene.webp?token=abc",
        "https://cdn.example.com/scene.webp?token=abc",
      ],
    },
    generic: "https://cdn.example.com/not-an-image",
  });

  assert.deepEqual(images, [
    {
      path: "evidence.image_url",
      url: "https://cdn.example.com/signed/evidence?id=12",
    },
    {
      path: "evidence.screenshots[0]",
      url: "https://cdn.example.com/scene.webp?token=abc",
    },
  ]);
});

test("does not embed active, insecure, private, or non-image URLs", () => {
  assert.deepEqual(
    extractImageUrls({
      image_url: "javascript:alert(1)",
      insecure_image: "http://cdn.example.com/evidence.png",
      internal_image: "https://127.0.0.1/private.png",
      mapped_internal_image:
        "https://[::ffff:127.0.0.1]/private.png",
      local_image: "https://logs.internal/private.png",
      ordinary_url: "https://example.com/account",
    }),
    [],
  );
});
