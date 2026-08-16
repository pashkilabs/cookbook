import type { FixtureSet } from "../types.js";
import {
  budgetbytes_pesto_pasta,
  pinchofyum_gochujang_noodles,
  bbcgoodfood_summer_traybake,
  recipetineats_mediterranean,
  recipetineats_chicken_breast,
  nytimes_tomato_jam,
  americastestkitchen_mismatch,
  smittenkitchen_chicken_salad,
  meallime_listing,
  tiktok_gordon_ramsay,
  instagram_post,
  reddit_grill_thread,
  caption_texas_twinkies,
  caption_summer_toast_board,
  caption_cinnamon_rolls,
  caption_sheet_pan_crunchwrap,
} from "./real.js";

/**
 * The fixture set: 8 recipe URLs, 4 refusals, 4 captions.
 *
 * The placeholders are gone — every fixture here is a real source with hand-checked output.
 * Thirteen captions and six reels are still to be written; see `intake/EXPECTED-CAPTIONS.md`.
 */
export const FIXTURES: FixtureSet = [
  budgetbytes_pesto_pasta,
  pinchofyum_gochujang_noodles,
  bbcgoodfood_summer_traybake,
  recipetineats_mediterranean,
  recipetineats_chicken_breast,
  nytimes_tomato_jam,
  americastestkitchen_mismatch,
  smittenkitchen_chicken_salad,
  meallime_listing,
  tiktok_gordon_ramsay,
  instagram_post,
  reddit_grill_thread,
  caption_texas_twinkies,
  caption_summer_toast_board,
  caption_cinnamon_rolls,
  caption_sheet_pan_crunchwrap,
];
