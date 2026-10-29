import type { HTMLAttributes, LiHTMLAttributes, ReactElement, ReactNode } from "react";
import styles from "./RowList.module.css";

export function RowList({ className, ...rest }: HTMLAttributes<HTMLUListElement>): ReactElement {
  return <ul {...rest} className={[styles.list, className].filter(Boolean).join(" ")} />;
}

export interface RowListItemProps extends Omit<LiHTMLAttributes<HTMLLIElement>, "title"> {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  below?: ReactNode;
}

export function RowListItem({ leading, title, description, trailing, below, className, ...li }: RowListItemProps): ReactElement {
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  const hasTrailing = trailing !== undefined && trailing !== null && trailing !== false;
  return (
    <li
      {...li}
      className={[styles.row, className].filter(Boolean).join(" ")}
      data-leading={hasLeading ? "true" : "false"}
      data-trailing={hasTrailing ? "true" : "false"}
    >
      {hasLeading ? <div className={styles.leading}>{leading}</div> : null}
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {description ? <div className={styles.description}>{description}</div> : null}
        {below ? <div className={styles.below}>{below}</div> : null}
      </div>
      {hasTrailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </li>
  );
}
