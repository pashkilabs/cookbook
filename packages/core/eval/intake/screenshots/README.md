# Screenshots

Reel and story frames. One image per file, `reel-dish-01.png`.

Nothing here yet, and nothing can be — these are frames from videos on your
phone. There's no way for me to produce them.

## What makes a good one

- **on-screen text carrying the amounts** while the narration carries the method.
  That split is the case for the fusion step in Phase 4
- **several frames of one recipe**, numbered, where no single frame holds the
  whole list
- **text over a busy background**, low contrast, or mid-transition — the frames
  OCR will actually struggle with
- **a frame with no text at all**, so there's a fixture that should extract
  nothing rather than hallucinate a recipe

## Expected output for these

Fill in what a *person* can read off the frame, not what a model might guess. If
the frame shows "add cream" with no amount, the expected amount is `null`. An
extractor that invents `1 cup` there is wrong, and the eval should say so — that
is the failure mode most worth catching before it reaches a review screen.
