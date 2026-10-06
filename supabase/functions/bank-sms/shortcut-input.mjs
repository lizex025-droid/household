const MESSAGE_KEYS = ['content', 'text', 'message', 'body'];

// iOS Shortcuts normally sends the selected Message.Content as a string. Some
// versions serialize the selected Message value as a one-item list/dictionary,
// so unwrap only well-known message fields and reject ambiguous structures.
export function extractShortcutText(value) {
  const seen = new Set();

  const visit = (candidate, depth) => {
    if (typeof candidate === 'string') return candidate;
    if (depth > 3 || candidate === null || typeof candidate !== 'object' || seen.has(candidate)) return null;
    seen.add(candidate);

    if (Array.isArray(candidate)) return candidate.length === 1 ? visit(candidate[0], depth + 1) : null;

    const entries = Object.entries(candidate);
    for (const wanted of MESSAGE_KEYS) {
      const match = entries.find(([key]) => key.toLowerCase() === wanted);
      if (!match) continue;
      const text = visit(match[1], depth + 1);
      if (text !== null) return text;
    }
    return null;
  };

  const text = visit(value, 0);
  if (text === null) throw new Error('اختر Content من متغير Shortcut Input في حقل text.');
  return text;
}
