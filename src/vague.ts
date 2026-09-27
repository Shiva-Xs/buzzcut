// Subjects that say nothing about the change. Shared by the subject rule and the repo
// style profile (so `buzzcut context` never shows an agent a bad example to copy).
const VAGUE =
  /^(?:updates?|fix(?:es|ed)?|changes?|wip|misc|stuff|cleanup|clean ?up|refactor(?:ing)?|improvements?|tweaks?|minor(?: fix(?:es)?| changes?| updates?| tweaks?)?|small (?:fix(?:es)?|changes?)|(?:various|several|some) (?:fix(?:es)?|changes|improvements|updates)|update (?:the )?(?:files?|code|stuff|things|project|app)|fix(?:ed|es)? (?:the |a |some |all )?(?:bugs?|issues?|stuff|things?|problems?|errors?|it|this|that)|bug ?fix(?:es)?|quick ?fix|hot ?fix|final changes?|more changes|code changes|done|save|commit|summary|changes made|tests?|testing|temp|tmp|asdf|x+|\.+)\.?$/i;

// "Update webhook.ts", "Changed README.md": a verb plus a file name the diff already shows.
const FILE_ONLY = /^(?:update[sd]?|chang(?:e|es|ed)|modif(?:y|ies|ied)|edit(?:s|ed)?|touch(?:es|ed)?|fix(?:es|ed)?|tweak(?:s|ed)?)\s+[\w./-]+\.[A-Za-z0-9]{1,6}\.?$/i;

export function isVague(core: string): boolean {
  const s = core.trim();
  return VAGUE.test(s) || FILE_ONLY.test(s);
}
