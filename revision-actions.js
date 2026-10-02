((root, factory) => {
  const actions = factory();
  if (typeof module === 'object' && module.exports) module.exports = actions;
  else root.RevisionActions = actions;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => Object.freeze([
  { id: 'rewrite', name: 'Rewrite', instructions: 'Rewrite the selected passage with fresh wording and improved flow. Preserve its meaning, events, character details, point of view, tense, and the author’s voice. Keep approximately the same length.' },
  { id: 'expand', name: 'Expand', instructions: 'Expand the selected passage in a way suited to its type. For prose, add purposeful sensory detail, action, dialogue, or interiority. For outlines and reference notes, develop the existing ideas with useful detail. Preserve its facts, events, character details, point of view, tense, and voice. Avoid padding and unsupported changes to the story.' },
  { id: 'shorten', name: 'Shorten', instructions: 'Shorten the selected passage by removing repetition and tightening language. Retain its essential meaning, events, character details, point of view, tense, and voice.' },
  { id: 'custom', name: 'Custom instruction', instructions: 'Revise the selected passage according to the author’s additional instruction. Preserve the author’s voice and all story facts, point of view, and tense unless the author asks to change them.' }
]));
