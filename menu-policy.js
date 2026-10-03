const BOOK_ACTIONS = new Set(['export', 'emailDraft', 'stats', 'detachOutline', 'searchBook', 'find']);
const MANUSCRIPT_ACTIONS = new Set(['bodyFont', 'bodyFontPick', 'dropCap', 'fontSize', 'typewriter', 'focus', 'focusCycle', 'pageTheme']);
function menuActionEnabled(type, state = {}, workspaceFocused = true) {
  if (!state.ready) return false;
  if (['help', 'about', 'checkUpdate'].includes(type)) return !state.modal;
  if (!workspaceFocused || state.modal) return false;
  if (BOOK_ACTIONS.has(type)) return !!state.book;
  if (MANUSCRIPT_ACTIONS.has(type)) return !!state.manuscript;
  if (type === 'align') return !!state.selection;
  if (type === 'poetry') return !!state.manuscriptSelection;
  if (type === 'spellcheck') return !!state.spellcheck;
  return true;
}
module.exports = { menuActionEnabled };
