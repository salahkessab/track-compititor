# Horse scene review

Reviewed against the 30 scene-focus options shown in the application. The seed,
text planner, random framing and final OpenAI image prompt were checked. Scene
constraints are defined in `lib/horseSceneGuidance.ts` and passed to both the
planner and image renderer. The model's output is probabilistic: prompts cannot
guarantee breed fidelity, anatomy, visible subject count or variety.

| Scene focus | Intended image and review |
| --- | --- |
| Mare & foal | Smaller foal with an adult mare and a believable maternal bond; random framing accommodates both. |
| Couples | Two adult horses; batch directions rotate setting, interaction and lighting. |
| Horse friendship | Two adult horses with natural friendly body language; pair directions rotate. |
| Black & white pair | Two adult horses, one black and one white; pair directions rotate. |
| Black horse (Friesian) | Black Friesian only; removed non-Friesian choices from the subject pool. |
| White horse | One white horse, with natural light coat detail. |
| Appaloosa | One Appaloosa with a recognizable spotted coat; the seed rotates coat patterns. |
| Arabian | One Arabian with a refined head and recognizable proportions. |
| Andalusian (grey) | One grey Andalusian with a full mane. |
| Palomino | One golden palomino with a flaxen mane and tail. |
| Paint horse | One American Paint horse with distinct contrasting coat patches. |
| Buckskin | One buckskin with a tan or golden body and black points. |
| Chestnut | One horse with a natural reddish-brown coat. |
| Haflinger | One golden-chestnut Haflinger with flaxen mane and tail. |
| Mustang | One naturally weathered, free-roaming mustang in open country. |
| Running horse | One horse with believable forward movement; random framing shows the body. |
| Dusty ranch run | Running horse in a dusty ranch environment; random framing shows the movement. |
| Golden hour | Horse in warm, low golden-hour light. |
| Snow horse | Horse in a recognizable snowy winter setting. |
| Close-up eye | One equine eye with lashes and surrounding coat; random framing is eye macro. |
| Big nose close-up | Curious horse with its muzzle prominent; random framing is close-up. |
| Peeking from barn | Curious horse peeking from a recognizable barn or stall; random framing retains context. |
| Barn scene | Horse in or beside a recognizable barn; random framing retains context. |
| Desert buttes | Horse with desert buttes or mesas visible; random framing retains the landscape. |
| Giant horse mural | A painted mural several times taller than the artist. Removed earlier instructions requiring a small mural. |
| Dreamy / greeting | Decorative horse art with a gentle greeting-card mood, without unwanted text. |
| Art / blessing | Peaceful decorative horse art with a warm blessing-like mood. |
| Fantasy / floral | Decorative fantasy horse art with floral framing and a soft atmosphere. |
| Funny / playful | Believable playful horse behavior and natural anatomy. |
| Western / ranch | Believable American western or ranch scene with appropriate setting and tack. |

## Precedence and limits

- Uploaded references drive horse scenes and override the scene-focus chips, as
  the existing interface explains. A custom subject also takes precedence.
- For photographic scenes, random framing is adjusted for the scene; an
  explicitly chosen framing is honored and can conflict with a scene. The three
  decorative art scenes use their own composition instead of the camera control.
- The eight pair directions repeat after eight images; other scenes combine seed
  variation with general visual directions. Similar images can still occur.
- Descriptions are planned before the image is rendered. They can mismatch the
  actual generated image; checking the result remains necessary.
- Reference analysis and the legacy fal renderer have fallback paths. The app
  does not currently verify generated anatomy or spelling against the image.
- Local tests use mocked providers. They verify request construction, not the
  quality of actual images or model availability in a particular OpenAI account.

## Verification

Automated tests enumerate every visible scene option and all six configured
OpenAI image models. They exercise the actual route with mocked providers and
check that scene guidance reaches both the planner and the final image request.
They also cover scene-aware random framing, Friesian and foal seeds, giant mural
instructions, and precedence for references and custom subjects.
