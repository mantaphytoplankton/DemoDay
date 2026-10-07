import Link from "next/link";
import { t } from "@/i18n/t";
import { LogoMark } from "@/components/brand/LogoMark";
import { NavLinks } from "./NavLinks";
import { ShortcutsDialog } from "./ShortcutsDialog";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">{t("app.skip")}</a>
      <header className="topbar">
        <Link className="brand" href="/evaluate">
          <LogoMark size={22} />
          <span>{t("app.name")}</span>
        </Link>
        <NavLinks />
        <div className="topbar-end">
          <ShortcutsDialog />
        </div>
      </header>
      <p className="notice">{t("app.notice")}</p>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
