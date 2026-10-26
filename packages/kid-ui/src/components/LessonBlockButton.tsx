import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";

export interface LessonBlockButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
}

/** Movable word block in lesson ordering exercises (pool and sentence). */
export function LessonBlockButton({ type = "button", ref, ...props }: LessonBlockButtonProps): ReactElement {
  return <button {...props} ref={ref} type={type} />;
}
