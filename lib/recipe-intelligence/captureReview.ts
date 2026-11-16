import { load } from 'cheerio';

export function captureWarnings(input: Record<string, unknown>, html: string): string[] {
  const $ = load(html), title = $('title').text().trim(), body = $('body').text().replace(/\s+/g, ' ').trim();
  const substantive = $('article p,main p').length >= 3 && $('article,main').first().text().length > 500;
  if (!substantive && ($('#challenge-form,#cf-challenge-running,#cf-challenge-error,.cf-browser-verification,#px-captcha').length ||
      /^(just a moment|attention required|access denied|security check|verify (?:you|that)|checking your browser|robot or human)/i.test(title) &&
      (body.length < 1000 || /verify (?:that )?you(?: are|'re) human|checking your browser|enable javascript and cookies to continue|sorry, you have been blocked/i.test(body)))) {
    throw new Error('This is a website verification page, not an article. Complete verification in the original Chrome tab, then capture the article again.');
  }
  const report = input.captureReport;
  if (report === undefined) return [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Invalid capture report.');
  const flags = report as Record<string, unknown>;
  for (const field of ['textTruncated','imageLimitReached','loadingIncomplete']) if (flags[field] !== undefined && typeof flags[field] !== 'boolean') throw new Error('Invalid capture report.');
  return [
    ...(flags.textTruncated ? ['Captured article text was truncated. Review the source before generation.'] : []),
    ...(flags.imageLimitReached ? ['Photo discovery reached its safety limit. This import may not include every article photo.'] : []),
    ...(flags.loadingIncomplete ? ['Automatic page loading reached its time or length limit. More content may still be unloaded.'] : []),
  ];
}

export function captureFinishNotes(input: Record<string, unknown>): string[] {
  const missing = Number(input.missingPhotos ?? 0), derived = Number(input.derivedPhotos ?? 0);
  if (!Number.isSafeInteger(missing) || missing < 0 || missing > 80 || !Number.isSafeInteger(derived) || derived < 0 || derived > 80) throw new Error('Invalid capture photo count.');
  if (missing && input.acceptPartial !== true) throw new Error('Some selected photos are missing. Retry them in the extension, or explicitly choose Continue with saved photos.');
  return [
    ...(missing ? [`${missing} selected source photographs could not be imported from Chrome. You chose to continue without them.`] : []),
    ...(derived ? [`${derived} reference photographs are converted or displayed copies, not the original downloaded image files.`] : []),
  ];
}
