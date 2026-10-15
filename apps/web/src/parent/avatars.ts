/** Wspólna lista avatarów dzieci (klucz kontraktu → emoji). */
export const AVATARS: Array<{ key: string; emoji: string }> = [
  { key: "fox", emoji: "🦊" },
  { key: "cat", emoji: "🐱" },
  { key: "owl", emoji: "🦉" },
  { key: "panda", emoji: "🐼" },
];

export function avatarEmoji(key: string): string {
  return AVATARS.find((avatar) => avatar.key === key)?.emoji ?? "🙂";
}
