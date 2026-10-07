import Image from "next/image";
import { PHOTOS, type PhotoKey } from "./photos";

export function PageBanner({
  photo,
  alt,
  labelledBy,
  compact = false,
  priority = false,
  children,
  aside,
}: {
  photo: PhotoKey;
  alt: string;
  labelledBy: string;
  compact?: boolean;
  priority?: boolean;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className={compact ? "hero hero-compact" : "hero"} aria-labelledby={labelledBy}>
      <div className="hero-photo">
        <Image src={PHOTOS[photo].src} alt={alt} fill priority={priority} sizes="(max-width: 860px) 100vw, 66vw" />
      </div>
      <div className="hero-body">{children}</div>
      {aside}
    </section>
  );
}
