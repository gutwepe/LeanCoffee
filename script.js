const STORAGE_KEY = 'lean-coffee-state-v1';
const VOTE_KEY = 'lean-coffee-votes-v1';
const DEFAULT_TIMER = 5 * 60; // seconds
const MAX_COFFEE_ICONS = 5;

const topicTemplate = document.getElementById('topicTemplate');
const todoColumn = document.getElementById('todoColumn');
const doingColumn = document.getElementById('doingColumn');
const doneColumn = document.getElementById('doneColumn');
const topicForm = document.getElementById('topicForm');
const votesRemainingEl = document.getElementById('votesRemaining');
const voteBudgetInput = document.getElementById('voteBudget');
const resetButton = document.getElementById('resetSession');
const exportButton = document.getElementById('exportSession');
const timerDisplay = document.getElementById('timerDisplay');
const startTimerBtn = document.getElementById('startTimer');
const pauseTimerBtn = document.getElementById('pauseTimer');
const resetTimerBtn = document.getElementById('resetTimer');
const extendTimerBtn = document.getElementById('extendTimer');
const activeTopicPanel = document.getElementById('activeTopicPanel');
const timeboxSelect = document.getElementById('timeboxLength');
const timeboxDialog = document.getElementById('timeboxDialog');
const extendDiscussionBtn = document.getElementById('extendDiscussion');
const moveOnBtn = document.getElementById('moveOn');

let timerInterval = null;

const state = loadState();
const votingState = loadVotingState();

init();

function init() {
  voteBudgetInput.value = votingState.limit;
  updateVotesRemaining();
  renderBoard();

  topicForm.addEventListener('submit', handleTopicSubmit);
  voteBudgetInput.addEventListener('change', handleBudgetChange);
  resetButton.addEventListener('click', resetSession);
  exportButton.addEventListener('click', exportSession);

  startTimerBtn.addEventListener('click', startTimer);
  pauseTimerBtn.addEventListener('click', pauseTimer);
  resetTimerBtn.addEventListener('click', () => resetTimer());
  extendTimerBtn.addEventListener('click', () => extendTimer(120));
  if (timeboxSelect) {
    timeboxSelect.addEventListener('change', handleTimeboxChange);
  }
  extendDiscussionBtn.addEventListener('click', () => {
    extendTimer(120);
    timeboxDialog.close();
    startTimer();
  });
  moveOnBtn.addEventListener('click', () => {
    timeboxDialog.close();
    completeActiveTopic();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && timerInterval) {
      pauseTimer();
    }
  });

  updateTimerUI();
  syncTimeboxSelect();
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        topics: parsed.topics ?? [],
        activeTopicId: parsed.activeTopicId ?? null,
        timerRemaining: parsed.timerRemaining ?? DEFAULT_TIMER,
        timerDefault: parsed.timerDefault ?? DEFAULT_TIMER
      };
    }
  } catch (error) {
    console.warn('Unable to load saved state', error);
  }
  return {
    topics: [],
    activeTopicId: null,
    timerRemaining: DEFAULT_TIMER,
    timerDefault: DEFAULT_TIMER
  };
}

function loadVotingState() {
  try {
    const stored = localStorage.getItem(VOTE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        limit: parsed.limit ?? 5,
        used: parsed.used ?? 0,
        topics: parsed.topics ?? {}
      };
    }
  } catch (error) {
    console.warn('Unable to load voting state', error);
  }
  return {
    limit: 5,
    used: 0,
    topics: {}
  };
}

function persistState() {
  const data = {
    topics: state.topics,
    activeTopicId: state.activeTopicId,
    timerRemaining: state.timerRemaining,
    timerDefault: state.timerDefault
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Unable to save board state', error);
  }
}

function persistVotingState() {
  try {
    localStorage.setItem(VOTE_KEY, JSON.stringify(votingState));
  } catch (error) {
    console.warn('Unable to save voting state', error);
  }
}

