import type { ReactNode } from "react";
import { messages, type KidProfileDto, type UiAudioKey } from "@learning/contracts";
import { GuidanceButton } from "../components/GuidanceButton";
import { format } from "../format";

const AVATARS: Record<string, string> = {
  fox: "🦊",
  bear: "🐻",
  cat: "🐱",
  dog: "🐶",
  owl: "🦉",
  rabbit: "🐰",
};

function avatarOf(avatarKey: string): string {
  return AVATARS[avatarKey] ?? "🙂";
}

function xboxPackUnit(count: number): string {
  if (count === 1) return messages.kid.rewardXboxPackOne;
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
    ? messages.kid.rewardXboxPackFew
    : messages.kid.rewardXboxPackMany;
}

/** Ekran wyboru profilu — wybór nie jest zabezpieczeniem (arch §13). */
export function ProfileScreen({
  profiles,
  onSelect,
  headerActions,
  onGuidance,
}: {
  profiles: KidProfileDto[];
  onSelect: (childId: string) => void;
  headerActions?: ReactNode;
  onGuidance?: (key: UiAudioKey) => Promise<void>;
}) {
  return (
    <main className="kid-screen kid-screen--profile">
      <header className="kid-top-bar">{headerActions}{onGuidance && <GuidanceButton audioKey="profile_select" onPlay={onGuidance} testId="kid-profile-guidance" />}</header>
      <h1>{messages.kid.profilesTitle}</h1>
      {profiles.length === 0 ? (
        <p className="kid-hint">{messages.kid.noProfiles}</p>
      ) : (
        <ul className="kid-list">
          {profiles.map((profile) => (
            <li key={profile.childId}>
              <button
                type="button"
                className="kid-profile"
                data-testid="kid-profile"
                onClick={() => onSelect(profile.childId)}
              >
                <span className="kid-profile-identity">
                  <span className="kid-avatar" aria-hidden="true">{avatarOf(profile.avatarKey)}</span>
                  <span>{profile.displayName}</span>
                  {!profile.canRead && <span className="kid-profile-tag">{messages.kid.nonReaderProfileTag}</span>}
                </span>
                <span className="kid-profile-rewards">
                  <span className="kid-profile-tag">{format(messages.kid.rewardEarned, { n: profile.rewards?.earnedPoints ?? 0 })}</span>
                  <span className="kid-profile-tag">{format(messages.kid.rewardToUse, { n: profile.rewards?.pointsToUse ?? 0 })}</span>
                  {(() => {
                    const packs = profile.rewards?.readyXboxPacks ?? 0;
                    return <span className="kid-profile-tag">{format(messages.kid.rewardXboxPacks, { n: packs, unit: xboxPackUnit(packs) })}</span>;
                  })()}
                  {(() => {
                  const seconds = profile.rewards?.todayCreditedSeconds ?? 0;
                  const done = Math.floor(seconds / 60);
                  return <span className="kid-profile-tag" data-testid="kid-daily-reward-progress">
                    {seconds >= 1800
                      ? <>{messages.kid.rewardTodayReached} · {format(messages.kid.rewardTodayNext, { done: Math.floor((seconds % 1800) / 60) })}</>
                      : format(messages.kid.rewardToday, { done })}
                  </span>;
                  })()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
