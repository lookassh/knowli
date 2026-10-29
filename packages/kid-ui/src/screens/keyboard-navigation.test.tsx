import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { TaskDto, KidDeckDto, SessionDto, FeedbackDto, MockTestSummaryDto, LessonMockTestSummaryDto, SessionSummaryDto } from "@learning/contracts";
import type { ExerciseProps } from "../exercises/types";
import { WrittenView } from "../exercises/WrittenView";
import { LetterCompletionView } from "../exercises/LetterCompletionView";
import { LessonGapView } from "../exercises/lesson/LessonGapView";
import { LessonSentenceView } from "../exercises/lesson/LessonSentenceView";
import { ReadingView } from "../exercises/ReadingView";
import { ListeningView } from "../exercises/ListeningView";
import { PictureListeningView } from "../exercises/PictureListeningView";
import { LessonChoiceView } from "../exercises/lesson/LessonChoiceView";
import { LessonShortAnswerView } from "../exercises/lesson/LessonShortAnswerView";
import { ExposureView } from "../exercises/ExposureView";
import { PictureExposureView } from "../exercises/PictureExposureView";
import { LessonCardView } from "../exercises/lesson/LessonCardView";
import { AnswerFeedbackActions, AnswerFeedbackContent } from "./AnswerFeedback";
import { SpeechFeedbackActions, SpeechFeedbackContent } from "./SpeechFeedbackCard";
import { DeckCard, DeckScreen } from "./DeckScreen";
import { MockTestReadyScreen, MockTestSummaryScreen } from "./MockTestSummaryScreen";
import { LessonMockTestSummaryScreen } from "./LessonMockTestSummaryScreen";
import { SummaryScreen } from "./SummaryScreen";
import { useFeedbackCooldown } from "./useFeedbackCooldown";
import { shouldIgnoreKeyboardShortcut, useChoiceKeyboard } from "../exercises/useChoiceKeyboard";

// Test runner harness for React hooks and DOM event listeners in node environment
interface MockElement {
  tagName?: string;
  focus: ReturnType<typeof vi.fn>;
  blur: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  getAttribute?: (name: string) => string | null;
  value?: string;
  isContentEditable?: boolean;
}

function createMockElement(tagName = "BUTTON"): MockElement {
  return {
    tagName,
    focus: vi.fn(),
    blur: vi.fn(),
    select: vi.fn(),
    getAttribute: vi.fn(() => null),
    value: "",
    isContentEditable: false,
  };
}

let windowListeners: Record<string, ((event: any) => void)[]> = {};
let mockDocumentActiveElement: MockElement | null = null;

function setupMockDom() {
  windowListeners = {};
  mockDocumentActiveElement = null;

  (globalThis as any).window = {
    addEventListener: (event: string, fn: (e: any) => void) => {
      windowListeners[event] = windowListeners[event] ?? [];
      windowListeners[event].push(fn);
    },
    removeEventListener: (event: string, fn: (e: any) => void) => {
      if (windowListeners[event]) {
        windowListeners[event] = windowListeners[event].filter((f) => f !== fn);
      }
    },
  };

  (globalThis as any).document = {
    get activeElement() {
      return mockDocumentActiveElement;
    },
    set activeElement(el: any) {
      mockDocumentActiveElement = el;
    },
  };
}

function triggerWindowKeyDown(event: Partial<KeyboardEvent>) {
  const fullEvent = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    target: { tagName: "BODY", isContentEditable: false } as any,
    ...event,
  };
  for (const listener of windowListeners["keydown"] ?? []) {
    listener(fullEvent);
  }
  return fullEvent;
}

