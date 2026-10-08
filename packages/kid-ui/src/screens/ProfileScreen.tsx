import { messages, type KidProfileDto } from "@learning/contracts";

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

/** Ekran wyboru profilu — wybór nie jest zabezpieczeniem (arch §13). */
export function ProfileScreen({
  profiles,
  onSelect,
}: {
  profiles: KidProfileDto[];
  onSelect: (childId: string) => void;
}) {
  return (
    <main className="kid-screen">
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
                <span className="kid-avatar" aria-hidden="true">
                  {avatarOf(profile.avatarKey)}
                </span>
                <span>{profile.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
