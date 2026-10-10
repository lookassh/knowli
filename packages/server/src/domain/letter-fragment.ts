/** Deterministycznie pokazuje co drugą literę i zawsze ukrywa co najmniej jedną. */
export function buildLetterFragment(target: string): string {
  const characters = Array.from(target);
  const hiddenPositions = new Set<number>();
  let wordPositions: number[] = [];
  const maskWord = () => {
    if (wordPositions.length === 1) hiddenPositions.add(wordPositions[0]!);
    else for (let index = 1; index < wordPositions.length; index += 2) hiddenPositions.add(wordPositions[index]!);
    wordPositions = [];
  };
  for (const [index, character] of characters.entries()) {
    if (/\p{L}/u.test(character)) wordPositions.push(index);
    else maskWord();
  }
  maskWord();
  if (hiddenPositions.size === 0 && characters.length > 0) {
    hiddenPositions.add(0);
  }
  return characters.map((character, index) => hiddenPositions.has(index) ? "_" : character).join("");
}
