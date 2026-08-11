# Intake

Raw material waiting to become fixtures. Drop things here; nothing in this
folder is loaded by the harness or the tests.

The pipeline is deliberately two-step:

```
intake/          raw, as it arrived — links, captions, screenshots
   ↓             a human decides what "correct" means
fixtures/*.ts    typed, hand-checked expected output
```

The second step is the one that can't be automated. An expected output copied
from what an extractor produced measures agreement with today's bugs, not
accuracy.

## Where things go

| Drop | Where | As |
|---|---|---|
| Recipe blog links | `urls.md` | one per line, plus a note on what's awkward about it |
| Social captions | `captions/` | one `.txt` per caption, plain text |
| Reel screenshots | `screenshots/` | one image per file, named for its source |

## Don't tidy them up

The formatting *is* the fixture. Keep:

- original line breaks — a caption's line structure is most of the signal
- the pinned comment, if that's where half the ingredients live. Put it in the
  same file under a `--- pinned comment ---` line so the split is visible
- units as written, including `T` vs `t`, `1½`, `14.5 oz.`, and prices or macros
  in parentheses
- typos, emoji, and "amounts" that are only spoken aloud in the video

A cleaned-up caption tests a caption nobody posted.

## Naming

`source-dish.txt` — `instagram-carbonara.txt`, `pinterest-sheet-pan-salmon.txt`.
Screenshots the same: `reel-birria-tacos-01.png`. Numbers when one recipe spans
several frames.

## What we need

Twenty is enough to be worth measuring:

- [ ] 6–8 recipe blog URLs
- [ ] 6–8 captions (Instagram / Pinterest / Facebook)
- [ ] 3–4 reel screenshots

Bias toward the awkward ones. A recipe that parses cleanly tells us nothing we
don't already know from the 89 unit tests.

## Worth deciding before this folder fills up

**Whether raw captions and screenshots get committed.** They're third-party
content, and the copyright posture is still open in `docs/decisions.md`. Links
are safe — they're references. Full captions and screenshots are the ones to
think about. If the answer is "keep them local", add `intake/captions/` and
`intake/screenshots/` to `.gitignore` and the fixtures will still work, since
expected output lives in the typed fixture rather than here.

**How much of a page a URL fixture captures.** The pages checked so far run
300–680 KB each, mostly ads and scripts. Committing eight of those is ~4 MB of
noise. Capturing just the JSON-LD `Recipe` node plus the ingredient markup keeps
the fixture readable and still exercises tiers 0 and 1. Decide once, before
capturing eight of them.
