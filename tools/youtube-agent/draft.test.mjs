import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from './draft.mjs';
const draft = { version: 1, title: 'A song', description: '', tags: 'music, piano', audience: 'review', playlist: '', endScreen: '', visibility: 'private' };
test('draft preserves an undecided audience and normalizes tags', () => {
  const result = validateDraft(draft);
  assert.equal(result.audience, 'review');
  assert.deepEqual(result.parsedTags, ['music', 'piano']);
});
test('reject malformed drafts before opening a browser', () => {
  for (const invalid of [null, {}, { ...draft, title: '' }, { ...draft, title: 'x'.repeat(101) }, { ...draft, description: '<link>' }, { ...draft, audience: true }, { ...draft, visibility: 'scheduled' }, { ...draft, tags: 'a'.repeat(501) }]) {
    assert.throws(() => validateDraft(invalid));
  }
});
test('tag budget counts commas and quotes around phrases', () => {
  assert.throws(() => validateDraft({ ...draft, tags: `${'a'.repeat(496)},b c` }));
  assert.doesNotThrow(() => validateDraft({ ...draft, tags: 'a'.repeat(500) }));
});
