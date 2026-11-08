# Horse Studio v2

## Local setup

Use Node.js 22 or later. Run `npm ci`, copy `.env.example` to `.env.local`,
set `OPENAI_API_KEY`, then run `npm run dev`. Keys remain on the server.
Set `APP_PASSWORD` to protect the UI and API when hosting the application.

OpenAI is the default image provider for horses, recipes and fashion. The default
image model is `gpt-image-2.5-sunburst`; the selector also offers
`gpt-image-2.6-sunburst`. Access depends on the configured OpenAI project.

## Recipes: Recipe Designs

Recipe Designs replaces the old Recipe generation panel in the Recipes area;
the existing recipe API remains available and Image to Image is unchanged. Upload
the original food photo, enter the exact title or select NO TEXT, and generate.
Optional design references and advanced settings are collapsed. Auto Research,
My Viral Reference, and Hybrid remain available; reference-only mode skips web
search by default. Research requests text and image results from the Responses
API's `web_search` tool. The app parses actual image-result URLs, fetches bounded
public thumbnails, and asks vision to describe accessible examples. The compact
Visual Inspiration panel shows source links, observations, dates and access
status. Pinterest platform guidance is separated from visual examples. No
engagement or virality is inferred. If image search isn't supported, the error
is shown without an automatic paid retry; if no visual examples can be
verified, the app says so. Research is cached for seven days on this device;
old text-only research is not reused as image research. Reference thumbnails
are used for read-only style analysis. Performance notes are user-reported and
unverified.

The original file and its SHA-256, saved settings, research cache, jobs, artwork,
and history stay in this browser's IndexedDB (not shared across devices). When
photo analysis is enabled, a reduced metadata-stripped copy is sent to OpenAI
vision. The decorative artwork endpoint receives text only; it never receives
the food photo or style-reference pixels. The app decodes and proportionally
scales the original, lays it onto the artwork locally, and verifies every pixel
in the protected region after independently decoding the 1200×1500 PNG. A
changed original or a failed comparison blocks export. The result uses literal
text instead of AI-rendered title lettering. Four locally rendered layout
families use installed, licensed typefaces (license texts are in
`public/font-licenses`). Decorative text and shapes are rendered with Fabric.js
(MIT; notice in `public/licenses/fabric.txt`), separately from the protected
photo. Saved designs include editable scene data and a design signature. Advanced
Edit adjusts font, placement, alignment, title size and colors locally, and
Redo Design switches layouts without making a provider request. Uploaded style
references produce a compact style analysis and can influence the chosen
family, typography and palette; their performance remains unverified.
Generated artwork is reduced to an abstract color
texture before compositing. Visual quality remains a separate owner review;
pixel verification alone does not certify the design.

An explicit confirmation is required in the UI before paid requests. The
displayed image-output figure is a partial estimate; text, vision, search, and
other provider charges are additional and the total is not a spending cap. A
device-local ledger records reported usage and marks incomplete or uncertain
outcomes. This repository has no shared persistent budget or cross-device job
service, so the ledger does not enforce a global monthly limit or reconcile
unknown charges. Check OpenAI billing before repeating an uncertain request.
Paid requests are not automatically retried. A device-local reservation stops
another paid design from starting across tabs; after an interrupted request it
must be cleared explicitly after checking billing. This does not synchronize
across devices or cancel a request that has already reached OpenAI.
Template Preview, Redo Design,
and the optional separate Ingredients Card run locally without an OpenAI call.
Browser storage can be cleared by the user/browser and should not be treated as
a backup. Set `APP_PASSWORD` when hosting to protect the application and APIs.

The image, analysis and search integrations are covered by mocked tests. A live
test requires the owner's explicit paid approval and an original food photo.
Model access depends on the configured OpenAI account. Relevant API docs:
https://developers.openai.com/api/docs/guides/tools-web-search and
https://developers.openai.com/api/docs/guides/images-vision.

## Recipes: Image to Image

Open Recipes, then Image to Image, and upload one JPG, PNG, or WebP food photo.
Optional extra instructions are appended to the fixed server-side prompt. The
photo and prompt go directly to OpenAI image edits: no recipe seed, caption
planner, design template, or prompt rewriting is used. The prompt asks to
preserve the food, portions and imperfections while replacing the dishware,
surface and visible utensil finish with an authentic smartphone-photo look.

This workspace has independent settings, retained while switching tabs:
`gpt-image-2.6-sunburst`, portrait 1024×1536, high quality, default complexity,
one image, PNG, opaque background, auto moderation, and no partial previews.
Complexity Default omits the API field; Low, Medium and High are explicit
choices for 2.6. Each requested variation edits the original reference.
The default model in the other workspaces is unchanged.

Large uploads are resized without cropping to fit the request-body limit.
Failed generations are not retried automatically. Completed images remain
downloadable if a later variation fails. Download before refreshing; results
are held in browser memory. Tests mock the provider and incur no API charges.
Live output fidelity and model access depend on the configured OpenAI project.

API reference: https://developers.openai.com/api/reference/resources/images/methods/edit

## Image generation settings

Image controls include square/portrait/landscape/auto size, quality, PNG/JPEG/WebP,
background, moderation and zero to three streamed previews. Extra high (`xhigh`)
and Max quality require a 2.5 model. Transparent output requires PNG or WebP.
The existing image count creates separate posts, one provider image per request.
Reference images use OpenAI image edits when an OpenAI model is selected.
Designed recipes use image generation; model labels no longer imply an edit call.
OpenAI prompts describe the intended medium, composition, subject and constraints.
For horse-pair batches, the app rotates eight scene directions through different
interactions, settings and light. Explicit custom subjects and uploaded references
take precedence; the selected camera framing remains in effect. Other batches vary
their visual direction while preserving the requested scene. The image model can
still produce similar images, particularly when the same reference is reused.
Show prompt and JSON export include the final prompt sent to the image model.

OpenAI-only installations receive image data directly and support viewing,
downloading and JSON export. Optional `FAL_KEY` enables existing fal models and
uploads completed OpenAI images to fal storage for public image URLs. Posting CSV
requires those hosted URLs; embedded base64 is not exported as a media URL.
If hosting fails, the generated image remains downloadable. Download images/JSON
before refreshing: the existing application keeps batches in browser memory.

OpenAI image charges depend on model, size, quality and usage. The app explicitly
labels its recorded text estimate and does not invent fixed image costs.
Generation requests are not automatically retried by the browser or image client.
Server generation allows up to 300 seconds; the image request times out at 240
seconds. Deployment plan/proxy limits can be lower; use the local app or suitable
hosting limits for slow/high-quality generations.

## Checks

`npm test` runs offline mocked API tests for models, validation, request settings,
reference edits, streamed previews, error handling and client stream parsing.
`npm run build` validates the production build and TypeScript.
Tests never call paid image services. Live model access and output quality require
testing with your own configured key.

## API references

- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.openai.com/api/reference/resources/images/methods/edit
- https://developers.openai.com/api/docs/guides/image-generation

The older skill documents describe previous behavior in places. For current
OpenAI integration details, use this README and `lib/openaiImageSettings.ts`.
