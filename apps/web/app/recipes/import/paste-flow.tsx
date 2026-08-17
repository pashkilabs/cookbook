"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RecipeReview, type Draft } from "./recipe-review";
import { canvasPlan, type Turn } from "./rotation";

/**
 * The two channels a link cannot reach.
 *
 * The import screen has said for weeks that Facebook, Instagram and TikTok links never resolve —
 * a true sentence describing a dead end. These are the way out of it, and they sit beside that
 * sentence rather than being described somewhere else, because a feature nobody can find is not
 * a feature (CLAUDE.md).
 *
 * **Text beats photos** (decisions §49): a caption scores 80.4% against a fixture set where the
 * same recipe read from its own reel frames scores about a third of that, and costs more. So
 * these are two tabs rather than one form with both — the choice is made by which tab you are on,
 * and the route cannot be handed a link and a caption at once.
 */
const MAX_EDGE = 1500;
const JPEG_QUALITY = 0.8;

/**
 * Downscale in the browser, and convert to JPEG.
 *
 * **The format change is the load-bearing part.** A phone screenshot is mostly flat colour and
 * PNG already encodes that well, so resizing alone barely helps: 1.72 MB became 1.62 MB in
 * testing. Re-encoding as JPEG takes the same frame to a few hundred KB.
 *
 * It also saves the upload, which on a phone is the slow half — and the vision path downscales
 * server-side anyway, so sending 3.7 MB for the server to discard is paying twice.
 */
/**
 * Thrown when the browser cannot decode the file at all — which is HEIC, in practice.
 *
 * iPhone's default format. Safari decodes it through the system codec; Chrome, Firefox and Edge
 * cannot, so a photograph taken on a phone and imported on a laptop fails at the first step. It
 * used to fail as "That did not work", which is the least useful sentence available for the most
 * common file the person owns.
 */
class UndecodableImage extends Error {
  constructor(readonly file: File) {
    const heic = /\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type);
    super(
      heic
        ? `${file.name} is a HEIC, which this browser cannot read. Safari can — or set iPhone to ` +
          `Settings → Camera → Formats → Most Compatible, which saves JPEG instead.`
        : `${file.name} could not be read as an image in this browser.`,
    );
  }
}

/** small enough to be free, large enough to read a heading — measured at this size */
const PROBE_EDGE = 448;
const PROBE_QUALITY = 0.55;

/**
 * Draw `bitmap` at `edge` and `quality`, turned `rotate` degrees clockwise.
 *
 * The turn happens here, on the canvas that was already open for the downscale, which is why the
 * rotation costs nothing: it is a transform on a draw that was happening anyway, and the bytes
 * that leave the browser are already the right way up.
 */
async function render(
  bitmap: ImageBitmap,
  { edge, quality, rotate }: { edge: number; quality: number; rotate: Turn },
): Promise<Blob | null> {
  const plan = canvasPlan({ width: bitmap.width, height: bitmap.height, edge, rotate });

  const canvas = document.createElement("canvas");
  canvas.width = plan.canvasWidth;
  canvas.height = plan.canvasHeight;

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(plan.radians);
  context.drawImage(bitmap, plan.offsetX, plan.offsetY, plan.drawWidth, plan.drawHeight);

  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Ask the server which way up this card is, by sending it the same thumbnail four ways.
 *
 * **The four is the point, not a fallback.** Asking about one image — "which way does the writing
 * run?" — was built first and measured: eight probes on a card lying sideways returned eight
 * confident answers and two correct ones, because a model that cannot read sideways writing
 * invents readable writing and reports the rotation that fits the invention. Offering all four at
 * once removes that escape route: the invention is equally available at every rotation, so it
 * cannot choose between them and has to use the letters. 12/12 measured.
 *
 * Four thumbnails at 448px is about 100 KB up and ~1,600 tokens — cheap enough to run every time,
 * which it must be, because the failure it prevents is silent and there is nothing to suspect.
 */
async function detectRotation(bitmap: ImageBitmap): Promise<Turn> {
  const form = new FormData();
  form.append("mode", "orientation");
  for (const turn of [0, 90, 180, 270] as const) {
    const probe = await render(bitmap, { edge: PROBE_EDGE, quality: PROBE_QUALITY, rotate: turn });
    if (!probe) return 0;
    form.append("rotations", probe, `probe-${turn}.jpg`);
  }

  try {
    const response = await fetch("/api/import", { method: "POST", body: form });
    if (!response.ok) return 0;
    const body = (await response.json()) as { orientation?: { rotate?: number } | null };
    const rotate = body.orientation?.rotate;
    return rotate === 90 || rotate === 180 || rotate === 270 ? rotate : 0;
  } catch {
    // a hint, never a blocker: upload unrotated rather than fail the import over an orientation
    return 0;
  }
}

async function downscale(file: File): Promise<{ blob: Blob; rotated: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UndecodableImage(file);
  }

  const rotate = await detectRotation(bitmap);
  const blob = await render(bitmap, { edge: MAX_EDGE, quality: JPEG_QUALITY, rotate });
  bitmap.close();
  // no canvas: send it as it is rather than failing the import
  return { blob: blob ?? file, rotated: rotate };
}

