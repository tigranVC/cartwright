// UI: every mutation goes through the browser API so UI and API cannot diverge.
import api from './api.js';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function render() {
  document.querySelector('#list').innerHTML = api.query('listItems', { status: 'open' }).result.slice(0, 50)
    .map((i) => `<li>${esc(i.name)} <button data-id="${i.id}">Done</button></li>`).join('');
  document.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { api.completeItem({ itemId: b.dataset.id }); render(); }; });
}
document.querySelector('#reset').onclick = () => { api.reset(); render(); };
render();
