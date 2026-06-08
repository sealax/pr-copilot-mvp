import type { HTMLAttributes } from "react";

type CardElement = "div" | "section" | "aside";

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: CardElement;
};

export function Card({ as: Component = "div", className = "", ...props }: CardProps) {
  return <Component className={`card ${className}`.trim()} {...props} />;
}
