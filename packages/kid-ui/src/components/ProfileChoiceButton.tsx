import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";

export interface ProfileChoiceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
}

/** Child profile tile on the profile picker. */
export function ProfileChoiceButton({ type = "button", ref, ...props }: ProfileChoiceButtonProps): ReactElement {
  return <button {...props} ref={ref} type={type} />;
}