function renderWithHooks<T>(renderFn: () => T) {
  const cleanups: (() => void)[] = [];
  const effects: (() => void | (() => void))[] = [];
  const createdElements: MockElement[] = [];
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const prevDispatcher = internals?.H;

  const dispatcher = {
    useRef: <V,>(initial: V) => {
      const mock = initial ?? (createMockElement() as unknown as V);
      if (mock && typeof (mock as any).focus === "function") {
        createdElements.push(mock as unknown as MockElement);
      }
      return { current: mock };
    },
    useState: <V,>(initial: V) => [initial, vi.fn()],
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect);
    },
    useCallback: <F extends Function>(fn: F) => fn,
    useMemo: <V,>(fn: () => V) => fn(),
  };

  internals.H = dispatcher;
  try {
    const result = renderFn();

    function attachRefs(node: any) {
      if (!node || typeof node !== "object") return;
      if (node.props) {
        const refCallback = node.props.ref ?? node.ref;
        if (typeof refCallback === "function") {
          const el = createMockElement(typeof node.type === "string" ? node.type.toUpperCase() : "ELEMENT");
          createdElements.push(el);
          refCallback(el);
        }
        if (node.props.children) {
          if (Array.isArray(node.props.children)) {
            node.props.children.forEach(attachRefs);
          } else {
            attachRefs(node.props.children);
          }
        }
        if (node.props.content) attachRefs(node.props.content);
        if (node.props.actions) attachRefs(node.props.actions);
        if (node.props.secondaryActions) attachRefs(node.props.secondaryActions);
      }
    }
    attachRefs(result);

    for (const effect of effects) {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }

    return {
      result,
      createdElements,
      unmount: () => {
        cleanups.forEach((c) => c());
      },
    };
  } finally {
    internals.H = prevDispatcher;
  }
}

const mockHandlers = {
  onInteraction: vi.fn(),
  onEdit: vi.fn(),
  onPlay: vi.fn(),
  onPlayExample: vi.fn(),
  onAnswerChoice: vi.fn(),
  onSubmitText: vi.fn(),
  onAnswerSequence: vi.fn(),
  onAnswerSelection: vi.fn(),
  onNotRemember: vi.fn(),
  onSkip: vi.fn(),
  onComplete: vi.fn(),
  onRecord: vi.fn(),
  onStopRecording: vi.fn(),
  onCancelRecording: vi.fn(),
  onPrepareRecording: vi.fn(),
};

function createExerciseProps(overrides: Partial<ExerciseProps> & { task: TaskDto }): ExerciseProps {
  return {
    busy: false,
    recording: false,
    recordingPhase: "idle",
    microphoneReady: false,
    inputLevel: 0,
    recordingNotice: null,
    recordingMode: "hold",
    micAvailable: false,
    mediaUrl: (id: string) => id,
    optionOutcomes: new Map(),
    handlers: mockHandlers,
    ...overrides,
  };
}

