export function validateDraft(draft) {
  if (!draft || draft.version !== 1) throw new Error('Expected a version 1 YouTube draft.');
  for (const key of ['title', 'description', 'tags', 'playlist', 'endScreen']) {
    if (typeof draft[key] !== 'string') throw new Error(`Missing text field: ${key}`);
  }
  if (!draft.title.trim() || draft.title.length > 100 || /[<>]/.test(draft.title)) throw new Error('Invalid title (1–100 characters, no angle brackets).');
  if (draft.description.length > 5000 || /[<>]/.test(draft.description)) throw new Error('Invalid description (up to 5000 characters, no angle brackets).');
  if (!['review', 'kids', 'general'].includes(draft.audience)) throw new Error('Invalid audience.');
  if (!['private', 'unlisted', 'public'].includes(draft.visibility)) throw new Error('Invalid visibility.');
  const tags = draft.tags.split(',').map(t => t.trim()).filter(Boolean);
  const tagLength = tags.reduce((sum, tag) => sum + tag.length + (tag.includes(' ') ? 2 : 0), Math.max(0, tags.length - 1));
  if (tagLength > 500) throw new Error('Tags exceed the 500 character budget.');
  return { ...draft, parsedTags: tags };
}
