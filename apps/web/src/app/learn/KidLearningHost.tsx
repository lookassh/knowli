"use client";

import { useMemo } from "react";
import {
  createBrowserMedia,
  createBrowserPreferences,
  createKidApiClient,
  KidApp,
} from "@learning/kid-ui";
import "@learning/kid-ui/styles.css";

/** Next.js host injects only route context and browser adapters into portable Kid UI. */
export function KidLearningHost({ initialChildId }: { initialChildId?: string }) {
  const api = useMemo(() => createKidApiClient({ baseUrl: "" }), []);
  const media = useMemo(() => createBrowserMedia(), []);
  const storage = useMemo(() => createBrowserPreferences(), []);
  return (
    <KidApp
      api={api}
      media={media}
      storage={storage}
      {...(initialChildId === undefined ? {} : { initialChildId })}
    />
  );
}
