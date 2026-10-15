import { describe, expect, it, vi } from "vitest";
import type { UiAudioCatalogDto } from "@learning/contracts";
import type { AudioPlayer } from "../media/platform";
import { createGuidanceAudio } from "./guidance-audio";

describe("spoken UI guidance", () => {
  it("queues prompts without overlap and stop cancels queued and active playback", async () => {
    const releases: Array<() => void> = [];
    const play = vi.fn((url: string) => new Promise<void>((resolve) => { releases.push(resolve); }));
    const player: AudioPlayer = { play, stop: vi.fn() };
    const catalog: UiAudioCatalogDto = { ready: true, assets: {
      profile_select: "11111111-1111-4111-8111-111111111111",
      deck_select: "22222222-2222-4222-8222-222222222222",
    } };
    const guidance = createGuidanceAudio(catalog, player, (id) => `/media/${id}`);
    const first = guidance.play("profile_select");
    const second = guidance.play("deck_select");
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
    releases.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(play).toHaveBeenCalledTimes(2);
    guidance.stop();
    releases.shift()?.();
    await Promise.all([first, second]);
    expect(player.stop).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("does not start queued guidance after stop invalidates the queue", async () => {
    let release!: () => void;
    const play = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const player: AudioPlayer = { play, stop: vi.fn() };
    const guidance = createGuidanceAudio({ ready: true, assets: {
      profile_select: "11111111-1111-4111-8111-111111111111",
      deck_select: "22222222-2222-4222-8222-222222222222",
    } }, player, (id) => `/media/${id}`);
    const first = guidance.play("profile_select");
    const second = guidance.play("deck_select");
    await Promise.resolve();
    guidance.stop();
    release();
    await Promise.all([first, second]);
    expect(play).toHaveBeenCalledTimes(1);
    expect(player.stop).toHaveBeenCalledTimes(1);
  });
});
