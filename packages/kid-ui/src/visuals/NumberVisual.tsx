import type { ReactElement } from "react";

function columnsForCount(count: number): number {
  return count <= 3 ? count : Math.ceil(Math.sqrt(count * 1.8));
}

export function NumberVisual({ count, label }: { count: number; label: string }): ReactElement {
  const viewWidth = 160;
  const viewHeight = 120;
  const appleWidth = 24;
  const appleHeight = 28;
  const columns = columnsForCount(count);
  const rows = Math.ceil(count / columns);
  const cellWidth = viewWidth / columns;
  const cellHeight = viewHeight / rows;
  const scale = count === 1
    ? Math.min(viewWidth / appleWidth, viewHeight / appleHeight, 4)
    : Math.min(cellWidth / (appleWidth + 4), cellHeight / (appleHeight + 4), 2.5);

  return (
    <svg className="kid-visual kid-visual-number" viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={label}>
      {Array.from({ length: count }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const itemsInRow = Math.min(columns, count - row * columns);
        const rowOffset = (viewWidth - itemsInRow * cellWidth) / 2;
        const x = rowOffset + column * cellWidth + (cellWidth - appleWidth * scale) / 2;
        const y = row * cellHeight + (cellHeight - appleHeight * scale) / 2;
        return (
          <g key={index} data-testid="kid-number-apple" transform={`translate(${x} ${y}) scale(${scale})`}>
            <path d="M12 8C9 5 2 6 1 13C0 20 4 28 12 28C20 28 24 20 23 13C22 6 15 5 12 8Z" fill="#e84755" stroke="#86232c" strokeWidth="1.2" />
            <path d="M12 7C11 3 13 2 15 1" fill="none" stroke="#77522b" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M13 5C14 1 18 1 21 2C20 5 17 7 13 6Z" fill="#348a49" stroke="#246638" strokeWidth="0.8" />
          </g>
        );
      })}
    </svg>
  );
}
