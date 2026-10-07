import { t } from "@/i18n/t";
import { PHOTOS, type PhotoKey } from "./photos";

export function PhotoCredit({ photo }: { photo: PhotoKey }) {
  const p = PHOTOS[photo];
  return (
    <footer className="credits">
      <p>
        {t("photo.prefix")} <a href={p.sourceUrl}>{p.title}</a> {t("photo.by")} {p.author}, <a href={p.licenseUrl}>{p.license}</a>. {t("photo.treatment")}
      </p>
    </footer>
  );
}
