export function durationLabel(value: string): string {
  const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!iso) return value;
  const parts = ["day", "hour", "minute", "second"].flatMap((unit, i) => iso[i + 1] ? [`${iso[i + 1]} ${unit}${Number(iso[i + 1]) === 1 ? "" : "s"}`] : []);
  return parts.join(" ") || value;
}
