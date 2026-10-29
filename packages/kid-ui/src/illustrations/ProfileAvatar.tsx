import type { ReactElement, ReactNode } from "react";

export const PROFILE_AVATAR_KEYS = ["fox", "bear", "cat", "dog", "owl", "rabbit"] as const;

type AvatarKey = (typeof PROFILE_AVATAR_KEYS)[number];

// Płaskie kształty, maks. 5 kolorów na zwierzę; viewBox 48×48 wspólny dla wszystkich.
const AVATARS: Record<AvatarKey | "fallback", ReactNode> = {
  fox: (
    <>
      <path d="M7 9 L18 18 L30 18 L41 9 L39 28 Q24 46 9 28 Z" fill="#E8783A" />
      <path d="M13 28 Q24 41 35 28 Q24 33 13 28 Z" fill="#FFF3E6" />
      <circle cx="18.5" cy="25" r="2.2" fill="#3B2418" />
      <circle cx="29.5" cy="25" r="2.2" fill="#3B2418" />
      <circle cx="24" cy="33" r="2.2" fill="#3B2418" />
    </>
  ),
  bear: (
    <>
      <circle cx="11" cy="12" r="6.5" fill="#B9794B" />
      <circle cx="37" cy="12" r="6.5" fill="#B9794B" />
      <circle cx="11" cy="12" r="3.2" fill="#E8B48A" />
      <circle cx="37" cy="12" r="3.2" fill="#E8B48A" />
      <circle cx="24" cy="26" r="16" fill="#B9794B" />
      <ellipse cx="24" cy="32" rx="7.5" ry="5.8" fill="#F2D3B3" />
      <circle cx="17.5" cy="22" r="2.2" fill="#2B1B12" />
      <circle cx="30.5" cy="22" r="2.2" fill="#2B1B12" />
      <ellipse cx="24" cy="30" rx="2.8" ry="2" fill="#2B1B12" />
    </>
  ),
  cat: (
    <>
      <path d="M8 6 L20 15 L28 15 L40 6 L41 28 Q24 46 7 28 Z" fill="#B7A9D6" />
      <path d="M11 11 L17 16 L11 21 Z" fill="#F4B6C2" />
      <path d="M37 11 L31 16 L37 21 Z" fill="#F4B6C2" />
      <ellipse cx="17.5" cy="26" rx="2.2" ry="2.8" fill="#2A2236" />
      <ellipse cx="30.5" cy="26" rx="2.2" ry="2.8" fill="#2A2236" />
      <path d="M22 31 L26 31 L24 33.5 Z" fill="#F4B6C2" />
      <path d="M4 29 L14 31 M4 35 L14 34 M44 29 L34 31 M44 35 L34 34" fill="none" stroke="#EFE6FA" strokeLinecap="round" strokeWidth="1.4" />
    </>
  ),
  dog: (
    <>
      <ellipse cx="9" cy="23" rx="5.5" ry="11" fill="#A06E3F" transform="rotate(12 9 23)" />
      <ellipse cx="39" cy="23" rx="5.5" ry="11" fill="#A06E3F" transform="rotate(-12 39 23)" />
      <path d="M12 10 Q24 4 36 10 Q40 26 34 38 Q24 46 14 38 Q8 26 12 10 Z" fill="#D9A76A" />
      <ellipse cx="24" cy="32" rx="8.5" ry="6.5" fill="#F6E3C8" />
      <circle cx="18" cy="22" r="2.2" fill="#2B1B12" />
      <circle cx="30" cy="22" r="2.2" fill="#2B1B12" />
      <ellipse cx="24" cy="29.5" rx="3.2" ry="2.3" fill="#2B1B12" />
    </>
  ),
  owl: (
    <>
      <path d="M8 6 L19 13 L29 13 L40 6 L42 28 Q24 50 6 28 Z" fill="#A27B5C" />
      <ellipse cx="24" cy="32" rx="9" ry="5.5" fill="#D9BFA0" />
      <circle cx="16.5" cy="23" r="7" fill="#FFF3E6" />
      <circle cx="31.5" cy="23" r="7" fill="#FFF3E6" />
      <circle cx="17" cy="24" r="3.2" fill="#2B1B12" />
      <circle cx="31" cy="24" r="3.2" fill="#2B1B12" />
      <path d="M21 28 L27 28 L24 35 Z" fill="#F2B544" />
    </>
  ),
  rabbit: (
    <>
      <ellipse cx="16" cy="12" rx="5" ry="11" fill="#E9E4EF" transform="rotate(-8 16 12)" />
      <ellipse cx="32" cy="12" rx="5" ry="11" fill="#E9E4EF" transform="rotate(8 32 12)" />
      <ellipse cx="16" cy="13" rx="2.2" ry="7.5" fill="#F4B6C2" transform="rotate(-8 16 13)" />
      <ellipse cx="32" cy="13" rx="2.2" ry="7.5" fill="#F4B6C2" transform="rotate(8 32 13)" />
      <circle cx="24" cy="31" r="14" fill="#E9E4EF" />
      <circle cx="18.5" cy="29" r="2.1" fill="#3A3045" />
      <circle cx="29.5" cy="29" r="2.1" fill="#3A3045" />
      <path d="M22 33.5 L26 33.5 L24 36 Z" fill="#F4B6C2" />
    </>
  ),
  fallback: (
    <>
      <circle cx="24" cy="24" r="18" fill="#7FB5C9" />
      <circle cx="18" cy="21" r="2.4" fill="#12242B" />
      <circle cx="30" cy="21" r="2.4" fill="#12242B" />
      <path d="M16 29 Q24 37 32 29" fill="none" stroke="#12242B" strokeLinecap="round" strokeWidth="2.4" />
    </>
  ),
};

function isAvatarKey(value: string): value is AvatarKey {
  return (PROFILE_AVATAR_KEYS as readonly string[]).includes(value);
}

/** Zwierzęcy awatar profilu dziecka; nieznany klucz daje neutralną buźkę. */
export function ProfileAvatar({ avatarKey, size = 72 }: { avatarKey: string; size?: number }): ReactElement {
  const known = isAvatarKey(avatarKey);
  return (
    <svg
      aria-hidden="true"
      data-avatar={known ? avatarKey : "fallback"}
      focusable="false"
      height={size}
      viewBox="0 0 48 48"
      width={size}
    >
      {AVATARS[known ? avatarKey : "fallback"]}
    </svg>
  );
}
