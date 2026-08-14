/**
 * The bucket recipe photographs live in.
 *
 * Its own module, deliberately. It used to live in `photo-storage.ts`, which imports **sharp** —
 * so a route that wanted nothing but this string pulled a native image library into its bundle,
 * and on Vercel's linux runtime that made the whole route fail to load. A constant should not be
 * able to do that.
 */
export const RECIPE_PHOTO_BUCKET = "recipe-photos";
