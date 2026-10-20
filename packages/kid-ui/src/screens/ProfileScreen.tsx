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

/**
 * Ekran wyboru profilu — wybór nie jest zabezpieczeniem (arch §13). Pokazuje
 * JEDEN ogólny licznik dorobku punktów dziecka; bez salda do wydania, dziennych
 * celów i pakietów (spec client-reward-time).
 */
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
                  <span className="kid-profile-tag" data-testid="kid-profile-points">{format(messages.kid.rewardEarned, { n: profile.rewardPoints ?? 0 })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
