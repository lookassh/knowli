import type { MeaningVisual as MeaningVisualDto } from "@learning/contracts";
import { messages } from "@learning/contracts";
import { m } from "motion/react";
import { formatVisualCountLabel } from "./visual-labels";
import { NumberVisual } from "./NumberVisual";
import { kidSpringGentle, kidStimulusAnimate, kidStimulusBounce, kidStimulusBounceTransition, kidStimulusInitial } from "../motion/kid-motion";

export function MeaningVisualView({ visual, mediaUrl, numberDisplay = "digit", bounceKey = 0 }: { visual: MeaningVisualDto; mediaUrl: (id: string) => string; numberDisplay?: "apples" | "digit"; bounceKey?: number }) {
  const bounce = bounceKey > 0;
  const initial = bounce ? { opacity: 1, scale: 0.96 } : kidStimulusInitial;
  const animate = bounce ? kidStimulusBounce : kidStimulusAnimate;
  const transition = bounce ? kidStimulusBounceTransition : kidSpringGentle;
  switch (visual.kind) {
    case "image":
      return <m.img key={bounceKey} className="kid-illustration" src={mediaUrl(visual.imageAssetId)} alt="" data-testid="kid-illustration" decoding="async" initial={initial} animate={animate} transition={transition} />;
    case "color":
      return <m.svg key={bounceKey} className="kid-visual" viewBox="0 0 96 96" role="img" aria-label={messages.kid.visualColorLabel} initial={initial} animate={animate} transition={transition}><rect x="8" y="8" width="80" height="80" rx="12" fill={visual.color} /></m.svg>;
    case "number":
      return <NumberVisual count={visual.count} label={formatVisualCountLabel(visual.count)} display={numberDisplay} />;
  }
}
