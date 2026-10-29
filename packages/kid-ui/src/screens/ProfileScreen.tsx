import type { ReactNode } from "react";
import { messages, type KidProfileDto, type UiAudioKey } from "@learning/contracts";
import { GuidanceButton } from "../components/GuidanceButton";
import { ProfileChoiceButton } from "../components/ProfileChoiceButton";
import { m } from "motion/react";
import { kidEntranceAnimate, kidEntranceInitial, kidSpringGentle, kidStaggerDelay } from "../motion/kid-motion";
import { format } from "../format";
import { KidScreen } from "../layout/KidScreen";
import { Chip } from "../components/Chip";
import { EmptyScene } from "../illustrations/EmptyScene";
import { ProfileAvatar } from "../illustrations/ProfileAvatar";

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
    <KidScreen role="main" className="kid-screen kid-screen--profile" data-testid="kid-profile-screen">
      <KidScreen.Header variant="band">
        <header className="kid-top-bar">{headerActions}{onGuidance && <GuidanceButton audioKey="profile_select" onPlay={onGuidance} testId="kid-profile-guidance" />}</header>
        <h1>{messages.kid.profilesTitle}</h1>
      </KidScreen.Header>
      <KidScreen.Content>
      {profiles.length === 0 ? (
        <div className="kid-profile-empty">
          <EmptyScene className="kid-profile-empty__scene" />
          <p className="kid-hint">{messages.kid.noProfiles}</p>
        </div>
      ) : (
        <ul className="kid-profile-grid">
          {profiles.map((profile, index) => (
            <m.li key={profile.childId} initial={kidEntranceInitial} animate={kidEntranceAnimate} whileHover={{ y: -4 }} transition={{ ...kidSpringGentle, delay: kidStaggerDelay(index) }}>
              <ProfileChoiceButton
                type="button"
                className="kid-profile"
                data-testid="kid-profile"
                onClick={() => onSelect(profile.childId)}
              >
                <span className="kid-profile-avatar"><ProfileAvatar avatarKey={profile.avatarKey} size={72} /></span>
                <span className="kid-profile-body">
                  <span className="kid-profile-name">{profile.displayName}</span>
                  <span className="kid-profile-chips">
                    {!profile.canRead && <Chip>{messages.kid.nonReaderProfileTag}</Chip>}
                    <Chip tone="warm" icon="sparkles" data-testid="kid-profile-points">{format(messages.kid.rewardEarned, { n: profile.rewardPoints ?? 0 })}</Chip>
                  </span>
                </span>
              </ProfileChoiceButton>
            </m.li>
          ))}
        </ul>
      )}
      </KidScreen.Content>
    </KidScreen>
  );
}
