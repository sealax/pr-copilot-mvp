import type { HTMLAttributes } from "react";

export function PageContainer({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`page-container ${className}`.trim()} {...props} />;
}
