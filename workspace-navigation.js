// Navigation preferences belong to this device, not to a manuscript on a NAS.
const workspaceView = document.querySelector('#editor-view');
document.querySelectorAll('.open-app-settings').forEach(button => {
  button.onclick = () => window.neo.openSettings().catch(() => toast('Could not open Settings.'));
});
const workspaceSections = {
  characters: {
    title: 'Characters',
    description: 'Keep the people in your story, their relationships, and their development together.',
    topics: [
      ['Profiles', 'Identity, appearance, background, and voice.'],
      ['Relationships', 'Connections, loyalties, and conflicts between characters.'],
      ['Character arcs', 'Motivations, turning points, and change across the story.']
    ]
  },
  locations: {
    title: 'Locations',
    description: 'Build a reference for the places where your story happens.',
    topics: [
      ['Places', 'From a single room to a city or region.'],
      ['Atmosphere', 'Sensory details, mood, and the features that make a place distinct.'],
      ['Scene connections', 'The characters and events associated with each location.']
    ]
  },
  worldbuilding: {
    title: 'Worldbuilding',
    description: 'Keep the history, cultures, and rules of your story world consistent.',
    topics: [
      ['History & culture', 'Events, traditions, beliefs, and everyday life.'],
      ['Groups & organizations', 'Communities, institutions, factions, and their influence.'],
      ['World rules', 'The technology, magic, and constraints that shape the story.']
    ]
  },
  research: {
    title: 'Research',
    description: 'Gather the sources and reference material that support your writing.',
    topics: [
      ['Sources', 'Articles, links, documents, and other reference material.'],
      ['Research notes', 'Useful findings and the sources behind them.'],
      ['Open questions', 'Details to check and topics to explore further.']
    ]
  },
  'ai-assistance': {
    title: 'AI Assistance',
    description: 'A place to work with AI alongside your manuscript and story references.',
    topics: [
      ['Conversation', 'Discuss ideas, develop scenes, and review your writing.'],
      ['Book context', 'Choose the passages and references included in a request.'],
      ['Suggested changes', 'Review proposed edits before applying them to your book.']
    ]
  }
};
function showWorkspaceSection(name) {
  if (window.neoChatView) {
    const node = workspaceSelection?.bookId === book?.id && workspaceSelection.section === name
      ? WorkspaceTree.find(book.workspaceTree[name], workspaceSelection.id)?.node : null;
    const chatRoot = (name === 'ai-assistance' && !workspaceSelection) || node?.type === 'chat';
    window.neoChatView.root.hidden = !chatRoot;
    if (chatRoot) {
      treeEditor.hidden = true;
      document.querySelector('#workspace-section').hidden = true;
      publishPaneState();
      if (node?.type === 'chat') openWorkspaceChat(name, node);
      else window.neoChatView.showBook(book.id, book.title);
      return true;
    }
  }
  if (typeof showWorkspaceTreeSection === 'function' && showWorkspaceTreeSection(name)) return true;
  const section = workspaceSections[name];
  const panel = document.querySelector('#workspace-section');
  panel.hidden = !section;
  if (!section) return false;
  document.querySelector('#workspace-section-title').textContent = section.title;
  document.querySelector('#workspace-section-description').textContent = section.description;
  const topics = document.querySelector('#workspace-section-topics');
  topics.replaceChildren();
  for (const [title, description] of section.topics) {
    const card = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = title;
    const text = document.createElement('p');
    text.textContent = description;
    card.append(heading, text);
    topics.append(card);
  }
  return true;
}
let navigationPreferences = {};
try { navigationPreferences = JSON.parse(localStorage.getItem('neo-ai-navigation')) || {}; } catch (_) {}
let navigationWidth = Number(navigationPreferences.width) || 264;
function saveNavigationPreferences() {
  try { localStorage.setItem('neo-ai-navigation', JSON.stringify(navigationPreferences)); } catch (_) {}
}
function setNavigationWidth(width, persist = false) {
  navigationWidth = Math.round(Math.max(220, Math.min(380, Number(width) || 264)));
  workspaceView.style.setProperty('--navigation-width', navigationWidth + 'px');
  document.querySelector('#workspace-resizer').setAttribute('aria-valuenow', navigationWidth);
  if (persist) { navigationPreferences.width = navigationWidth; saveNavigationPreferences(); }
}
function setNavigationCollapsed(collapsed) {
  workspaceView.classList.toggle('nav-collapsed', collapsed);
  const toggle = document.querySelector('#workspace-nav-toggle');
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.title = collapsed ? 'Show navigation' : 'Hide navigation';
  toggle.setAttribute('aria-label', toggle.title);
  navigationPreferences.collapsed = collapsed;
  saveNavigationPreferences();
}
function updateWorkspaceNavigation() {
  if (!book) return;
  document.querySelector('#workspace-book-title').textContent = book.title || t('Untitled');
  document.querySelectorAll('#tabs .tab').forEach((tab) => {
    if (tab.dataset.tab === currentTab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  const active = document.querySelector('#tabs .tab.active');
  document.querySelector('#workspace-section-label').textContent = active?.textContent || 'Manuscript';
  document.querySelector('#workspace-section-label').title = active?.textContent || 'Manuscript';
  if (typeof updateWorkspaceBreadcrumb === 'function') updateWorkspaceBreadcrumb();
}
setNavigationWidth(navigationWidth);
setNavigationCollapsed(!!navigationPreferences.collapsed);
document.querySelector('#workspace-nav-toggle').onclick = () => {
  setNavigationCollapsed(!workspaceView.classList.contains('nav-collapsed'));
};
const navigationResizer = document.querySelector('#workspace-resizer');
navigationResizer.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  navigationResizer.setPointerCapture(event.pointerId);
});
navigationResizer.addEventListener('pointermove', (event) => {
  if (navigationResizer.hasPointerCapture(event.pointerId)) setNavigationWidth(event.clientX);
});
navigationResizer.addEventListener('pointerup', (event) => {
  if (!navigationResizer.hasPointerCapture(event.pointerId)) return;
  navigationResizer.releasePointerCapture(event.pointerId);
  setNavigationWidth(navigationWidth, true);
});
navigationResizer.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const width = event.key === 'Home' ? 220 : event.key === 'End' ? 380 : navigationWidth + (event.key === 'ArrowLeft' ? -10 : 10);
  setNavigationWidth(width, true);
});
document.querySelector('#workspace-outline-window').onclick = () => detachOutline();
window.neo.onPaneState(({ detached }) => {
  const isDetached = detached.includes('outline');
  document.querySelector('#workspace-outline-status').hidden = !isDetached;
  const button = document.querySelector('#workspace-outline-window');
  button.title = isDetached ? 'Show outline window' : 'Open outline in separate window';
  button.setAttribute('aria-label', button.title);
});
const commentsToggle = document.querySelector('#workspace-comments-toggle');
commentsToggle.onclick = () => {
  document.querySelector('#side-pin').click();
  if (!workspaceView.classList.contains('side-pinned')) document.querySelector('#side-pane').classList.remove('open');
};
new MutationObserver(() => {
  commentsToggle.setAttribute('aria-pressed', String(workspaceView.classList.contains('side-pinned')));
}).observe(workspaceView, { attributes: true, attributeFilter: ['class'] });
