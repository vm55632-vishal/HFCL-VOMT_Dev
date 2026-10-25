import { likeEscape } from './cases.service';

// A single backslash is the escape character, so it is written as '\\' in these string literals.
describe('likeEscape (case search text must be literal)', () => {
  it('escapes the SQL LIKE wildcards', () => {
    expect(likeEscape('%')).toBe('\\%');
    expect(likeEscape('_')).toBe('\\_');
    expect(likeEscape('100%_done')).toBe('100\\%\\_done');
  });

  it('escapes the escape character itself', () => {
    expect(likeEscape('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary case references untouched', () => {
    expect(likeEscape('VOM-202610-0004')).toBe('VOM-202610-0004');
    expect(likeEscape('vom-2026')).toBe('vom-2026');
  });
});
