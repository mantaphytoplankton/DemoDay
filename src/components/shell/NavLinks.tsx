"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/i18n/t";

export function NavLinks() {
  const path = usePathname();
  const current = (p: string) => (path.startsWith(p) ? "page" : undefined);
  return (
    <nav className="nav" aria-label={t("nav.main")}>
      <Link href="/evaluate" aria-current={current("/evaluate") ?? current("/results")}>{t("nav.evaluate")}</Link>
      <Link href="/batches" aria-current={current("/batches")}>{t("nav.batches")}</Link>
      <Link href="/rubric" aria-current={current("/rubric")}>{t("nav.rubric")}</Link>
    </nav>
  );
}
