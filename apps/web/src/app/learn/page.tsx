"use client";

import { useMemo } from "react";
import {
  createBrowserMedia,
  createBrowserPreferences,
  createKidApiClient,
  KidApp,
} from "@learning/kid-ui";
import "@learning/kid-ui/styles.css";

/**
 * Host interfejsu dziecka (architecture.md §12): cienka strona Next.js
 * przekazuje przenośnemu KidApp wyłącznie zależności platformowe — klienta
 * HTTP współdzielonego pochodzenia, adaptery mikrofonu/odtwarzacza i pamięć
 * lokalną. Bez logiki aplikacji i bez sekretów.
 */
export default function LearnPage() {
  const api = useMemo(() => createKidApiClient({ baseUrl: "" }), []);
  const media = useMemo(() => createBrowserMedia(), []);
  const storage = useMemo(() => createBrowserPreferences(), []);
  return <KidApp api={api} media={media} storage={storage} />;
}
