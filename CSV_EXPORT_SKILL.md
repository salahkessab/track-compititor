# CSV Export Skill

Goal: export a clean CSV that is ready for Facebook bulk posting.

## Rules
- Keep the export clean and directly usable by Facebook bulk-posting tools.
- Current columns: `media_url, message, post_type, comment`
  - `media_url` = the generated image URL
  - `message` = the caption
  - `post_type` = "photo"
  - `comment` = the first comment (only when the First Comment option is on)
- Quote/escape fields so captions with commas or newlines do not break rows.
- Do NOT add extra columns to this file: many Facebook importers reject unknown columns.
  Keep the posting CSV minimal and compatible.

## Bad example (avoid)
- Unescaped captions that contain commas, breaking the row layout.
- Adding `prompt`, `model`, `cost` columns to the posting CSV (can break FB import).

## Good example
- `"https://.../img.jpg","This Appaloosa... \n\nWhat name would you give this horse?","photo",""`

## Self-check
- Are all fields wrapped in quotes and internal quotes doubled?
- Is `post_type` "photo"?
- Does `comment` only contain the first comment when that option is on?
- Are there exactly the four expected columns?

## Where it is applied in code (WIRED)
- `app/page.tsx` -> `downloadCSV()` builds the header and rows with the `escape()` helper.
- The image bytes can be fetched via `app/api/download/route.ts` (Download images).

## Not yet wired (optional, doc-only suggestion)
- A SECOND "metadata" export (prompt, model, cost, seed) for your own records could be
  added as a separate button without touching the Facebook posting CSV.
