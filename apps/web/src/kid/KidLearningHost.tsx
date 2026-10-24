"use client";

import { useMemo } from "react";
import { messages } from "@learning/contracts";
import {
  createBrowserMedia,
  createBrowserPreferences,
  createKidApiClient,
  KidApp,
} from "@learning/kid-ui";
import "@learning/kid-ui/styles.css";
import "@learning/kid-ui/theme.css";
import "../kid-fonts.css";

/** Next.js host injects only route context, parent link and browser adapters into portable Kid UI. */
export function KidLearningHost({
  initialChildId,
  parentHref = "/parent",
}: {
  initialChildId?: string;
  parentHref?: string;
}) {
  const api = useMemo(() => createKidApiClient({ baseUrl: "" }), []);
  const media = useMemo(() => createBrowserMedia(), []);
  const storage = useMemo(() => createBrowserPreferences(), []);
  return (
    <KidApp
      api={api}
      media={media}
      storage={storage}
      parentLink={{ label: messages.kid.parentZone, href: parentHref }}
      {...(initialChildId === undefined ? {} : { initialChildId })}
    />
  );
}
