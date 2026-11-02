// ============ STATUS MODAL ============

function openStatusModal(title, message) {
  document.getElementById('statusModalTitle').textContent = title;
  document.getElementById('statusModalMessage').textContent = message;
  document.getElementById('statusModalDetails').innerHTML = '';
  document.getElementById('statusModal').classList.add('show');
}

function closeStatusModal() {
  document.getElementById('statusModal').classList.remove('show');
}

function updateStatusModal(message, type = 'info') {
  const msgEl = document.getElementById('statusModalMessage');
  msgEl.innerHTML = `<span class="status-message ${type}">${message}</span>`;
}

function addStatusDetail(text) {
  const detailsEl = document.getElementById('statusModalDetails');
  const pre = document.createElement('pre');
  pre.textContent = text;
  detailsEl.appendChild(pre);
  detailsEl.scrollTop = detailsEl.scrollHeight;
}
