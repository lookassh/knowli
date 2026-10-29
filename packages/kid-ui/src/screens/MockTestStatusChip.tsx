import type { ReactElement } from "react";
import { messages } from "@learning/contracts";
import { Chip } from "../components/Chip";
import { KidIcon } from "../components/KidIcon";
import { MOCK_TEST_SOLUTION_ICONS, type MockTestWordStatus } from "./mock-test-score";

/**
 * Odznaka statusu rozwiązania: ikona SVG i tekst, więc status poznaje się także
 * bez koloru. Dla niesprawdzonych tekst mówi, czy zadanie pominięto, czy nie
 * sprawdzono. Wspólna dla omówienia słówek i lekcji.
 */
export function MockTestStatusChip({ status, skipped = false, "data-testid": testId }: {
  status: MockTestWordStatus;
  skipped?: boolean;
  "data-testid": string;
}): ReactElement {
  const label = status === "correct" ? messages.kid.mockTestStatusCorrect
    : status === "incorrect" ? messages.kid.mockTestStatusIncorrect
      : skipped ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested;
  return (
    <Chip className={`kid-mock-status kid-mock-status--${status}`} data-testid={testId}>
      <KidIcon name={MOCK_TEST_SOLUTION_ICONS[status]} className="kid-mock-status__icon" />
      {label}
    </Chip>
  );
}

/** Kafelek statusu w wierszu rozwiązania; kolor roli statusu dubluje ikonę. */
export function MockTestStatusTile({ status }: { status: MockTestWordStatus }): ReactElement {
  return <span className="kid-mock-row__icon" aria-hidden="true"><KidIcon name={MOCK_TEST_SOLUTION_ICONS[status]} /></span>;
}
