"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { canvasPlan } from "./import/rotation";

/**
 * Add a photograph to a recipe. One control, four places.
 *
 * Built once because it was missing everywhere: there was no add-photo control on the detail
 * screen, none on any review screen, and no upload route at all — `api/photos` contained only a
 * reaper. Every recipe that did not arrive from a link with an image in its markup showed a
 * placeholder initial forever, and nothing in the product could change that.
 *
 * **The picture is the household's, not the source's.** It is stored with `source = 'camera'`
 * regardless of how the recipe arrived, which is the distinction the storage policies and §17's
 * publishing rule both turn on.
 *
 * **Not the card.** A photograph of a recipe card is provenance rather than a picture of food,
 * and §17 makes published recipes world-readable — a copyrighted printed page must not go on one.
 * That is `source = 'source'`, deliberately separate, and until it exists the import Photograph
 * path still discards its card image.
 *
 * Downscaled with the same `canvasPlan` the orientation work uses, for the same reasons: it saves
 * the upload on a phone, and `canvas.toBlob` re-encodes from raw pixels, which strips EXIF
 * outright so a device identifier and a home address never leave the browser.
 */
const MAX_EDGE = 1500;
const JPEG_QUALITY = 0.8;

async function downscale(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC, in practice: iPhone's default, which only Safari decodes
    throw new Error(
      /\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type)
        ? `${file.name} is a HEIC, which this browser cannot read. Safari can — or set iPhone to ` +
          `Settings → Camera → Formats → Most Compatible.`
        : `${file.name} could not be read as an image in this browser.`,
    );
  }

  const plan = canvasPlan({ width: bitmap.width, height: bitmap.height, edge: MAX_EDGE, rotate: 0 });
  const canvas = document.createElement("canvas");
  canvas.width = plan.canvasWidth;
  canvas.height = plan.canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) return file; // no canvas: send it as it is rather than refusing the photo
  context.drawImage(bitmap, 0, 0, plan.drawWidth, plan.drawHeight);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  return blob ?? file;
}

export async function uploadRecipePhoto(recipeId: string, file: File): Promise<string | null> {
  const form = new FormData();
  form.append("recipeId", recipeId);
  form.append("photo", await downscale(file), "photo.jpg");
  const response = await fetch("/api/recipes", { method: "POST", body: form });
  if (response.ok) return null;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `that photo did not upload (HTTP ${response.status})`;
}

export function PhotoUpload({
  recipeId,
  label = "Add a photo",
}: {
  recipeId: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const failed = await uploadRecipePhoto(recipeId, file);
      if (failed) setError(failed);
      else router.refresh();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "that photo did not upload.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="photo-upload">
      {/* a label wrapping the input is the whole control: tappable, keyboard-reachable, and it
          names itself — an unlabelled icon is a feature nobody can find (CLAUDE.md) */}
      <label className="button">
        {busy ? "Uploading…" : label}
        <input type="file" accept="image/*" disabled={busy} onChange={choose} hidden />
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
