import { isVisualDataValid, type VisualType } from "@learning/contracts";
import { NumberVisual } from "./NumberVisual";

interface VisualProps {
  text: string;
  visualType: VisualType;
  visualData?: Record<string, unknown>;
}

function colorValue(data: Record<string, unknown> | undefined): string | null {
  const color = data?.color;
  return typeof color === "string" && /^#[\da-f]{6}$/i.test(color) ? color : null;
}

function countValue(data: Record<string, unknown> | undefined): number | null {
  const count = data?.count;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 50
    ? count
    : null;
}

function sequenceValue(data: Record<string, unknown> | undefined): { position: number; total: number; sequenceStart?: string } | null {
  const position = data?.position;
  const total = data?.total;
  const sequenceStart = data?.sequenceStart;
  return typeof position === "number" && Number.isInteger(position) &&
    typeof total === "number" && Number.isInteger(total) &&
    total >= 1 && total <= 12 && position >= 1 && position <= total
    && typeof sequenceStart === "string" && sequenceStart.length > 0 && sequenceStart.length <= 40
    ? { position, total, sequenceStart }
    : null;
}

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_ABBREVIATIONS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Pomoc semantyczna z danych wersji materiału, bez zgadywania z tekstu. */
export function Visual({ text, visualType, visualData }: VisualProps) {
  if (visualType === "color") {
    if (!isVisualDataValid(visualType, visualData, text)) return null;
    const color = colorValue(visualData);
    if (color === null) return null;
    return (
      <svg className="kid-visual" viewBox="0 0 96 96" role="img" aria-label={text}>
        <rect x="8" y="8" width="80" height="80" rx="12" fill={color} />
      </svg>
    );
  }

  if (visualType === "number") {
    if (!isVisualDataValid(visualType, visualData, text)) return null;
    const count = countValue(visualData);
    if (count === null) return null;
    return <NumberVisual count={count} label={text} />;
  }

  if (visualType === "sequence") {
    if (!isVisualDataValid(visualType, visualData, text)) return null;
    const sequence = sequenceValue(visualData);
    if (sequence === null) return null;
    const { position, total, sequenceStart } = sequence;
    const width = 184 / total;
    const weekdayStart = WEEKDAY_LABELS.findIndex((day) => day.toLowerCase() === sequenceStart?.toLowerCase());
    const labels = total === 7 && weekdayStart >= 0
      ? Array.from({ length: total }, (_, index) => WEEKDAY_ABBREVIATIONS[(weekdayStart + index) % 7]!)
      : Array.from({ length: total }, (_, index) => String(index + 1));
    return (
      <svg className="kid-visual kid-visual-sequence" viewBox="0 0 200 64" role="img" aria-label={text} data-total={total} data-sequence-start={sequenceStart}>
        {Array.from({ length: total }, (_, index) => {
          const current = index + 1 === position;
          return (
            <g key={index} data-position={index + 1}>
              <rect
                x={8 + index * width}
                y="10"
                width={width - 3}
                height="42"
                rx="5"
                fill={current ? "#5367b8" : "#e8eaf5"}
                aria-current={current ? "step" : undefined}
              />
              <text
                x={8 + index * width + (width - 3) / 2}
                y="37"
                textAnchor="middle"
                fontSize="16"
                fontWeight="700"
                fill={current ? "#ffffff" : "#454b60"}
              >
                {labels[index]}
              </text>
            </g>
          );
        })}
        <title>{`${position} / ${total}, start: ${sequenceStart}`}</title>
      </svg>
    );
  }

  return null;
}
