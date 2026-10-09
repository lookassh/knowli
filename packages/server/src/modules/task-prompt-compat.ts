/**
 * Fills fields introduced after a task was issued while preserving the meaning
 * of the persisted snapshot. Older prompts used a non-null imageAssetId as the
 * marker that the child should see an illustration.
 */
export function addLegacyTaskPromptDefaults(publicPrompt: Record<string, unknown>): Record<string, unknown> {
  const prompt = { ...publicPrompt };
  if (prompt.kind === "exposure") {
    if (prompt.exampleAudioAssetId === undefined) prompt.exampleAudioAssetId = null;
    if (prompt.imageAssetId === undefined) prompt.imageAssetId = null;
    if (prompt.visualType === undefined) prompt.visualType = prompt.imageAssetId === null ? "none" : "image";
  }
  if (prompt.kind === "speech") {
    if (prompt.imageAssetId === undefined) prompt.imageAssetId = null;
    if (prompt.visualType === undefined) prompt.visualType = prompt.imageAssetId === null ? "none" : "image";
  }
  return prompt;
}
