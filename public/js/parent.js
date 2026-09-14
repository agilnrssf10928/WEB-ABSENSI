// ========================================================
// NOTIFIKASI REALTIME + PORTAL ORANG TUA
// ========================================================

// ---------- Notifikasi (semua role) ----------
function initNotificationPolling() {
  pollNotifications();
  setInterval(pollNotifications, 15000); // tiap 15 detik
}

async function pollNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    if (!data.success) return;

    renderNotificationBell(data.notifications, data.unread);
  } catch (e) { /* diamkan */ }
}

function renderNotificationBell(items, unread) {
  let bellWrap = document.getElementById('notif-bell-wrap');
  if (!bellWrap) {
    bellWrap = document.createElement('div');
    bellWrap.id = 'notif-bell-wrap';
    bellWrap.className = 'relative';
    bellWrap.innerHTML = `
      <button id="notif-bell" class="relative p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition" title="Notifikasi">
        <i class="fa-solid fa-bell text-lg"></i>
        <span id="notif-badge" class="hidden absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">0</span>
      </button>
      <div id="notif-dropdown" class="hidden absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xl z-50"></div>
    `;
    const headerRight = document.querySelector('#main-header .flex.items-center.space-x-3:last-child');
    if (headerRight) headerRight.prepend(bellWrap);
    else return;

    document.getElementById('notif-bell').addEventListener('click', () => {
      document.getElementById('notif-dropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!bellWrap.contains(e.target)) {
        document.getElementById('notif-dropdown').classList.add('hidden');
      }
    });
  }

  const badge = document.getElementById('notif-badge');
  const drop = document.getElementById('notif-dropdown');
  if (!badge || !drop) return;

  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (items.length === 0) {
    drop.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">Belum ada notifikasi.</div>`;
    return;
  }

  drop.innerHTML = `
    <div class="flex items-center justify-between px-4 py-2 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
      <span class="text-xs font-bold text-slate-700">Notifikasi</span>
      <button id="notif-mark-read" class="text-[10px] font-bold text-blue-600 hover:underline">Tandai dibaca</button>
    </div>
    ${items.map(n => {
      const isOut = n.type === 'clock-out';
      const icon = isOut ? 'fa-right-from-bracket text-indigo-500 bg-indigo-50'
                  : n.type === 'clock-in' ? 'fa-right-to-bracket text-emerald-500 bg-emerald-50'
                  : 'fa-circle-info text-blue-500 bg-blue-50';
      return `
      <div class="px-4 py-3 border-b border-slate-50 flex items-start space-x-3 ${n.is_read ? 'opacity-60' : 'bg-blue-50/30'}">
        <div class="w-8 h-8 rounded-lg ${icon} flex items-center justify-center text-sm shrink-0">
          <i class="fa-solid ${icon.split(' ')[0]}"></i>
        </div>
        <div class="min-w-0">
          <div class="text-xs font-bold text-slate-800">${n.title}</div>
          <div class="text-[11px] text-slate-500">${n.body}</div>
          <div class="text-[10px] text-slate-400 mt-0.5">${(n.created_at || '').split('.')[0]}</div>
        </div>
      </div>`;
    }).join('')}
  `;

  document.getElementById('notif-mark-read').addEventListener('click', async () => {
    await fetch('/api/notifications/read', { method: 'POST' });
    pollNotifications();
  });
}

