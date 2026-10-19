// Renders browser screens in Node from a derived LifeOS state.
import { store } from '../public/app/store.js';
import { defaultWorkspace } from '../src/lifeos-workspace.mjs';
import tasksScreen from '../public/app/screens/tasks.js';

export function renderTasksScreen(state, list = 'all') {
  store.state = { ...state, workspace: state.workspace || defaultWorkspace() };
  store.ui.route = { section: 'tasks', id: null, params: new URLSearchParams({ list }) };
  store.ui.filter = '';
  store.ui.selection = new Set();
  return String(tasksScreen.render());
}
