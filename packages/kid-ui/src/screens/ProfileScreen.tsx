import type { ReactNode } from "react";
import { Avatar, Badge, Box, Group, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { messages, type KidProfileDto, type UiAudioKey } from "@learning/contracts";
import { GuidanceButton } from "../components/GuidanceButton";
import { format } from "../format";
import { KidScreen } from "../layout/KidScreen";

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
    <KidScreen role="main" className="kid-screen kid-screen--profile" data-testid="kid-profile-screen">
      <KidScreen.Header>
        <header className="kid-top-bar">{headerActions}{onGuidance && <GuidanceButton audioKey="profile_select" onPlay={onGuidance} testId="kid-profile-guidance" />}</header>
        <Title order={1}>{messages.kid.profilesTitle}</Title>
      </KidScreen.Header>
      <KidScreen.Content>
      {profiles.length === 0 ? (
        <Text className="kid-hint">{messages.kid.noProfiles}</Text>
      ) : (
        <Stack component="ul" className="kid-list" gap="sm">
          {profiles.map((profile) => (
            <li key={profile.childId}>
              <UnstyledButton
                type="button"
                className="kid-profile"
                data-testid="kid-profile"
                onClick={() => onSelect(profile.childId)}
              >
                <Group className="kid-profile-identity" gap="sm" wrap="wrap">
                  <Avatar className="kid-avatar" aria-hidden="true" size={52} radius="xl">{avatarOf(profile.avatarKey)}</Avatar>
                  <Text component="span" fw={700}>{profile.displayName}</Text>
                  {!profile.canRead && <Badge className="kid-profile-tag" variant="light">{messages.kid.nonReaderProfileTag}</Badge>}
                </Group>
                <Box component="span" className="kid-profile-rewards">
                  <Badge className="kid-profile-tag" data-testid="kid-profile-points" variant="light">{format(messages.kid.rewardEarned, { n: profile.rewardPoints ?? 0 })}</Badge>
                </Box>
              </UnstyledButton>
            </li>
          ))}
        </Stack>
      )}
      </KidScreen.Content>
    </KidScreen>
  );
}
