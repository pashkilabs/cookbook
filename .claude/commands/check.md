---
description: Typecheck and test the whole workspace, then report honestly
---

Run `pnpm check`.

If anything fails, work out whether the **code** is wrong or the **test
expectation** is wrong before changing either. Say which it was. Both happen,
and quietly "fixing" a test that was correctly failing is the worst outcome.

Report: what passed, what failed, what you changed and why.
