import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServices, executeMediaAsset, prepareUiAudio, readReadyMedia, readUiAudio, type Services } from "@learning/server";
import { messages } from "@learning/contracts";
import { testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";
import { handleKidApi } from "../../apps/web/src/kid/kid-router";
import { ttsFingerprint } from "../../packages/server/src/domain/media-fingerprint";

const { pool } = testDatabase();
const disposers: Array<() => Promise<void>> = [];
let fakes: FakeGeneration;
let services: Services;

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await truncateCoreTables();
  await pool.query("truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets cascade");
});
beforeEach(async () => {
  fakes = await fakeGeneration();
  disposers.push(fakes.dispose);
  services = createServices({ db: testDatabase().db, media: fakes.settings, generation: fakes.deps, mediaStore: fakes.store });
});
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

describe("wskazówki głosowe Kid UI (integracja)", () => {
  it("GET jest tylko odczytem i nie zleca ani nie syntezuje brakującego audio", async () => {
    const response = await handleKidApi(new Request("http://local/api/v1/kid/ui-audio"), services, ["ui-audio"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: false, assets: {} });
    expect(await rows("select id from learning_app.media_assets")).toHaveLength(0);
    expect(fakes.tts.requests).toHaveLength(0);
  });

  it("kolejne prepare jest idempotentne, executor tworzy 17 gotowych plików, a zmiana głosu zachowuje stare bajty", async () => {
    await prepareUiAudio(services);
    await prepareUiAudio(services);
    const pending = await rows<{ id: string; metadata: { text: string } }>(
      "select id, metadata from learning_app.media_assets where state = 'pending' order by id",
    );
    expect(pending).toHaveLength(17);
    expect(await rows("select id from learning_app.generation_runs where kind = 'tts'")).toHaveLength(17);
    expect(fakes.tts.requests).toHaveLength(0);
    for (const asset of pending) await executeMediaAsset(services, asset.id);
    expect(fakes.tts.requests.map((request) => request.text).sort())
      .toEqual(Object.values(messages.uiAudio).sort());
    const ready = await readUiAudio(services);
    expect(ready.ready).toBe(true);
    expect(Object.keys(ready.assets)).toHaveLength(17);
    const oldId = ready.assets.summary!;
    const oldMedia = await readReadyMedia(services, oldId);
    expect(oldMedia?.mimeType).toBe("audio/mpeg");
    const oldContent = oldMedia?.bytes;

    const changedSettings = structuredClone(fakes.settings);
    changedSettings.tts.voice = "fake-voice-v2";
    const changedServices = createServices({ db: services.db, media: changedSettings, generation: fakes.deps, mediaStore: fakes.store });
    await prepareUiAudio(changedServices);
    expect(await rows("select id from learning_app.media_assets")).toHaveLength(34);
    expect(await rows("select id from learning_app.media_assets where state = 'pending'")).toHaveLength(17);
    const oldAfter = await readReadyMedia(services, oldId);
    expect(oldAfter?.bytes).toEqual(oldContent);
    expect((await readUiAudio(changedServices)).ready).toBe(false);
  });

  it("po awarii TTS read pozostaje niegotowy, a kolejne prepare tworzy nową generację", async () => {
    await prepareUiAudio(services);
    fakes.tts.failuresLeft = 3;
    const [oneAsset] = await rows<{ id: string }>("select id from learning_app.media_assets where state = 'pending' order by id limit 1");
    for (let attempt = 0; attempt < 3; attempt++) await executeMediaAsset(services, oneAsset!.id);
    expect((await readUiAudio(services)).ready).toBe(false);
    const before = await rows<{ count: number }>("select count(*)::int as count from learning_app.media_assets");
    await prepareUiAudio(services);
    const after = await rows<{ count: number }>("select count(*)::int as count from learning_app.media_assets");
    expect(after[0]!.count).toBeGreaterThan(before[0]!.count);
  });

  it("równoległe workery współdzielą jeden pending asset per fingerprint", async () => {
    await Promise.all([prepareUiAudio(services), prepareUiAudio(services)]);
    expect(await rows("select id from learning_app.media_assets")).toHaveLength(17);
    expect(await rows("select id from learning_app.generation_runs where kind = 'tts'")).toHaveLength(17);
  });

  it("nadal wygasza osierocony TTS bez poprawnego znacznika Kid UI", async () => {
    const text = "legacy orphan";
    const fingerprint = ttsFingerprint({
      text, locale: "en-GB", provider: fakes.settings.tts.provider, model: fakes.settings.tts.model,
      voice: fakes.settings.tts.voice, format: fakes.settings.tts.format,
    });
    const assetId = randomUUID();
    await pool.query(
      `insert into learning_app.media_assets(id, kind, fingerprint, generation_number, state, provider, model, metadata)
       values ($1, 'tts', $2, 1, 'pending', $3, $4, $5)`,
      [assetId, fingerprint, fakes.settings.tts.provider, fakes.settings.tts.model,
        { text, locale: "en-GB", voice: fakes.settings.tts.voice, format: "mp3" }],
    );
    const runId = randomUUID();
    await pool.query(
      `insert into learning_app.generation_runs(id, asset_id, kind, dedupe_key, state, input)
       values ($1, $2, 'tts', $3, 'queued', $4)`,
      [runId, assetId, `asset:${assetId}`, { text }],
    );
    await executeMediaAsset(services, assetId);
    const [asset] = await rows<{ state: string }>("select state from learning_app.media_assets where id = $1", [assetId]);
    const [run] = await rows<{ state: string }>("select state from learning_app.generation_runs where id = $1", [runId]);
    expect(asset?.state).toBe("failed");
    expect(run?.state).toBe("superseded");
    expect(fakes.tts.requests).toHaveLength(0);
  });
});
