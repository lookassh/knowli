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
  onRequestXbox,
  requestingChildId,
  requestErrorChildId,
}: {
  profiles: KidProfileDto[];
  onSelect: (childId: string) => void;
  headerActions?: ReactNode;
  onGuidance?: (key: UiAudioKey) => Promise<void>;
  onRequestXbox?: (childId: string) => void;
  requestingChildId?: string | null;
  requestErrorChildId?: string | null;
}) {
  return (
    <main className="kid-screen kid-screen--profile">
      <header className="kid-top-bar">{headerActions}{onGuidance && <GuidanceButton audioKey="profile_select" onPlay={onGuidance} testId="kid-profile-guidance" />}</header>
      <h1>{messages.kid.profilesTitle}</h1>
      {profiles.length === 0 ? (
        <p className="kid-hint">{messages.kid.noProfiles}</p>
      ) : (
        <ul className="kid-list">
          {profiles.map((profile) => {
            const request = profile.rewards?.xboxRequest ?? null;
            const readyPacks = profile.rewards?.readyXboxPacks ?? 0;
            const requesting = requestingChildId === profile.childId;
            return <li key={profile.childId}>
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
              {request?.status === "pending" && <p className="kid-hint kid-profile-request-status" data-testid="kid-xbox-request-pending">{messages.kid.rewardXboxRequestPending}</p>}
              {request?.status === "fulfilled" && <p className="kid-hint kid-profile-request-status">{messages.kid.rewardXboxRequestFulfilled}</p>}
              {request?.status === "rejected" && <p className="kid-hint kid-profile-request-status">{messages.kid.rewardXboxRequestRejected}</p>}
              {readyPacks > 0 && request?.status !== "pending" && onRequestXbox && <button
                type="button"
                className="kid-profile-request"
                data-testid="kid-xbox-request"
                disabled={requesting}
                onClick={() => onRequestXbox(profile.childId)}
              >{requesting ? messages.kid.rewardXboxRequestSending : messages.kid.rewardXboxRequestAction}</button>}
              {requestErrorChildId === profile.childId && <p className="kid-hint kid-profile-request-status" role="alert">{messages.kid.rewardXboxRequestFailure}</p>}
            </li>;
          })}
        </ul>
      )}
    </main>
  );
}