function handleTopicSubmit(event) {
  event.preventDefault();
  const formData = new FormData(topicForm);
  const title = formData.get('title').trim();
  const description = formData.get('description').trim();

  if (!title) return;

  const topic = {
    id: createId(),
    title,
    description,
    votes: 0,
    status: 'todo',
    createdAt: new Date().toISOString(),
    notes: ''
  };

  state.topics.push(topic);
  persistState();
  topicForm.reset();
  renderBoard();
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `topic-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function handleBudgetChange() {
  const value = parseInt(voteBudgetInput.value, 10);
  if (Number.isNaN(value) || value < 1) {
    voteBudgetInput.value = votingState.limit;
    return;
  }
  votingState.limit = Math.min(Math.max(value, 1), 20);
  if (votingState.used > votingState.limit) {
    votingState.used = Object.values(votingState.topics).filter(Boolean).length;
  }
  persistVotingState();
  updateVotesRemaining();
}

function resetSession() {
  if (!confirm('Reset the session? All topics, votes, and notes will be removed.')) {
    return;
  }
  state.topics = [];
  state.activeTopicId = null;
  state.timerRemaining = state.timerDefault = DEFAULT_TIMER;
  votingState.used = 0;
  votingState.topics = {};
  persistState();
  persistVotingState();
  stopTimer();
  renderBoard();
  updateTimerUI();
  syncTimeboxSelect();
  updateVotesRemaining();
}

function exportSession() {
  if (!state.topics.length) {
    alert('No topics to export yet.');
    return;
  }
  const lines = ['# Lean Coffee Summary', '', `Generated: ${new Date().toLocaleString()}`, ''];
  const sections = {
    todo: ['## To Discuss', ''],
    doing: ['## Discussing', ''],
    done: ['## Discussed', '']
  };

  for (const topic of state.topics) {
    const section = sections[topic.status];
    section.push(`- **${topic.title}** (${topic.votes} votes)`);
    if (topic.description) {
      section.push(`  - Context: ${topic.description}`);
    }
    if (topic.notes) {
      section.push(`  - Notes: ${topic.notes}`);
    }
  }

  const content = lines
    .concat(sections.todo, '', sections.doing, '', sections.done)
    .join('\n');

  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lean-coffee-${Date.now()}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function updateVotesRemaining() {
  const remaining = Math.max(votingState.limit - votingState.used, 0);
  votesRemainingEl.textContent = remaining;
}

function renderBoard() {
  const topicsByStatus = {
    todo: [],
    doing: [],
    done: []
  };

  for (const topic of state.topics) {
    topicsByStatus[topic.status].push(topic);
  }

  topicsByStatus.todo.sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  topicsByStatus.doing.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  topicsByStatus.done.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  populateColumn(todoColumn, topicsByStatus.todo);
  populateColumn(doingColumn, topicsByStatus.doing);
  populateColumn(doneColumn, topicsByStatus.done);

  const activeTopic = state.topics.find((topic) => topic.id === state.activeTopicId && topic.status === 'doing');
  if (!activeTopic && topicsByStatus.doing[0]) {
    state.activeTopicId = topicsByStatus.doing[0].id;
    persistState();
  }

  updateTimerUI();
}

function renderCoffeeStack(container, votes) {
  container.innerHTML = '';
  container.dataset.count = String(votes);

  if (votes <= 0) {
    container.classList.add('is-empty');
    container.append(createCoffeeIcon());
    return;
  }

  container.classList.remove('is-empty');
  const iconCount = Math.min(votes, MAX_COFFEE_ICONS);

  for (let i = 0; i < iconCount; i += 1) {
    container.append(createCoffeeIcon());
  }

  if (votes > MAX_COFFEE_ICONS) {
    const overflow = document.createElement('span');
    overflow.className = 'coffee-overflow';
    overflow.textContent = `+${votes - MAX_COFFEE_ICONS}`;
    container.append(overflow);
  }
}

function createCoffeeIcon() {
  const icon = document.createElement('span');
  icon.className = 'coffee-icon';
  icon.textContent = '☕';
  return icon;
}

function populateColumn(column, topics) {
  column.innerHTML = '';
  if (!topics.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = getEmptyMessage(column.id);
    column.append(empty);
    return;
  }

  for (const topic of topics) {
    const card = topicTemplate.content.firstElementChild.cloneNode(true);
    const titleEl = card.querySelector('.topic-title');
    const descriptionEl = card.querySelector('.topic-description');
    const metaEl = card.querySelector('.topic-meta');
    const voteBtn = card.querySelector('.vote-btn');
    const voteCount = card.querySelector('.vote-count');
    const coffeeStack = card.querySelector('.coffee-stack');
    const voteLabel = card.querySelector('.vote-label');
    const notesInput = card.querySelector('.notes-input');
    const saveNotesBtn = card.querySelector('.save-notes');
    const actions = card.querySelector('.topic-actions');

    titleEl.textContent = topic.title;
    if (topic.description) {
      descriptionEl.textContent = topic.description;
      descriptionEl.hidden = false;
    } else {
      descriptionEl.textContent = '';
      descriptionEl.hidden = true;
    }
    metaEl.textContent = `${topic.votes} vote${topic.votes === 1 ? '' : 's'} • Added ${formatRelativeDate(topic.createdAt)}`;
    voteCount.textContent = `${topic.votes} ${topic.votes === 1 ? 'vote' : 'votes'}`;
    voteCount.setAttribute('aria-label', `${topic.votes} ${topic.votes === 1 ? 'vote' : 'votes'}`);
    renderCoffeeStack(coffeeStack, topic.votes);

    const hasVoted = Boolean(votingState.topics[topic.id]);
    const limitReached = votingState.used >= votingState.limit && !hasVoted;

    if (hasVoted) {
      card.classList.add('voted');
    } else {
      card.classList.remove('voted');
    }

    voteLabel.textContent = hasVoted ? 'Voted' : 'Vote';
    voteBtn.setAttribute('aria-pressed', hasVoted);
    voteBtn.setAttribute('aria-label', `${hasVoted ? 'Remove your vote from' : 'Vote for'} ${topic.title}`);
    voteBtn.title = limitReached ? 'Vote limit reached' : hasVoted ? 'Remove your vote' : 'Cast your vote';

    if (state.activeTopicId === topic.id) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }

    notesInput.value = topic.notes;
    saveNotesBtn.addEventListener('click', () => {
      topic.notes = notesInput.value.trim();
      persistState();
      saveNotesBtn.textContent = 'Saved!';
      saveNotesBtn.disabled = true;
      setTimeout(() => {
        saveNotesBtn.textContent = 'Save notes';
        saveNotesBtn.disabled = false;
      }, 1200);
    });

    voteBtn.addEventListener('click', () => toggleVote(topic));
    voteBtn.disabled = limitReached;

    const actionButtons = getActionsForTopic(topic);
    actionButtons.forEach((button) => actions.append(button));

    column.append(card);
  }
}

function getEmptyMessage(columnId) {
  switch (columnId) {
    case 'todoColumn':
      return 'Add topics to build today\'s agenda.';
    case 'doingColumn':
      return 'Move a topic here when you start discussing it.';
    case 'doneColumn':
      return 'Wrap-up notes will appear here after discussions.';
    default:
      return 'Nothing here yet.';
  }
}

function getActionsForTopic(topic) {
  const buttons = [];

  if (topic.status === 'todo') {
    buttons.push(createActionButton('Move to Discussing', 'primary', () => promoteToDiscussing(topic.id)));
  }

  if (topic.status === 'doing') {
    buttons.push(createActionButton('Mark as Discussed', 'primary', () => completeTopic(topic.id)));
    buttons.push(createActionButton('Back to To Discuss', 'secondary', () => moveToStatus(topic.id, 'todo')));
    if (state.activeTopicId !== topic.id) {
      buttons.push(createActionButton('Set Active', 'secondary', () => setActiveTopic(topic.id)));
    }
  }

  if (topic.status === 'done') {
    buttons.push(createActionButton('Reopen topic', 'secondary', () => moveToStatus(topic.id, 'todo')));
  }

  return buttons;
}

function createActionButton(label, variant, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function toggleVote(topic) {
  if (votingState.topics[topic.id]) {
    delete votingState.topics[topic.id];
    votingState.used = Math.max(votingState.used - 1, 0);
    topic.votes = Math.max(topic.votes - 1, 0);
  } else {
    if (votingState.used >= votingState.limit) {
      return;
    }
    votingState.topics[topic.id] = true;
    votingState.used += 1;
    topic.votes += 1;
  }
  persistVotingState();
  persistState();
  updateVotesRemaining();
  renderBoard();
}

function promoteToDiscussing(topicId) {
  moveToStatus(topicId, 'doing');
  setActiveTopic(topicId);
}

function setActiveTopic(topicId) {
  stopTimer();
  state.activeTopicId = topicId;
  state.timerRemaining = state.timerDefault;
  persistState();
  updateTimerUI();
}

function completeTopic(topicId) {
  moveToStatus(topicId, 'done');
  if (state.activeTopicId === topicId) {
    state.activeTopicId = null;
    stopTimer();
  }
  persistState();
  renderBoard();
}

function completeActiveTopic() {
  if (!state.activeTopicId) return;
  completeTopic(state.activeTopicId);
}

function moveToStatus(topicId, status) {
  const topic = state.topics.find((item) => item.id === topicId);
  if (!topic) return;
  topic.status = status;
  if (state.activeTopicId === topicId && status !== 'doing') {
    state.activeTopicId = null;
    stopTimer();
    state.timerRemaining = state.timerDefault;
  }
  persistState();
  renderBoard();
}

function startTimer() {
  if (!state.activeTopicId) {
    alert('Select a topic that is being discussed first.');
    return;
  }
  if (timerInterval) return;

  const start = Date.now();
  let previousElapsed = 0;

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed !== previousElapsed) {
      previousElapsed = elapsed;
      state.timerRemaining = Math.max(state.timerRemaining - 1, 0);
      updateTimerUI();
      if (state.timerRemaining === 0) {
        stopTimer();
        if (typeof timeboxDialog.showModal === 'function') {
          timeboxDialog.showModal();
        }
      }
      persistState();
    }
  }, 250);
}

function pauseTimer() {
  if (!timerInterval) return;
  stopTimer();
  persistState();
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function resetTimer() {
  stopTimer();
  state.timerRemaining = state.timerDefault;
  persistState();
  updateTimerUI();
}

function extendTimer(seconds) {
  state.timerRemaining += seconds;
  persistState();
  updateTimerUI();
}

function updateTimerUI() {
  const activeTopic = state.topics.find((topic) => topic.id === state.activeTopicId && topic.status === 'doing');
  if (!activeTopic) {
    activeTopicPanel.hidden = true;
    stopTimer();
    state.timerRemaining = state.timerDefault;
    timerDisplay.textContent = formatTime(state.timerRemaining);
    return;
  }

  activeTopicPanel.hidden = false;
  timerDisplay.textContent = formatTime(state.timerRemaining);
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatRelativeDate(isoDate) {
  const date = new Date(isoDate);
  const deltaSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (deltaSeconds < 60) return 'just now';
  if (deltaSeconds < 3600) {
    const minutes = Math.floor(deltaSeconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (deltaSeconds < 86400) {
    const hours = Math.floor(deltaSeconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(deltaSeconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Accessibility: close dialog with Escape key on older browsers.
if (timeboxDialog) {
  timeboxDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    timeboxDialog.close();
  });
}

function handleTimeboxChange() {
  const value = Number(timeboxSelect.value);
  if (Number.isNaN(value)) {
    return;
  }
  const shouldResetTimer = !timerInterval || state.timerRemaining === state.timerDefault;
  state.timerDefault = value;
  if (shouldResetTimer) {
    state.timerRemaining = value;
    updateTimerUI();
  }
  persistState();
}

function syncTimeboxSelect() {
  if (!timeboxSelect) return;
  const option = Array.from(timeboxSelect.options).find((opt) => Number(opt.value) === state.timerDefault);
  if (option) {
    timeboxSelect.value = option.value;
  } else {
    const customOption = document.createElement('option');
    customOption.value = String(state.timerDefault);
    customOption.textContent = `${Math.round(state.timerDefault / 60)} min`;
    timeboxSelect.append(customOption);
    timeboxSelect.value = customOption.value;
  }
}
