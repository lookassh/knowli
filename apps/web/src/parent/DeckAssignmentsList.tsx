import React from "react";
import { messages, type AssignmentDto } from "@learning/contracts";

export function DeckAssignmentsList({
  assignments,
  onUnassign,
  busyChildId,
}: {
  assignments: AssignmentDto[];
  onUnassign?: (childId: string) => void;
  busyChildId?: string | null;
}) {
  return (
    <ul className="plain">
      {assignments.map((assignment, index) => (
        <li key={assignment.childId} data-testid={`assignment-row-${index}`} className="row space">
          <span>
            {assignment.displayName} — {assignment.testDate ?? messages.decks.noDate}
          </span>
          {onUnassign && (
            <button
              type="button"
              className="secondary"
              data-testid={`unassign-submit-${index}`}
              disabled={busyChildId === assignment.childId}
              onClick={() => onUnassign(assignment.childId)}
            >
              {messages.decks.unassign}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
