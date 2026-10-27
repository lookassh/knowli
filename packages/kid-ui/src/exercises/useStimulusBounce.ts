import { useState } from "react";

/** Replay bounce for the exposure stimulus: every replay bumps the key,
 * which replays the stimulus bounce animation in the visual components. */
export function useStimulusBounce(onPlay: () => void): readonly [number, () => void] {
  const [bounceKey, setBounceKey] = useState(0);
  const playWithBounce = () => {
    setBounceKey((key) => key + 1);
    onPlay();
  };
  return [bounceKey, playWithBounce] as const;
}
