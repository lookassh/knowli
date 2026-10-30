import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServices, executeMediaAsset, prepareUiAudio, readReadyMedia, readUiAudio, type Services } from "@learning/server";
import { messages } from "@learning/contracts";
import { testDatabase, truncateCoreTables, handleKidApi } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";
import { ttsFingerprint } from "../../packages/server/src/domain/media-fingerprint";
import { pcmToWav } from "../../packages/server/src/providers/audio/wav";
import { STYLE_SENTENCES_PL } from "../../packages/server/src/providers/tts-style-profile";
import type { TtsProvider, TtsSynthesizeInput } from "../../packages/server/src/ports/ai";

const { pool } = testDatabase();
const disposers: Array<() => Promise<void>> = [];
let fakes: FakeGeneration;
let services: Services;

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

/** Usługi z włączonym stylem wypowiedzi (instrukcja języka + zdanie stylu roli). */
function styledServicesOf(base: Services): Services {
  const settings = structuredClone(fakes.settings);
  settings.tts.style = "instructions";
  settings.tts.instructions = { "pl-PL": "PL." };
  return createServices({ db: base.db, media: settings, generation: fakes.deps, mediaStore: fakes.store });
}

/** Wykonuje wszystkie oczekujące zasoby TTS przez podane usługi. */
async function executePending(target: Services): Promise<void> {
  const pending = await rows<{ id: string }>("select id from learning_app.media_assets where state = 'pending' order by id");
  for (const asset of pending) await executeMediaAsset(target, asset.id);
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
    const response = await handleKidApi(new Request("http://local/api/v1/kid/ui-audio"), services);
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
    // zmiana głosu nie unieważnia dotychczasowych nagrań: odczyt zapasowy zwraca ten sam asset dla tego samego tekstu
    const afterVoiceChange = await readUiAudio(changedServices);
    expect(afterVoiceChange.ready).toBe(true);
    expect(afterVoiceChange.assets.summary).toBe(oldId);
  });

  it("format wav i instrukcja wymowy z zasobu trafiają do providera; gotowy plik to audio/wav z długością", async () => {
    const wavSettings = structuredClone(fakes.settings);
    wavSettings.tts.format = "wav";
    wavSettings.tts.instructions = { "pl-PL": "Mów po polsku, z polską wymową." };
    const requests: TtsSynthesizeInput[] = [];
    const wavTts: TtsProvider = {
      name: "fake-wav",
      model: wavSettings.tts.model,
      async synthesize(input) {
        requests.push(input);
        // 0,25 s ciszy: 24 kHz, mono, 16 bit
        return { bytes: pcmToWav(new Uint8Array(12000), { sampleRate: 24000, channels: 1 }), mimeType: "audio/wav" };
      },
    };
    const wavServices = createServices({
      db: services.db, media: wavSettings, generation: { ...fakes.deps, tts: wavTts }, mediaStore: fakes.store,
    });
    await prepareUiAudio(wavServices);
    const [pending] = await rows<{ id: string; metadata: Record<string, unknown> }>(
      "select id, metadata from learning_app.media_assets where state = 'pending' order by id limit 1",
    );
    expect(pending!.metadata).toMatchObject({ format: "wav", instructions: "Mów po polsku, z polską wymową." });
    await executeMediaAsset(wavServices, pending!.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ format: "wav", instructions: "Mów po polsku, z polską wymową.", locale: "pl-PL" });
    const [ready] = await rows<{ mime_type: string; metadata: { durationMs?: number } }>(
      "select mime_type, metadata from learning_app.media_assets where id = $1 and state = 'ready'", [pending!.id],
    );
    expect(ready).toMatchObject({ mime_type: "audio/wav", metadata: { durationMs: 250 } });
    expect((await readReadyMedia(wavServices, pending!.id))?.mimeType).toBe("audio/wav");
    // inna instrukcja = inne nagranie; dotychczasowe mp3 bez instrukcji nie są unieważniane
    expect(await readUiAudio(services)).toMatchObject({ ready: false });
  });

  it("po awarii TTS read pozostaje niegotowy, a kolejne prepare tworzy nową generację", async () => {
    await prepareUiAudio(services);
    fakes.tts.failuresLeft = 3;
    const [oneAsset] = await rows<{ id: string }>("select id from learning_app.media_assets where state = 'pending' order by id limit 1");
    for (let attempt = 0; attempt < 3; attempt++) await executeMediaAsset(services, oneAsset!.id);
    // wcześniej nie było żadnego gotowego nagrania, więc zapasu brak
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

  it("styl roli trafia do żądania TTS jako instrukcja języka z zdaniem stylu", async () => {
    const styled = styledServicesOf(services);
    await prepareUiAudio(styled);
    await executePending(styled);
    const request = fakes.tts.requests.find((item) => item.text === messages.uiAudio.correct);
    expect(request?.instructions).toBe(`PL. ${STYLE_SENTENCES_PL.ui_praise}`);
    const gentle = fakes.tts.requests.find((item) => item.text === messages.uiAudio.retry);
    expect(gentle?.instructions).toBe(`PL. ${STYLE_SENTENCES_PL.ui_gentle}`);
  });

  it("po zmianie stylu odczyt zapasowy zwraca poprzednie nagrania do czasu wykonania nowych", async () => {
    await prepareUiAudio(services);
    await executePending(services);
    const before = await readUiAudio(services);
    expect(before.ready).toBe(true);

    const styled = styledServicesOf(services);
    await prepareUiAudio(styled);
    expect(await rows("select id from learning_app.media_assets where state = 'pending'")).toHaveLength(17);
    const fallback = await readUiAudio(styled);
    expect(fallback.ready).toBe(true);
    expect(fallback.assets).toEqual(before.assets);

    await executePending(styled);
    const after = await readUiAudio(styled);
    expect(after.ready).toBe(true);
    for (const key of Object.keys(before.assets) as Array<keyof typeof before.assets>) {
      expect(after.assets[key]).not.toBe(before.assets[key]);
    }
  });

  it("odczyt zapasowy ignoruje nagranie z innym tekstem niż bieżący", async () => {
    const oldText = "Dawny tekst podsumowania";
    const fingerprint = ttsFingerprint({
      text: oldText, locale: "pl-PL", provider: fakes.settings.tts.provider, model: fakes.settings.tts.model,
      voice: fakes.settings.tts.voice, format: fakes.settings.tts.format,
    });
    await pool.query(
      `insert into learning_app.media_assets(id, kind, fingerprint, generation_number, state, provider, model, metadata,
         storage_key, mime_type, byte_count, content_sha256)
       values ($1, 'tts', $2, 1, 'ready', $3, $4, $5, 'tts/old-summary', 'audio/mpeg', 4, $6)`,
      [randomUUID(), fingerprint, fakes.settings.tts.provider, fakes.settings.tts.model,
        { purpose: "kid_ui_guidance", uiAudioKey: "summary", text: oldText, locale: "pl-PL", voice: fakes.settings.tts.voice, format: "mp3" },
        "0".repeat(64)],
    );
    expect(await readUiAudio(services)).toEqual({ ready: false, assets: {} });
  });

  it("wyłączenie stylu przywraca nagrania sprzed stylu", async () => {
    await prepareUiAudio(services);
    await executePending(services);
    const stageOne = await readUiAudio(services);

    const styled = styledServicesOf(services);
    await prepareUiAudio(styled);
    await executePending(styled);
    const withStyle = await readUiAudio(styled);
    expect(withStyle.assets.correct).not.toBe(stageOne.assets.correct);

    expect(await readUiAudio(services)).toEqual(stageOne);
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
