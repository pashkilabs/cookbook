import Link from "next/link";

/**
 * A recipe, as a **vertical** tile: photograph across the top, title below, a line of meta under
 * that.
 *
 * The horizontal card it replaces in these layouts — `96px 1fr` with 20px padding — is correct in
 * a full-width list and impossible in a 169px column: 129px of content less a 96px photograph and
 * a 16px gap leaves 17px for the title, and the browser rendered it at **0px wide and 329px
 * tall**, one character per line. Nothing beside anything is the whole idea here.
 *
 * A server component: it is a link and some text, and there is nothing for a client bundle to do.
 */
export function Tile({
  id,
  title,
  photo,
  meta,
}: {
  id: string;
  title: string;
  photo: string | undefined;
  meta?: string;
}) {
  return (
    <Link className="h-tile" href={`/recipes/${id}`}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire, so next/image
        // would cache a URL that stops resolving
        <img className="h-tile-photo" src={photo} alt="" loading="lazy" />
      ) : (
        /* the initial, which differs between tiles — a shelf of identical placeholders reads as
           one thing rather than as several */
        <span className="h-tile-photo" aria-hidden="true">
          {title.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
      <div className="h-tile-body">
        <h2 className="h-tile-title">{title}</h2>
        {meta && <p className="h-layout-count">{meta}</p>}
      </div>
    </Link>
  );
}
