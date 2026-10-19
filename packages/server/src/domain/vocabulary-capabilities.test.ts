import { describe, expect, it } from "vitest";
import * as server from "../index";

const api = server as unknown as Record<string, (input: {
  canRead: boolean;
  microphoneEnabled: boolean;
  vocabularyFormat?: "standard" | "picture";
  supportsPictureRecognition?: boolean;
}) => unknown>;

describe("możliwości słówkowe profilu", () => {
  it("nie dopuszcza czytania ani pisowni bez czytania, a Recall i wymowa wymagają mikrofonu", () => {
    expect(api.getVocabularyCapabilities).toBeTypeOf("function");
    expect(api.getVocabularyCapabilities({ canRead: false, microphoneEnabled: false })).toEqual({
      skills: ["listening"],
      exerciseTypes: ["exposure", "listening"],
    });
    expect(api.getVocabularyCapabilities({ canRead: false, microphoneEnabled: true })).toEqual({
      skills: ["listening", "recall", "pronunciation"],
      exerciseTypes: ["exposure", "listening", "recall", "speech"],
    });
  });

  it("nieczytający z mikrofonem, zestawem picture i flagą: picture_recognition współistnieje z recall i speech", () => {
    expect(api.getVocabularyCapabilities({
      canRead: false, microphoneEnabled: true, vocabularyFormat: "picture", supportsPictureRecognition: true,
    })).toEqual({
      skills: ["listening", "recall", "pronunciation"],
      exerciseTypes: ["exposure", "listening", "recall", "speech", "picture_recognition"],
    });
    // bez flagi typ nie wchodzi nawet przy mikrofonie
    expect(api.getVocabularyCapabilities({ canRead: false, microphoneEnabled: true })).toEqual({
      skills: ["listening", "recall", "pronunciation"],
      exerciseTypes: ["exposure", "listening", "recall", "speech"],
    });
  });

  it("zachowuje pełne możliwości dotychczasowych profili czytających", () => {
    expect(api.getVocabularyCapabilities({ canRead: true, microphoneEnabled: false })).toEqual({
      skills: ["listening", "reading", "recall", "spelling", "pronunciation"],
      exerciseTypes: ["exposure", "listening", "reading", "reverse_recognition", "recall", "spelling", "letter_completion", "speech"],
    });
  });
});