const kb = (bytes: number) => `${Math.round(bytes / 1000)} KB`;

export function PasteFlow({ mode }: { mode: "text" | "photos" }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shrunk, setShrunk] = useState<string | null>(null);
  const router = useRouter();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setShrunk(null);

    try {
      let response: Response;
      if (mode === "text") {
        response = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } else {
        const form = new FormData();
        let before = 0;
        let after = 0;
        let turned = 0;
        for (const file of files) {
          const { blob, rotated } = await downscale(file);
          before += file.size;
          after += blob.size;
          if (rotated) turned += 1;
          form.append("images", blob, file.name.replace(/\.\w+$/, "") + ".jpg");
        }
        // said out loud, because a silent rotation is indistinguishable from not needing one
        setShrunk(
          `${kb(before)} → ${kb(after)} before upload` +
            (turned ? ` · turned ${turned} the right way up` : ""),
        );
        // no Content-Type: the browser sets the multipart boundary itself
        response = await fetch("/api/import", { method: "POST", body: form });
      }

      const body = (await response.json().catch(() => null)) as
        | { draft?: Draft; error?: string }
        | null;
      if (!response.ok || !body?.draft) {
        setError(body?.error ?? `That did not work (HTTP ${response.status}).`);
        return;
      }
      setDraft(body.draft);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function save(edited: Draft) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...edited, photo: null }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!response.ok || !body.id) {
      setError(body.error ?? `could not save (${response.status})`);
      setBusy(false);
      return;
    }
    router.push(`/recipes/${body.id}`);
    router.refresh();
  }

  // the same review screen as every other channel: one place decides what a saved recipe is,
  // so a caption and a link cannot be shown two different renderings of the same parse
  if (draft) {
    return (
      <RecipeReview
        draft={draft}
        photo={null}
        fromCache={false}
        busy={busy}
        error={error}
        discardLabel="Start again"
        onSave={save}
        onDiscard={() => {
          setDraft(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <>
      <form onSubmit={submit}>
        {mode === "text" ? (
          <label>
            <span>The whole caption</span>
            <textarea
              rows={12}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"Paste all of it — the story, the emoji, the hashtags.\nNothing needs tidying up first."}
            />
          </label>
        ) : (
          <label>
            <span>A photograph</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => setFiles([...(event.target.files ?? [])])}
            />
            <span className="meta">
              One photo is usually enough. Add more if the recipe runs over two pages. Each is
              resized here before it is sent, so a phone photo is fine as it comes.
            </span>
          </label>
        )}

        <button className="button primary" disabled={busy || (mode === "text" ? !text.trim() : files.length === 0)}>
          {busy
            ? "Reading…"
            : mode === "text"
              ? "Read this recipe"
              : `Read ${files.length || ""} photo${files.length === 1 ? "" : "s"}`}
        </button>
        {shrunk && <p className="meta">{shrunk}</p>}
        {error && <p className="error">{error}</p>}
      </form>

      <div className="notice" style={{ marginTop: "1.5rem" }}>
        {mode === "text" ? (
          <>
            This reads the words rather than the page, so it works where a link does not — an
            Instagram or Facebook caption, a screenshot you have retyped, a recipe somebody sent
            you. Amounts are read exactly as written, and where a caption gives none, none is
            invented.
          </>
        ) : (
          <>
            For a recipe that only exists on paper — a handwritten card, a magazine clipping, a
            newspaper cutting, a page from a book. Printed and handwritten pages both read well.{" "}
            <strong>A screenshot of a reel does not</strong>: paste its caption instead, which is
            read far better than a picture of one.
            <br />
            <br />
            <strong>Check every line before you save.</strong> The one mistake it makes reliably is
            converting a quantity it thinks it understands — a card reading{" "}
            <em>2 squares unsweetened chocolate&nbsp;(2&nbsp;oz.)</em> comes back as{" "}
            <em>½ cup</em>, which is the same amount and not what you wrote. Read your own card
            against what it says; nothing is saved until you do.
          </>
        )}
      </div>
    </>
  );
}
