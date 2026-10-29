"use client";

import { Button } from "@mantine/core";
import type { ChildDto } from "@learning/contracts";
import { avatarEmoji } from "./avatars";

/**
 * Wybór dziecka w Postępach i Karcie pracy: rząd awatarów, na telefonie
 * przewijany w poziomie zamiast łamać się na kilka linii.
 */
export function ChildPicker({
  childrenList,
  value,
  onChange,
  label,
  testId,
  optionTestId,
}: {
  childrenList: ChildDto[];
  value: string;
  onChange: (childId: string) => void;
  label: string;
  testId?: string;
  optionTestId?: string;
}) {
  return (
    <div className="pp-childpicker" role="group" aria-label={label} data-testid={testId}>
      {childrenList.map((child) => {
        const selected = child.id === value;
        return (
          <Button
            key={child.id}
            size="md"
            radius="xl"
            variant={selected ? "light" : "default"}
            className="pp-childpicker-option"
            data-testid={optionTestId}
            aria-pressed={selected}
            leftSection={<span className="pp-childpicker-emoji" aria-hidden="true">{avatarEmoji(child.avatarKey)}</span>}
            onClick={() => { if (!selected) onChange(child.id); }}
          >
            {child.displayName}
          </Button>
        );
      })}
    </div>
  );
}
