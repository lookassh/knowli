import { callParent, parentClient } from "./api";

/**
 * PATCH ustawień sesji nauki zestawu (`decks.session_task_budget`) — wspólna
 * operacja zapisu edytorów słówek i lekcji (ten sam endpoint i przestrzeń id
 * decków). Zwraca budżet potwierdzony przez serwer.
 */
export async function patchDeckSessionTaskBudget(
  deckId: string,
  sessionTaskBudget: number,
): Promise<number> {
  const result = await callParent(() => parentClient.decks.updateSettings({ deckId, sessionTaskBudget }));
  return result.sessionTaskBudget;
}
