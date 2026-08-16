# Photograph fixtures — handwritten cards and printouts

Stephen's own recipe binder, photographed on an iPhone. This is the input class the
Photograph channel exists for, and nothing like it has been measured — every vision
number so far is from reel screenshots, which are rendered text at 12px over video.

## Provenance

Seventeen HEIC files, converted to JPEG at 1500px longest edge, quality 85. The
conversion mirrors what the client-side picker does before upload, so the fixture is
the shape the model actually receives rather than the raw capture.

Originals are 3024x4032 HEIC, ~1.3–2.2 MB each.

## What the EXIF says, and why it matters

**Every one of the seventeen is EXIF orientation 1 — upright.** The cards that appear
sideways are sideways because the paper was rotated in front of the camera, not because
the phone recorded a rotation hint.

So the free half of the rotation fix does not apply here: there is no EXIF tag to read
and honour. A manual rotate control on the thumbnail is the only thing that helps, and
it is therefore not optional.

## What is in the set

Handwritten cards in binder sleeves, a shopping list, a printed cookbook page, and a
four-page printout of a Hot Cross Buns recipe. Several recipes span more than one
photograph — ingredients on one card, dressing on another, method on a facing page.

The grouping is not derivable from the files. It needs Stephen.

## Known hard cases

- **Multi-page.** Chicken and wild rice salad, and the Hot Cross Buns printout. Frames
  are different PARTS of one recipe, not repeated views of it — the opposite of what
  the reel fusion prompt assumes.
- **Two scales on one card.** card-7320 (Chocolate Peppermint Bars) carries a second
  column doubling every quantity: 2 squares/4 squares, 1 stick/2 sticks, 1C/2C, 9x13.
  A model reading across produces one list correct for neither, and it will look
  entirely plausible. The review screen cannot catch that, because nothing on it says
  two readings were merged.
- **Rotation.** Roughly half are photographed sideways, with no EXIF hint.
- **Real card structure.** Recipe / Source / Ingredients / Instructions / serves, and
  can-do-ahead / can-freeze / serve-immediately checkboxes. More signal than a reel
  frame — and `Source: Mom O.` is better provenance than any URL, mapping to
  recipes.source_name with no schema change.
