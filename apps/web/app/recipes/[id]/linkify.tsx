import type { ReactNode } from "react";

/**
 * Turn the URLs in a piece of plain text into links, without ever treating the text as markup.
 *
 * **Nothing here renders HTML, and that is the whole point.** `recipe_steps` is plain text and
 * some of it came from a model reading a stranger's caption; `dangerouslySetInnerHTML` over that
 * is an injection bug waiting for the first recipe containing a script tag. So the text is split
 * into runs and React renders each run as a text node or an anchor — every character that is not
 * part of a matched URL stays text, escaped by React as text always is.
 *
 * `rel="noopener noreferrer"` on every link: `noopener` denies the opened page a handle on this
 * one via `window.opener`, and `noreferrer` keeps the household's URL out of a third party's logs.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

export function linkify(text: string): ReactNode {
  const source = String(text ?? "");
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of source.matchAll(URL_RE)) {
    const start = match.index;
    if (start > cursor) parts.push(source.slice(cursor, start));

    const href = match[0];
    parts.push(
      <a key={`${start}-${href}`} href={href} target="_blank" rel="noopener noreferrer">
        {href}
      </a>,
    );
    cursor = start + href.length;
  }

  if (cursor === 0) return source; // no URL: one string, no array, no keys
  if (cursor < source.length) parts.push(source.slice(cursor));
  return parts;
}
