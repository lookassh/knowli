/**
 * Deterministyczna pomoc wizualna (plan zadania 9). Bez adresów obrazów w
 * promptach zadań MVP rysujemy z tekstu celu: odcień z hasha, inicjał słowa.
 * Używana wyłącznie tam, gdzie cel i tak jest widoczny (prezentacja, ćwiczenie
 * wymowy) — nigdy w zadaniach sprawdzających samodzielną wiedzę (SPEC §13).
 */
export function Visual({ text }: { text: string }) {
  const hue = [...text].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 360, 7);
  const letter = [...text][0]?.toUpperCase() ?? "?";
  return (
    <svg
      className="kid-visual"
      viewBox="0 0 96 96"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="48" cy="48" r="44" fill={`hsl(${hue} 70% 88%)`} />
      <circle cx="48" cy="48" r="44" fill="none" stroke={`hsl(${hue} 60% 70%)`} strokeWidth="4" />
      <text
        x="48"
        y="63"
        textAnchor="middle"
        fontSize="46"
        fontWeight="700"
        fill={`hsl(${hue} 55% 32%)`}
      >
        {letter}
      </text>
    </svg>
  );
}
