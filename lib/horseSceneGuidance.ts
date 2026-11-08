// Scene focus is an allowlist, not an arbitrary user-supplied prompt.
export const HORSE_SCENE_GUIDANCE: Record<string, string> = {
  foal: "A mare with her visibly smaller foal; show their gentle maternal bond and age-appropriate anatomy.",
  couple: "Exactly two adult horses sharing a natural moment of companionship.",
  friendship: "Exactly two adult horses showing relaxed, believable friendship through their body language.",
  blackwhite: "Exactly two adult horses: one black and one white, with the two distinct coats clearly recognizable where the crop allows.",
  black: "One black Friesian horse, with the characteristic strong build, abundant mane and feathering where visible.",
  white: "One white horse with a naturally light coat, realistic texture and natural proportions.",
  appaloosa: "One Appaloosa with a naturally patterned coat, recognizable markings where visible, and realistic equine anatomy.",
  arabian: "One Arabian horse, with a refined head and characteristic breed proportions.",
  andalusian: "One grey Andalusian with a strong graceful build and a full natural mane.",
  palomino: "One palomino horse with a golden coat and a pale flaxen mane and tail where visible.",
  paint: "One American Paint horse with recognizable contrasting coat patches where visible.",
  buckskin: "One buckskin horse with a tan or golden coat and black mane, tail and lower legs when visible.",
  chestnut: "One chestnut horse with a natural reddish-brown coat, mane and tail.",
  haflinger: "One Haflinger with a golden-chestnut coat and pale flaxen mane and tail.",
  mustang: "One free-roaming mustang with a naturally weathered coat and a believable open-country setting.",
  running: "One horse in believable forward running motion; the pose and camera framing should convey movement.",
  dusty_run: "One horse moving through a dusty ranch setting, with natural dust from the hooves and believable motion.",
  golden_hour: "A horse in warm, low golden-hour sunlight with natural highlights and shadows.",
  snow: "A horse in a snowy winter setting, with believable snow, cold light and winter details.",
  eye: "An extreme close-up of one horse eye, showing the eye, lashes and fine surrounding coat; avoid a full-body or wide shot.",
  big_nose: "A curious horse investigating the camera, with its muzzle prominent in a playful close-up.",
  barn_peek: "A curious horse peeking from a barn doorway, window or stall, with the barn context visible.",
  barn: "A horse in or beside a recognizable rustic barn, with believable barn details and natural light.",
  buttes: "A horse in a desert landscape with recognizable sandstone buttes or mesas in the background.",
  mural: "A giant hand-painted horse mural on a large wall; show a much smaller human artist for scale when the crop allows. The horse is flat painted artwork, not a living horse.",
  dreamy_greeting: "Decorative, dreamy horse artwork with a gentle greeting-card mood and no words unless explicitly requested.",
  art_blessing: "Peaceful, tender decorative horse artwork with a warm blessing-like mood and no words unless explicitly requested.",
  fantasy_floral: "Decorative fantasy horse artwork with graceful floral framing and a soft romantic atmosphere.",
  funny: "A real horse caught in a believable playful or curious moment, with natural animal anatomy.",
  western: "A believable horse scene grounded in American western or ranch life, with appropriate environment and tack if present.",
  horse_human_bond: "One adult horse and one adult person sharing a relaxed, believable moment of trust. Show their interaction and natural human hands and horse anatomy where the crop allows; keep the horse calm and the body language unforced.",
  river_crossing: "One horse crossing shallow moving water with a natural, balanced stance. Show believable water and restrained ripples or droplets around the lower legs where visible, with natural reflections and accurate anatomy; let the chosen crop and background determine what is visible.",
  appaloosa_wildflowers: "One Appaloosa in a natural wildflower meadow. Preserve its distinctive, believable spotted or blanket coat pattern where visible; use real flowers as part of the landscape, with natural proportions and light.",
  black_horse_rain: "One black horse outdoors in gentle rain. Keep detail in its dark coat, with naturally damp hair and mane, subtle raindrops where visible, and soft light that suits the weather.",
  horse_wall_painting: "A finished horse painting made directly on a textured wall, with visible brushwork and pigment. The horse is flat painted artwork; show the surrounding wall where the crop and background allow, without assuming a giant scale or an artist.",
  beach_running: "One horse running along a natural beach, with an anatomically believable stride and mane movement. Show sand or shallow surf reacting to visible hooves and preserve the selected framing.",
};

export function isHorseWallPaintingSceneType(sceneType?: string): boolean {
  return /horse wall painting scene/i.test(sceneType ?? "");
}

// Explicit camera controls win when requested details cannot fit in the crop.
export function horseSceneGuidance(mode: string, framing?: string): string | undefined {
  const guidance = HORSE_SCENE_GUIDANCE[mode];
  if (!guidance) return undefined;
  if (framing === "eye" && ["foal", "couple", "friendship", "blackwhite", "horse_human_bond", "river_crossing"].includes(mode)) {
    return `The underlying scene is ${guidance} For this eye macro, show only one horse eye and surrounding coat; any other subjects are outside the crop.`;
  }
  if (mode === "eye" && framing && !["eye", "random"].includes(framing)) {
    return "One horse with a natural, expressive eye where visible; use the selected camera framing rather than forcing an eye macro.";
  }
  if (mode === "big_nose" && framing && ["half", "full", "wide"].includes(framing)) {
    return "A curious horse investigating the camera with a natural muzzle, shown in the selected camera framing.";
  }
  return guidance;
}

// Used only for the Random framing setting. An explicitly chosen framing remains
// the user's choice, including when a scene naturally suggests a different crop.
export function randomFramingsForHorseScene(mode: string, pool: readonly string[]): string[] {
  const allowed: Record<string, readonly string[]> = {
    eye: ["eye"], big_nose: ["closeup"],
    barn_peek: ["portrait", "half", "full", "wide"],
    barn: ["half", "full", "wide"], buttes: ["full", "wide"],
    mural: ["full", "wide"], running: ["full", "wide"], dusty_run: ["full", "wide"],
    couple: ["portrait", "half", "full", "wide"], blackwhite: ["portrait", "half", "full", "wide"],
    friendship: ["portrait", "half", "full", "wide"], foal: ["portrait", "half", "full", "wide"],
    horse_human_bond: ["half", "full", "wide"], river_crossing: ["full", "wide"],
    appaloosa_wildflowers: ["half", "full", "wide"], black_horse_rain: ["portrait", "half", "full", "wide"],
    horse_wall_painting: ["full", "wide"], beach_running: ["full", "wide"],
  };
  const permitted = allowed[mode];
  return permitted ? pool.filter((value) => permitted.includes(value)) : [...pool];
}
