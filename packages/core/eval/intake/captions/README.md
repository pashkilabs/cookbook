# Captions

One `.txt` per caption, plain text, exactly as copied. Name them
`source-dish.txt`.

Nothing here yet — these have to come from saved posts, which means they come
from you. Instagram, Pinterest and Facebook content isn't reachable from here:
the links don't resolve (see `CLAUDE.md`), and pulling from those platforms
server-side is ruled out in `docs/decisions.md` §12.

## Format

Keep the original line breaks. Where the ingredients are split between the
caption and a pinned comment, put both in one file with the boundary marked, so
the fixture records that the split happened:

```
Best carbonara you'll ever make 🍝 recipe below!!

full ingredients in the comments 👇

--- pinned comment ---
1 lb spaghetti
4 egg yolks + 1 whole egg
100g pecorino
```

That shape is the whole reason captions are a separate input kind — a caption
alone would be unparseable and *should* score badly if the pinned comment is
missing.

## Worth capturing

- amounts given only in the video, never written — note them as
  `# spoken: about a cup of cream` so the expected output can record what a text
  extractor cannot possibly get
- emoji used as bullets
- ingredient lists with no amounts at all
- "recipe in my bio" posts with nothing usable — a fixture that *should* fail to
  extract is worth having, because the pipeline needs to fail politely rather
  than guess
