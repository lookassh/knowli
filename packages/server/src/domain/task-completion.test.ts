import { expect, it } from "vitest";
import { taskStateAfterAttempt, type TaskCompletionInput, type TaskCompletionState } from "./task-completion";

const base: TaskCompletionInput = {
  isMockTest: false,
  action: "answer",
  outcomes: [],
  attemptNumber: 1,
  incorrectAttemptCount: 0,
};

const cases: Array<[string, Partial<TaskCompletionInput>, TaskCompletionState]> = [
  ["pomiń", { action: "skip" }, "skipped"],
  ["pomiń ma pierwszeństwo przed sukcesem mowy", { action: "skip", speechContentMatched: true }, "skipped"],
  ["poprawna odpowiedź", { outcomes: ["correct"] }, "answered"],
  ["poprawna i nieoceniona umiejętność", { outcomes: ["correct", "unevaluated"] }, "answered"],
  ["brak ocen", {}, "issued"],
  ["druga techniczna próba", { outcomes: ["unevaluated"], attemptNumber: 2 }, "issued"],
  ["nie pamiętam", { action: "dont_remember" }, "answered"],
  ["pierwszy błąd", { outcomes: ["incorrect"], incorrectAttemptCount: 1 }, "issued"],
  ["drugi błąd", { outcomes: ["incorrect"], incorrectAttemptCount: 2 }, "answered"],
  ["dwa błędne skill w jednej próbie", { outcomes: ["incorrect", "incorrect"], incorrectAttemptCount: 1 }, "issued"],
  ["sukces i błąd w pierwszej próbie", { outcomes: ["correct", "incorrect"], incorrectAttemptCount: 1 }, "issued"],
  ["sukces i błąd w drugiej błędnej próbie", { outcomes: ["correct", "incorrect"], incorrectAttemptCount: 2 }, "answered"],
  ["błąd po próbie technicznej", { outcomes: ["incorrect"], attemptNumber: 2, incorrectAttemptCount: 1 }, "issued"],
  ["techniczna ocena przy dawnych błędach", { outcomes: ["unevaluated"], incorrectAttemptCount: 2 }, "issued"],
  ["zgodna treść mowy bez oceny wymowy", { speechContentMatched: true }, "answered"],
  ["pierwsza rozbieżność mowy", { speechContentMatched: false }, "issued"],
  ["druga rozbieżność mowy", { speechContentMatched: false, attemptNumber: 2 }, "answered"],
  ["kartkówka bez oceny", { isMockTest: true, outcomes: ["unevaluated"] }, "answered"],
  ["kartkówka z błędem", { isMockTest: true, outcomes: ["incorrect"] }, "answered"],
  ["pominięcie kartkówki", { isMockTest: true, action: "skip" }, "skipped"],
];

it.each(cases)("%s", (_name, override, expected) => {
  expect(taskStateAfterAttempt({ ...base, ...override })).toBe(expected);
});