describe("Keyboard Navigation & Focus Management", () => {
  beforeEach(() => {
    setupMockDom();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  describe("shouldIgnoreKeyboardShortcut filtering", () => {
    it("ignores shortcuts with modifier keys (ctrl, alt, meta)", () => {
      expect(shouldIgnoreKeyboardShortcut({ ctrlKey: true, altKey: false, metaKey: false } as KeyboardEvent)).toBe(true);
      expect(shouldIgnoreKeyboardShortcut({ ctrlKey: false, altKey: true, metaKey: false } as KeyboardEvent)).toBe(true);
      expect(shouldIgnoreKeyboardShortcut({ ctrlKey: false, altKey: false, metaKey: true } as KeyboardEvent)).toBe(true);
      expect(shouldIgnoreKeyboardShortcut({ ctrlKey: false, altKey: false, metaKey: false, target: { tagName: "DIV" } } as any)).toBe(false);
    });

    it("ignores shortcuts when focus is inside INPUT, TEXTAREA, or contentEditable", () => {
      const inputEl = { tagName: "INPUT", isContentEditable: false };
      const textareaEl = { tagName: "TEXTAREA", isContentEditable: false };
      const editableEl = { tagName: "DIV", isContentEditable: true };
      const buttonEl = { tagName: "BUTTON", isContentEditable: false };

      expect(shouldIgnoreKeyboardShortcut({ ctrlKey: false, altKey: false, metaKey: false, target: inputEl } as any)).toBe(true);
      expect(shouldIgnoreKeyboardShortcut({ ctrlKey: false, altKey: false, metaKey: false, target: textareaEl } as any)).toBe(true);
      expect(shouldIgnoreKeyboardShortcut({ ctrlKey: false, altKey: false, metaKey: false, target: editableEl } as any)).toBe(true);
      expect(shouldIgnoreKeyboardShortcut({ ctrlKey: false, altKey: false, metaKey: false, target: buttonEl } as any)).toBe(false);
    });
  });

  describe("WrittenView (Zadanie pisemne)", () => {
    const task = {
      taskId: "task-written-1",
      exerciseType: "recall",
      prompt: { kind: "recall", prompt: "pies", target: "dog" },
    } as unknown as TaskDto;

    it("automatically focuses the input with preventScroll: true on mount", () => {
      const { createdElements } = renderWithHooks(() =>
        WrittenView(createExerciseProps({ task }))
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("has submit button disabled when input is empty (so Tab moves straight to 'Nie pamiętam')", () => {
      const { result } = renderWithHooks(() =>
        WrittenView(createExerciseProps({ task }))
      );

      // ExerciseFrame actions contains the submit button
      const submitBtn = (result as any).props.actions;
      expect(submitBtn.props["data-testid"]).toBe("kid-submit");
      expect(submitBtn.props.disabled).toBe(true);

      // Secondary actions has 'Nie pamiętam'
      const secondary = (result as any).props.secondaryActions;
      const notRememberBtn = secondary.props.children;
      expect(notRememberBtn.props["data-testid"]).toBe("kid-not-remember");
      expect(notRememberBtn.props.disabled).toBe(false);
    });

    it("submits text on form submit when text is non-empty", () => {
      const { result } = renderWithHooks(() =>
        WrittenView(createExerciseProps({ task }))
      );

      const form = (result as any).props.content.props.children[1];
      const input = form.props.children;

      // Simulate typing text
      input.props.onChange({ target: { value: "dog" } });
      // Simulate form onSubmit
      const preventDefault = vi.fn();
      form.props.onSubmit({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();
    });
  });

  describe("LetterCompletionView (Uzupełnianie liter)", () => {
    const task = {
      taskId: "task-letters-1",
      exerciseType: "letter_completion",
      prompt: { kind: "letter_completion", prompt: "kot", fragment: "c_t", target: "cat" },
    } as unknown as TaskDto;

    it("automatically focuses the first missing letter gap on mount", () => {
      const { createdElements } = renderWithHooks(() =>
        LetterCompletionView(createExerciseProps({ task }))
      );

      // In 'c_t', gap at index 1 is '_'
      const focused = createdElements.find((el) => el.focus.mock.calls.length > 0);
      expect(focused).toBeDefined();
      expect(focused?.focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("navigates Backspace in empty gap to previous gap and selects previous letter", () => {
      const mockGaps: Record<number, MockElement> = {
        0: createMockElement("INPUT"),
        2: createMockElement("INPUT"),
      };

      const taskMultiGap = {
        taskId: "task-letters-2",
        exerciseType: "letter_completion",
        prompt: { kind: "letter_completion", prompt: "woda", fragment: "_a_er", target: "water" },
      } as unknown as TaskDto;

      const { result } = renderWithHooks(() =>
        LetterCompletionView(createExerciseProps({ task: taskMultiGap }))
      );

      const form = (result as any).props.content.props.children[1];
      const children = form.props.children.props.children;
      const secondGap = children[2]; // index 2 is '_'

      // Attach refs
      const attachRef = (el: any, mock: any) => (el.props.ref ?? el.ref)(mock);
      attachRef(children[0], mockGaps[0]);
      attachRef(secondGap, mockGaps[2]);

      // When Backspace is pressed in second empty gap, focus moves to gap 0 and selects
      const preventDefault = vi.fn();
      secondGap.props.onKeyDown({ key: "Backspace", preventDefault });
      expect(preventDefault).toHaveBeenCalled();
      expect(mockGaps[0].focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(mockGaps[0].select).toHaveBeenCalled();
    });

    it("navigates ArrowLeft and ArrowRight between gaps", () => {
      const mockGaps: Record<number, MockElement> = {
        0: createMockElement("INPUT"),
        2: createMockElement("INPUT"),
      };

      const taskMultiGap = {
        taskId: "task-letters-3",
        exerciseType: "letter_completion",
        prompt: { kind: "letter_completion", prompt: "woda", fragment: "_a_er", target: "water" },
      } as unknown as TaskDto;

      const { result } = renderWithHooks(() =>
        LetterCompletionView(createExerciseProps({ task: taskMultiGap }))
      );

      const form = (result as any).props.content.props.children[1];
      const children = form.props.children.props.children;
      const attachRef = (el: any, mock: any) => (el.props.ref ?? el.ref)(mock);
      attachRef(children[0], mockGaps[0]);
      attachRef(children[2], mockGaps[2]);

      // ArrowRight from gap 0 moves to gap 2
      const preventDefault1 = vi.fn();
      children[0].props.onKeyDown({ key: "ArrowRight", preventDefault: preventDefault1 });
      expect(preventDefault1).toHaveBeenCalled();
      expect(mockGaps[2].focus).toHaveBeenCalledWith({ preventScroll: true });

      // ArrowLeft from gap 2 moves back to gap 0
      const preventDefault2 = vi.fn();
      children[2].props.onKeyDown({ key: "ArrowLeft", preventDefault: preventDefault2 });
      expect(preventDefault2).toHaveBeenCalled();
      expect(mockGaps[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });
  });

  describe("LessonGapView & LessonSentenceView (Lekcje - pola edycyjne)", () => {
    it("LessonGapView automatically focuses input with preventScroll: true", () => {
      const task = {
        taskId: "lesson-gap-1",
        exerciseType: "lesson_gap",
        prompt: { kind: "lesson_gap", stemWithGap: "She {gap} tennis.", hint: "play" } as any,
      } as unknown as TaskDto;

      const { createdElements } = renderWithHooks(() =>
        LessonGapView(createExerciseProps({ task }))
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("lesson edits call onEdit so editCount/editWindows capture lesson work", () => {
      const findNodes = (node: any, predicate: (n: any) => boolean, found: any[] = []): any[] => {
        if (!node || typeof node !== "object") return found;
        if (predicate(node)) found.push(node);
        // Mirror attachRefs: ExerciseFrame trzyma treść także w content/actions.
        for (const slot of ["children", "content", "actions", "secondaryActions"]) {
          const children = node.props?.[slot];
          if (Array.isArray(children)) children.forEach((child: any) => findNodes(child, predicate, found));
          else findNodes(children, predicate, found);
        }
        return found;
      };

      const gapTask = {
        taskId: "lesson-gap-edit",
        exerciseType: "lesson_gap",
        prompt: { kind: "lesson_gap", stemWithGap: "She {gap} tennis.", hint: "play" } as any,
      } as unknown as TaskDto;
      const gapProps = createExerciseProps({ task: gapTask });
      const gap = renderWithHooks(() => LessonGapView(gapProps));
      const gapInput = findNodes(gap.result, (node) => typeof node.props?.onChange === "function")[0];
      expect(gapInput).toBeTruthy();
      gapInput.props.onChange({ target: { value: "plays" } });
      expect(gapProps.handlers.onEdit).toHaveBeenCalled();
      expect(gapProps.handlers.onInteraction).not.toHaveBeenCalled();

      const sentenceTask = {
        taskId: "lesson-sentence-edit",
        exerciseType: "lesson_error_fix",
        prompt: { kind: "lesson_error_fix", statement: "She play tennis.", instructionPl: "Popraw." } as any,
      } as unknown as TaskDto;
      const sentenceProps = createExerciseProps({ task: sentenceTask });
      const sentence = renderWithHooks(() => LessonSentenceView(sentenceProps));
      const sentenceInput = findNodes(sentence.result, (node) => typeof node.props?.onChange === "function")[0];
      expect(sentenceInput).toBeTruthy();
      sentenceInput.props.onChange({ target: { value: "She plays tennis." } });
      expect(sentenceProps.handlers.onEdit).toHaveBeenCalled();
    });

    it("LessonSentenceView automatically focuses input with preventScroll: true", () => {
      const task = {
        taskId: "lesson-sentence-1",
        exerciseType: "lesson_error_fix",
        prompt: { kind: "lesson_error_fix", statement: "She play tennis.", prompt: "Popraw błąd" } as any,
      } as unknown as TaskDto;

      const { createdElements } = renderWithHooks(() =>
        LessonSentenceView(createExerciseProps({ task }))
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });
  });

  describe("Choice exercises (ReadingView, LessonChoiceView, LessonShortAnswerView)", () => {
    const readingTask = {
      taskId: "task-reading-1",
      exerciseType: "reading",
      prompt: {
        kind: "reading",
        text: "apple",
        options: [
          { id: "opt-1", text: "jabłko" },
          { id: "opt-2", text: "gruszka" },
          { id: "opt-3", text: "banan" },
          { id: "opt-4", text: "śliwka" },
        ],
      },
    } as unknown as TaskDto;

    it("selects options via digit keys 1-4 without reaching for mouse", () => {
      renderWithHooks(() =>
        ReadingView(createExerciseProps({ task: readingTask }))
      );

      triggerWindowKeyDown({ key: "1" });
      expect(mockHandlers.onAnswerChoice).toHaveBeenCalledWith("opt-1");

      triggerWindowKeyDown({ key: "3" });
      expect(mockHandlers.onAnswerChoice).toHaveBeenCalledWith("opt-3");

      triggerWindowKeyDown({ key: "4" });
      expect(mockHandlers.onAnswerChoice).toHaveBeenCalledWith("opt-4");
    });

    it("ignores digit keys out of range and when busy", () => {
      renderWithHooks(() =>
        ReadingView(createExerciseProps({ task: readingTask }))
      );

      // Key 5 is out of range (options length is 4)
      triggerWindowKeyDown({ key: "5" });
      expect(mockHandlers.onAnswerChoice).not.toHaveBeenCalled();
    });

    it("navigates options with ArrowDown and ArrowUp only when focus is inside options", () => {
      const mockButtons = [createMockElement(), createMockElement(), createMockElement(), createMockElement()];

      const { result } = renderWithHooks(() =>
        ReadingView(createExerciseProps({ task: readingTask }))
      );

      // AnswerGrid owns the rendered option buttons and receives the shared refs.
      const answerGrid = (result as any).props.content.props.children[1];
      mockButtons.forEach((button, index) => {
        answerGrid.props.optionRefs.current[index] = button;
      });

      // Press ArrowDown when focus is outside options (e.g. body) -> does not intercept
      mockDocumentActiveElement = null;
      const eventOutside = triggerWindowKeyDown({ key: "ArrowDown" });
      expect(eventOutside.preventDefault).not.toHaveBeenCalled();
      expect(mockButtons[0].focus).not.toHaveBeenCalled();

      // Simulate first button active, ArrowDown focuses second option
      mockDocumentActiveElement = mockButtons[0];
      triggerWindowKeyDown({ key: "ArrowDown" });
      expect(mockButtons[1].focus).toHaveBeenCalledWith({ preventScroll: true });

      // ArrowUp from second focuses first
      mockDocumentActiveElement = mockButtons[1];
      triggerWindowKeyDown({ key: "ArrowUp" });
      expect(mockButtons[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("LessonChoiceView selects options via digit keys 1-4", () => {
      const task = {
        taskId: "task-lesson-choice-1",
        exerciseType: "lesson_choice",
        prompt: {
          kind: "lesson_choice",
          stem: "She ... tennis every Sunday.",
          options: [
            { id: "opt-1", text: "plays" },
            { id: "opt-2", text: "play" },
          ],
        },
      } as unknown as TaskDto;

      renderWithHooks(() =>
        LessonChoiceView(createExerciseProps({ task }))
      );

      triggerWindowKeyDown({ key: "2" });
      expect(mockHandlers.onAnswerChoice).toHaveBeenCalledWith("opt-2");
    });

    it("LessonShortAnswerView selects options via digit keys 1-4", () => {
      const task = {
        taskId: "task-lesson-short-answer-1",
        exerciseType: "lesson_short_answer",
        prompt: {
          kind: "lesson_short_answer",
          options: [
            { id: "opt-1", text: "Yes, she does." },
            { id: "opt-2", text: "No, she doesn't." },
          ],
        },
      } as unknown as TaskDto;

      renderWithHooks(() =>
        LessonShortAnswerView(createExerciseProps({ task }))
      );

      triggerWindowKeyDown({ key: "1" });
      expect(mockHandlers.onAnswerChoice).toHaveBeenCalledWith("opt-1");
    });
  });

  describe("Listening exercises (ListeningView, PictureListeningView)", () => {
    const listeningTask = {
      taskId: "task-listening-1",
      exerciseType: "listening",
      prompt: {
        kind: "listening",
        audioAssetId: "audio-1",
        options: [
          { id: "opt-1", text: "kot" },
          { id: "opt-2", text: "pies" },
        ],
      },
    } as unknown as TaskDto;

    it("has initial focus on kid-play button", () => {
      const { createdElements } = renderWithHooks(() =>
        ListeningView(createExerciseProps({ task: listeningTask }))
      );

      // play button has ref and received focus with preventScroll: true
      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("Space key replays audio and does NOT select any option even when an option is focused", () => {
      const mockOptionButton = createMockElement();
      mockDocumentActiveElement = mockOptionButton;

      renderWithHooks(() =>
        ListeningView(createExerciseProps({ task: listeningTask }))
      );

      const event = triggerWindowKeyDown({ key: " ", code: "Space" });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockHandlers.onPlay).toHaveBeenCalled();
      expect(mockHandlers.onAnswerChoice).not.toHaveBeenCalled();
    });

    it("PictureListeningView focuses play button and selects options via keys 1-4", () => {
      const task = {
        taskId: "task-picture-listening-1",
        exerciseType: "listening",
        prompt: {
          kind: "picture_listening",
          audioAssetId: "audio-pic-1",
          options: [
            { id: "opt-1", labelPl: "jabłko", visual: { kind: "color", color: "#ff0000" } },
            { id: "opt-2", labelPl: "gruszka", visual: { kind: "color", color: "#00ff00" } },
          ],
        },
      } as unknown as TaskDto;

      const { createdElements } = renderWithHooks(() =>
        PictureListeningView(createExerciseProps({ task }))
      );

      // Initial focus on kid-play button
      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });

      // Digit 1 selects first option
      triggerWindowKeyDown({ key: "1" });
      expect(mockHandlers.onAnswerChoice).toHaveBeenCalledWith("opt-1");

      // Space key replays audio
      const event = triggerWindowKeyDown({ key: " ", code: "Space" });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockHandlers.onPlay).toHaveBeenCalled();
    });
  });

  describe("Exposure views (ExposureView, PictureExposureView, LessonCardView)", () => {
    const exposureTask = {
      taskId: "task-exposure-1",
      exerciseType: "exposure",
      prompt: {
        kind: "exposure",
        source: "pies",
        target: "dog",
        audioAssetId: "audio-dog",
        example: null,
        exampleAudioAssetId: null,
        visualType: "none",
        visualData: undefined,
        imageAssetId: null,
      },
    } as unknown as TaskDto;

    it("sets initial focus on 'Rozumiem' button with preventScroll: true", () => {
      const { createdElements } = renderWithHooks(() =>
        ExposureView(createExerciseProps({ task: exposureTask }))
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("replays audio on Space when audio exists", () => {
      renderWithHooks(() =>
        ExposureView(createExerciseProps({ task: exposureTask }))
      );

      const event = triggerWindowKeyDown({ key: " ", code: "Space" });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockHandlers.onPlay).toHaveBeenCalled();
    });

    it("ExposureView does not intercept Space when 'kid-done' button has focus", () => {
      const doneBtn = createMockElement("BUTTON");
      doneBtn.getAttribute = vi.fn((attr: string) => attr === "data-testid" ? "kid-done" : null);
      mockDocumentActiveElement = doneBtn;

      renderWithHooks(() =>
        ExposureView(createExerciseProps({ task: exposureTask }))
      );

      const event = triggerWindowKeyDown({ key: " ", code: "Space" });
      expect(mockHandlers.onPlay).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("PictureExposureView focuses 'Rozumiem' button and replays audio on Space unless button is focused", () => {
      const task = {
        taskId: "task-picture-exposure-1",
        exerciseType: "exposure",
        prompt: {
          kind: "picture_exposure",
          audioAssetId: "audio-pic-exp-1",
          visual: { kind: "color", color: "#ff0000" },
        },
      } as unknown as TaskDto;

      const { createdElements } = renderWithHooks(() =>
        PictureExposureView(createExerciseProps({ task }))
      );

      // Button has focus
      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });

      // Space when body is active replays audio
      mockDocumentActiveElement = null;
      const event1 = triggerWindowKeyDown({ key: " ", code: "Space" });
      expect(event1.preventDefault).toHaveBeenCalled();
      expect(mockHandlers.onPlay).toHaveBeenCalled();

      // Space when kid-done is focused does NOT intercept (allows native button click)
      const doneBtn = createMockElement("BUTTON");
      doneBtn.getAttribute = vi.fn((attr: string) => attr === "data-testid" ? "kid-done" : null);
      mockDocumentActiveElement = doneBtn;
      const event2 = triggerWindowKeyDown({ key: " ", code: "Space" });
      expect(mockHandlers.onPlay).toHaveBeenCalledTimes(1); // not called again
      expect(event2.preventDefault).not.toHaveBeenCalled();
    });

    it("LessonCardView focuses 'Dalej' button", () => {
      const task = {
        taskId: "task-lesson-card-1",
        exerciseType: "lesson_card",
        prompt: {
          kind: "lesson_card",
          card: {
            title: "Karta reguły",
            body: "Reguła",
            examples: ["Example 1"],
          },
        },
      } as unknown as TaskDto;

      const { createdElements } = renderWithHooks(() =>
        LessonCardView(createExerciseProps({ task }))
      );

      // Button has focus
      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });
  });

  describe("Feedback screens & cooldown protection (AnswerFeedback, SpeechFeedbackCard)", () => {
    it("AnswerFeedbackContent sets focus on title with preventScroll: true to dismiss mobile keyboard", () => {
      const feedback: FeedbackDto = { kind: "great" };
      const { createdElements } = renderWithHooks(() =>
        AnswerFeedbackContent({ dto: feedback, busy: false })
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("AnswerFeedbackActions protects action button with 300 ms cooldown, tests button onKeyDown and blocks repeat Enter", () => {
      const onNext = vi.fn();
      let now = 1000;
      vi.spyOn(Date, "now").mockImplementation(() => now);

      const { result } = renderWithHooks(() =>
        AnswerFeedbackActions({ dto: { kind: "great" }, retry: false, busy: false, onNext })
      );

      // Test button.props.onKeyDown during cooldown (<300 ms)
      now = 1100;
      const btnEvent1 = { key: "Enter", repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
      (result as any).props.onKeyDown(btnEvent1);
      expect(btnEvent1.preventDefault).toHaveBeenCalled();
      expect(btnEvent1.stopPropagation).toHaveBeenCalled();

      // Test button.props.onKeyDown with Space during cooldown (<300 ms)
      const btnEventSpace = { key: " ", code: "Space", repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
      (result as any).props.onKeyDown(btnEventSpace);
      expect(btnEventSpace.preventDefault).toHaveBeenCalled();
      expect(btnEventSpace.stopPropagation).toHaveBeenCalled();

      // Window Enter during cooldown (<300 ms) is prevented
      const event1 = triggerWindowKeyDown({ key: "Enter" });
      expect(event1.preventDefault).toHaveBeenCalled();
      expect(onNext).not.toHaveBeenCalled();

      // Test button.props.onKeyDown with repeat after cooldown (>300 ms)
      now = 1400;
      const btnEventRepeat = { key: "Enter", repeat: true, preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
      (result as any).props.onKeyDown(btnEventRepeat);
      expect(btnEventRepeat.preventDefault).toHaveBeenCalled();

      // Test button.props.onKeyDown without repeat after cooldown (>300 ms)
      const btnEventOk = { key: "Enter", repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
      (result as any).props.onKeyDown(btnEventOk);
      expect(btnEventOk.preventDefault).not.toHaveBeenCalled();

      // Window Enter when another BUTTON is active does NOT trigger onNext
      const otherButton = createMockElement("BUTTON");
      mockDocumentActiveElement = otherButton;
      triggerWindowKeyDown({ key: "Enter", repeat: false });
      expect(onNext).not.toHaveBeenCalled();

      // Enter at 1400 ms without repeat and focus not on any button proceeds
      mockDocumentActiveElement = null;
      triggerWindowKeyDown({ key: "Enter", repeat: false });
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("SpeechFeedbackContent sets focus on heading with preventScroll: true", () => {
      const { createdElements } = renderWithHooks(() =>
        SpeechFeedbackContent({
          dto: { kind: "almost" },
          retry: true,
          busy: false,
          audioAvailable: false,
          audioError: false,
          exerciseType: "speech",
          onPlay: vi.fn(),
          onRetry: vi.fn(),
          onSkip: vi.fn(),
          onNext: vi.fn(),
        })
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("SpeechFeedbackActions protects retry action with cooldown and repeat check", () => {
      const onRetry = vi.fn();
      let now = 2000;
      vi.spyOn(Date, "now").mockImplementation(() => now);

      renderWithHooks(() =>
        SpeechFeedbackActions({
          dto: { kind: "almost" },
          retry: true,
          busy: false,
          audioAvailable: false,
          audioError: false,
          exerciseType: "speech",
          onPlay: vi.fn(),
          onRetry,
          onSkip: vi.fn(),
          onNext: vi.fn(),
        })
      );

      // At 2100 ms (<300 ms cooldown): Enter is blocked
      now = 2100;
      triggerWindowKeyDown({ key: "Enter" });
      expect(onRetry).not.toHaveBeenCalled();

      // At 2400 ms (>300 ms): Enter proceeds
      now = 2400;
      mockDocumentActiveElement = null;
      triggerWindowKeyDown({ key: "Enter", repeat: false });
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("Screen entry points (DeckScreen, MockTestReadyScreen, MockTestSummaryScreen, SummaryScreen)", () => {
    const deck: KidDeckDto = {
      deckId: "deck-1",
      title: "Zwierzęta",
      itemCount: 5,
      independentlyRecalledCount: 3,
      testDate: null,
      recommended: true,
      mockTestAvailable: true,
      activeSession: null,
    };

    it("DeckScreen sets initial focus on first deck start button", () => {
      const { createdElements } = renderWithHooks(() =>
        DeckScreen({
          decks: [deck],
          childName: "Janek",
          microphone: false,
          micDenied: false,
          onToggleMicrophone: vi.fn(),
          onStart: vi.fn(),
        })
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("DeckScreen with 0 decks renders without throwing focus error", () => {
      expect(() => {
        renderWithHooks(() =>
          DeckScreen({
            decks: [],
            childName: "Janek",
            microphone: false,
            micDenied: false,
            onToggleMicrophone: vi.fn(),
            onStart: vi.fn(),
          })
        );
      }).not.toThrow();
    });

    it("MockTestReadyScreen sets initial focus on 'Rozpocznij kartkówkę' button", () => {
      const session = {
        sessionId: "sess-1",
        mode: "mock_test",
        state: "active",
        taskBudget: 10,
        microphoneEnabled: false,
        tasksIssued: 0,
        assessedTasksIssued: 0,
      } as unknown as SessionDto;

      const { createdElements } = renderWithHooks(() =>
        MockTestReadyScreen({ session, onStart: vi.fn(), onCancel: vi.fn() })
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("MockTestSummaryScreen sets initial focus on 'Ćwicz dalej' button", () => {
      const summary = {
        sessionId: "sess-mock-1",
        deckId: "deck-1",
        state: "completed",
        complete: true,
        taskBudget: 5,
        answeredCount: 5,
        solutions: [],
      } as unknown as MockTestSummaryDto;

      const { createdElements } = renderWithHooks(() =>
        MockTestSummaryScreen({
          summary,
          activity: null,
          detailsLoading: false,
          detailsError: false,
          onRetryDetails: vi.fn(),
          onPlay: vi.fn(),
          onPractice: vi.fn(),
          onSwitchProfile: vi.fn(),
        })
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("LessonMockTestSummaryScreen sets initial focus on practice button", () => {
      const summary = {
        sessionId: "sess-lesson-mock-1",
        deckId: "deck-1",
        state: "completed",
        complete: true,
        taskBudget: 5,
        answeredCount: 5,
        solutions: [],
      } as unknown as LessonMockTestSummaryDto;

      const { createdElements } = renderWithHooks(() =>
        LessonMockTestSummaryScreen({
          summary,
          activity: null,
          detailsLoading: false,
          detailsError: false,
          onRetryDetails: vi.fn(),
          onPractice: vi.fn(),
          onSwitchProfile: vi.fn(),
        })
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it("SummaryScreen sets initial focus on 'Ucz się dalej' button", () => {
      const summary = {
        sessionId: "sess-sum-1",
        state: "completed",
        tasksIssued: 5,
        assessedTasksIssued: 5,
        endedAt: "2026-10-19T10:00:00Z",
        independentSuccesses: { recall: 2, spelling: 1 },
        practiceItems: [],
        reward: { creditedSeconds: 300, pointsEarned: 5 },
      } as unknown as SessionSummaryDto;

      const { createdElements } = renderWithHooks(() =>
        SummaryScreen({
          summary,
          profiles: [],
          onAgain: vi.fn(),
          onSwitchProfile: vi.fn(),
        })
      );

      expect(createdElements[0].focus).toHaveBeenCalledWith({ preventScroll: true });
    });
  });
});
