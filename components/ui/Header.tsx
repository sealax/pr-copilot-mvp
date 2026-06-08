import type { ReactNode } from "react";
import { PageContainer } from "./PageContainer";

type HeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions: ReactNode;
};

export function Header({ eyebrow, title, description, actions }: HeaderProps) {
  return (
    <header className="site-header">
      <PageContainer className="site-header-inner">
        <div className="brand-block">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="tagline">{description}</p>
        </div>
        {actions}
      </PageContainer>
    </header>
  );
}