// ---------- Portal Orang Tua ----------
function renderParentView() {
  const user = state.currentUser;
  if (!user || user.role !== 'parent') return;

  // Sembunyikan tab yang tidak relevan untuk orang tua
  ['tab-emp-clock', 'tab-emp-leave'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  // Buat tab khusus orang tua
  const tabstrip = document.querySelector('#view-employee .tabstrip-card');
  if (tabstrip && !document.getElementById('tab-emp-parent')) {
    const btn = document.createElement('button');
    btn.id = 'tab-emp-parent';
    btn.className = 'tab-btn-emp active font-bold text-sm flex items-center space-x-2 whitespace-nowrap';
    btn.innerHTML = '<i class="fa-solid fa-child-reaching text-purple-500"></i><span>Pantau Anak Saya</span>';
    btn.addEventListener('click', () => switchEmployeeTab('parent'));
    tabstrip.prepend(btn);
  }

  // Panel khusus orang tua
  const view = document.getElementById('view-employee');
  if (!document.getElementById('panel-emp-parent')) {
    const panel = document.createElement('div');
    panel.id = 'panel-emp-parent';
    panel.className = 'hidden space-y-6';
    panel.innerHTML = `
      <div class="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200/70 p-5 rounded-2xl flex items-center justify-between">
        <div>
          <span class="text-xs font-extrabold text-purple-800 uppercase tracking-wider block">Portal Orang Tua / Wali</span>
          <p class="text-xs text-purple-700">Pantau jam datang & pulang anak Anda secara realtime. Notifikasi muncul setiap anak Anda discan di gerbang.</p>
        </div>
        <div class="px-3 py-1 bg-purple-200/80 text-purple-900 rounded-full font-bold text-xs">
          <i class="fa-solid fa-users mr-1"></i> Mode Orang Tua
        </div>
      </div>
      <div id="parent-children-list" class="space-y-4">
        <div class="text-center text-slate-400 text-xs py-8"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat data anak...</div>
      </div>
    `;
    view.appendChild(panel);
  }

  loadParentChildren();
}

async function loadParentChildren() {
  const list = document.getElementById('parent-children-list');
  if (!list) return;

  try {
    const res = await fetch('/api/parent/children');
    const data = await res.json();
    if (!data.success || !data.children || data.children.length === 0) {
      list.innerHTML = `<div class="bg-white p-6 rounded-2xl card-shadow text-center text-xs text-slate-400">Belum ada anak yang terhubung ke akun Anda. Hubungi admin sekolah.</div>`;
      return;
    }

    list.innerHTML = data.children.map(c => {
      const statusBadge = !c.clock_in
        ? '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">Belum Datang</span>'
        : !c.clock_out
          ? '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Sedang di Sekolah</span>'
          : '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">Sudah Pulang</span>';

      const lateBadge = c.status === 'late' ? ' <span class="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">Terlambat</span>' : '';

      return `
      <div class="bg-white p-5 rounded-2xl card-shadow border border-slate-200">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center space-x-3">
            <div class="w-11 h-11 rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-500 text-white flex items-center justify-center font-bold text-lg shadow-md shadow-purple-500/25">
              ${c.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div class="font-extrabold text-slate-900">${c.name} ${lateBadge}</div>
              <div class="text-xs text-slate-500">${c.department || '-'} • NISN ${c.nip}</div>
            </div>
          </div>
          ${statusBadge}
        </div>
        <div class="grid grid-cols-2 gap-3 mt-4">
          <div class="bg-emerald-50/60 border border-emerald-100 p-3 rounded-xl">
            <div class="text-[10px] font-bold text-emerald-800 uppercase">Jam Datang Hari Ini</div>
            <div class="text-xl font-black text-slate-900 mt-0.5">${c.clock_in || '--:--:--'}</div>
          </div>
          <div class="bg-indigo-50/60 border border-indigo-100 p-3 rounded-xl">
            <div class="text-[10px] font-bold text-indigo-800 uppercase">Jam Pulang Hari Ini</div>
            <div class="text-xl font-black text-slate-900 mt-0.5">${c.clock_out || '--:--:--'}</div>
          </div>
        </div>
        <button class="mt-4 w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
          onclick="openChildHistory(${c.id}, '${c.name.replace(/'/g, "\\'")}')">
          <i class="fa-solid fa-calendar-days mr-1"></i> Lihat Riwayat Bulanan
        </button>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="text-center text-red-500 text-xs py-6">Gagal memuat data anak.</div>`;
  }
}

window.openChildHistory = function (childId, childName) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  fetch(`/api/parent/children/${childId}/history?month=${month}`)
    .then(r => r.json())
    .then(data => {
      if (!data.success) { showToast('Gagal memuat riwayat', 'error'); return; }

      const rows = data.attendances.length === 0
        ? `<tr><td colspan="4" class="p-4 text-center text-slate-400 text-xs">Belum ada catatan bulan ini.</td></tr>`
        : data.attendances.map(a => {
            const st = a.status === 'present' ? '<span class="text-emerald-600 font-bold">Tepat Waktu</span>'
                     : a.status === 'late' ? '<span class="text-amber-600 font-bold">Terlambat</span>'
                     : `<span class="text-purple-600 font-bold">${a.status}</span>`;
            return `<tr class="hover:bg-slate-50">
              <td class="p-2.5 font-semibold text-slate-800 text-xs">${a.date}</td>
              <td class="p-2.5 font-mono text-xs">${a.clock_in || '-'}</td>
              <td class="p-2.5 font-mono text-xs">${a.clock_out || '-'}</td>
              <td class="p-2.5 text-xs">${st}</td>
            </tr>`;
          }).join('');

      let modal = document.getElementById('modal-child-history');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-child-history';
        modal.className = 'hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4';
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
        document.body.appendChild(modal);
      }

      modal.innerHTML = `
        <div class="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 overflow-hidden" style="max-height:85vh; display:flex; flex-direction:column;">
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <h4 class="font-bold text-slate-900 text-base"><i class="fa-solid fa-calendar-days text-purple-600 mr-2"></i>Riwayat ${childName} — ${month}</h4>
            <button onclick="document.getElementById('modal-child-history').classList.add('hidden')" class="text-slate-400 hover:text-slate-600 text-lg"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="overflow-y-auto p-4">
            <table class="data-table w-full text-left">
              <thead class="text-slate-600 text-[10px] font-bold uppercase border-b border-slate-200">
                <tr><th class="p-2.5">Tanggal</th><th class="p-2.5">Datang</th><th class="p-2.5">Pulang</th><th class="p-2.5">Status</th></tr>
              </thead>
              <tbody class="divide-y divide-slate-100">${rows}</tbody>
            </table>
          </div>
        </div>`;
      modal.classList.remove('hidden');
    })
    .catch(() => showToast('Gagal menghubungi server', 'error'));
};

// Auto-start saat app siap
document.addEventListener('DOMContentLoaded', () => {
  initNotificationPolling();
});
