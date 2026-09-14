// ========================================================
// Web Absensi Sekolah - Client Application Script
// ========================================================

const state = {
  currentUser: null,
  officeSettings: null,
  userCoords: null,
  maps: {
    emp: null,
    admin: null,
    detail: null
  }
};

// ========================================================
// UTILS & HELPERS
// ========================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconClass = type === 'success' ? 'fa-circle-check text-emerald-500' :
                    type === 'error' ? 'fa-triangle-exclamation text-red-500' :
                    'fa-circle-info text-blue-500';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass} text-lg"></i>
    <div class="flex-1">${message}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371e3; // meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function formatIndoDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Live Clock
function startClock() {
  function update() {
    const now = new Date();
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const day = days[now.getDay()];
    const date = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const el = document.getElementById('live-datetime');
    if (el) el.textContent = `${day}, ${date} • ${time} WIB`;
  }
  update();
  setInterval(update, 1000);
}

// ========================================================
// AUTHENTICATION & NAVIGATION
// ========================================================

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.success && data.user) {
      state.currentUser = data.user;
      renderApp();
    } else {
      showLoginView();
    }
  } catch (err) {
    showLoginView();
  }
}

function showLoginView() {
  stopQrScanner();
  state.currentUser = null;
  // Kembalikan panel yang dipindahkan admin ke tampilan siswa agar login berikutnya normal
  placeClockPanelInStudentView();
  document.getElementById('main-header').classList.add('hidden');
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-employee').classList.add('hidden');
  document.getElementById('view-admin').classList.add('hidden');
}

async function renderApp() {
  const user = state.currentUser;
  if (!user) return showLoginView();

  // Update Header
  document.getElementById('main-header').classList.remove('hidden');
  document.getElementById('nav-user-name').textContent = user.name;
  
  const roleLabel = user.role === 'admin' ? 'KEPALA SEKOLAH / ADMIN' :
                    user.role === 'teacher' ? 'DEWAN GURU' : 'SISWA';
  document.getElementById('nav-user-role').textContent = roleLabel;
  document.getElementById('nav-user-dept').textContent = `• ${user.department}`;
  document.getElementById('view-login').classList.add('hidden');

  await loadSettings();

  if (user.role === 'admin') {
    document.getElementById('view-employee').classList.add('hidden');
    document.getElementById('view-admin').classList.remove('hidden');
    switchAdminTab('dash');
  } else {
    document.getElementById('view-admin').classList.add('hidden');
    document.getElementById('view-employee').classList.remove('hidden');
    switchEmployeeTab('clock');
    initEmployeePortal();
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      state.officeSettings = data.settings;
      document.getElementById('header-office-name').textContent = data.settings.office_name;
    }
  } catch (err) {
    console.error('Gagal memuat pengaturan:', err);
  }
}

// Banner sukses besar setelah login
function showLoginSuccessBanner() {
  const existing = document.getElementById('login-success-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'login-success-banner';
  banner.className = 'login-success-banner';
  banner.innerHTML = `
    <div class="flex items-center justify-center space-x-3">
      <i class="fa-solid fa-circle-check text-3xl"></i>
      <div class="text-center">
        <div class="font-black text-base sm:text-lg tracking-wide">SELAMAT ANDA BERHASIL LOGIN KE WEB ABSENSI SEKOLAH</div>
      </div>
    </div>
  `;
  document.body.prepend(banner);

  // Hilangkan otomatis setelah 6 detik
  setTimeout(() => {
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-16px)';
    setTimeout(() => banner.remove(), 400);
  }, 6000);
}

// Form Login Submit
document.getElementById('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-login');
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Memproses...`;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (data.success) {
      showToast('SELAMAT ANDA BERHASIL LOGIN KE WEB ABSENSI SEKOLAH', 'success');
      showLoginSuccessBanner();
      state.currentUser = data.user;
      renderApp();
    } else {
      showToast(data.error || 'Login gagal, periksa username & password', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan koneksi server', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Masuk Sekarang</span> <i class="fa-solid fa-arrow-right text-xs"></i>`;
  }
});

// Logout
document.getElementById('btn-logout').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    showToast('Anda telah keluar.', 'info');
  } catch (e) {}
  showLoginView();
});

// Toggle Password
document.getElementById('btn-toggle-password').addEventListener('click', () => {
  const input = document.getElementById('login-password');
  const icon = document.getElementById('eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
});

// ========================================================
// EMPLOYEE / STUDENT / TEACHER PORTAL LOGIC
// ========================================================

function placeClockPanelInStudentView() {
  const clockPanel = document.getElementById('panel-emp-clock');
  const studentView = document.getElementById('view-employee');
  const historyPanel = document.getElementById('panel-emp-history');
  studentView.insertBefore(clockPanel, historyPanel);
}

// ========================================================
// QR ATTENDANCE (Scan QR Gerbang / QR Kartu + QR Pribadi)
// ========================================================

const qrState = {
  scanning: false,
  stream: null,
  rafId: null,
  canvas: document.createElement('canvas'),
  lastResult: '',
  lastResultAt: 0,
  mode: 'in' // 'in' = Scan Masuk, 'out' = Scan Pulang, 'auto' = otomatis
};

function switchEmployeeTab(tabName) {
  document.querySelectorAll('.tab-btn-emp').forEach(b => {
    b.classList.remove('active');
    b.classList.add('text-slate-500');
  });

  const activeBtn = document.getElementById(`tab-emp-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.classList.remove('text-slate-500');
  }

  // Admin memakai switchAdminTab — abaikan panggilan dari tampilan admin
  if (state.currentUser && state.currentUser.role === 'admin') return;

  placeClockPanelInStudentView();

  const empPanels = ['panel-emp-clock', 'panel-emp-history', 'panel-emp-leave', 'panel-emp-scan'];
  empPanels.forEach(id => document.getElementById(id).classList.remove('panel-enter'));

  document.getElementById('panel-emp-clock').classList.toggle('hidden', tabName !== 'clock');
  document.getElementById('panel-emp-history').classList.toggle('hidden', tabName !== 'history');
  document.getElementById('panel-emp-leave').classList.toggle('hidden', tabName !== 'leave');
  // Siswa tidak bisa scan — panel scanner disembunyikan untuk role student
  const isStudentView = state.currentUser && state.currentUser.role === 'student';
  document.getElementById('panel-emp-scan').classList.toggle('hidden', tabName !== 'scan' || isStudentView);

  // Animasi masuk panel yang aktif
  const activePanel = document.getElementById(`panel-emp-${tabName}`);
  if (activePanel && !activePanel.classList.contains('hidden')) activePanel.classList.add('panel-enter');

  stopQrScanner();

  if (tabName === 'clock') {
    initGeolocation();
    loadTodayAttendance();
    if (state.maps.emp) setTimeout(() => state.maps.emp.invalidateSize(), 300);
  }

  if (tabName === 'history') loadEmployeeHistory();
  if (tabName === 'leave') loadEmployeeLeaves();
  if (tabName === 'scan') lookupStudentQr();
}

// Cari murid (debounce 300ms)
let studentQrSearchTimer = null;
document.getElementById('student-qr-search').addEventListener('input', () => {
  clearTimeout(studentQrSearchTimer);
  studentQrSearchTimer = setTimeout(lookupStudentQr, 300);
});

document.getElementById('tab-emp-clock').addEventListener('click', () => switchEmployeeTab('clock'));
document.getElementById('tab-emp-scan').addEventListener('click', () => switchEmployeeTab('scan'));
document.getElementById('tab-emp-history').addEventListener('click', () => switchEmployeeTab('history'));
document.getElementById('tab-emp-leave').addEventListener('click', () => switchEmployeeTab('leave'));

async function initEmployeePortal() {
  await loadTodayAttendance();
  initGeolocation();
  renderMyQrCode();
  applyScanPermissionUi();
  lookupStudentQr();
}

// Tampilkan/sembunyikan fitur QR sesuai role:
// - Siswa: tanpa QR & tanpa scanner sama sekali (guru piket yang memindai)
// - Guru & Admin: scanner + QR sendiri + lihat QR kartu murid
function applyScanPermissionUi() {
  const user = state.currentUser;
  if (!user) return;
  const isStudent = user.role === 'student';

  const scanTab = document.getElementById('tab-emp-scan');
  if (scanTab) scanTab.classList.toggle('hidden', isStudent);

  // QR pribadi hanya untuk guru & admin
  const myQrCard = document.getElementById('my-qr-card');
  if (myQrCard) myQrCard.classList.toggle('hidden', isStudent);

  // Tombol buka scanner, tombol QR murid, & catatan khusus siswa
  const goBtn = document.getElementById('btn-go-qr-tab');
  const studentQrBtn = document.getElementById('btn-show-student-qr');
  const studentNote = document.getElementById('student-no-qr-note');
  if (goBtn) goBtn.classList.toggle('hidden', isStudent);
  if (studentQrBtn) studentQrBtn.classList.toggle('hidden', isStudent);
  if (studentNote) studentNote.classList.toggle('hidden', !isStudent);

  const descStudent = document.getElementById('scan-desc-student');
  const descTeacher = document.getElementById('scan-desc-teacher');
  if (descStudent) descStudent.classList.add('hidden');
  if (descTeacher) descTeacher.classList.remove('hidden');
}

// ========================================================
// QR KARTU MURID (khusus Guru & Admin: lihat & cetak QR siswa)
// ========================================================

async function lookupStudentQr() {
  const user = state.currentUser;
  if (!user || user.role === 'student') return;

  const term = document.getElementById('student-qr-search').value.trim().toLowerCase();
  const listBox = document.getElementById('student-qr-list');
  if (!listBox) return;

  try {
    const res = await fetch('/api/employees?role=student');
    const data = await res.json();
    if (!data.success) {
      listBox.innerHTML = `<div class="p-3 text-xs text-red-500">Gagal memuat data murid.</div>`;
      return;
    }

    const students = data.employees.filter(s =>
      !term || s.name.toLowerCase().includes(term) || (s.department || '').toLowerCase().includes(term) || s.nip.includes(term)
    ).slice(0, 30);

    if (students.length === 0) {
      listBox.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">Tidak ada murid yang cocok.</div>`;
      return;
    }

    listBox.innerHTML = students.map(s => `
      <button type="button" class="w-full text-left px-3 py-2 hover:bg-blue-50 transition flex items-center justify-between gap-2"
        data-nip="${s.nip}" data-name="${s.name}" data-dept="${s.department || ''}" data-pos="${s.position || ''}">
        <span class="min-w-0">
          <span class="block text-xs font-bold text-slate-800 truncate">${s.name}</span>
          <span class="block text-[10px] text-slate-500 truncate">${s.department || '-'} • ${s.nip}</span>
        </span>
        <i class="fa-solid fa-qrcode text-blue-500"></i>
      </button>
    `).join('');

    listBox.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        renderStudentQr(btn.dataset.nip, btn.dataset.name, btn.dataset.dept, btn.dataset.pos);
      });
    });
  } catch (err) {
    listBox.innerHTML = `<div class="p-3 text-xs text-red-500">Gagal menghubungi server.</div>`;
  }
}

function renderStudentQr(nip, name, dept, pos) {
  const box = document.getElementById('selected-student-qr');
  const container = document.getElementById('student-qr-code');
  if (!box || !container || typeof QRCode === 'undefined') return;

  container.innerHTML = '';
  new QRCode(container, {
    text: `USER_ID:${nip}`,
    width: 180,
    height: 180,
    colorDark: '#0f172a',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  document.getElementById('student-qr-name').textContent = name;
  document.getElementById('student-qr-detail').textContent = `${pos || ''} — ${dept || ''}`;
  document.getElementById('student-qr-nip').textContent = `ID: ${nip}`;
  box.classList.remove('hidden');
}

// ========================================================
// MODAL: QR MURID TERDAFTAR (grid semua kartu QR siswa)
// ========================================================

let allStudentsCache = [];

function buildStudentQrGrid(term = '') {
  const grid = document.getElementById('student-qr-grid');
  if (!grid || typeof QRCode === 'undefined') return;

  const t = term.trim().toLowerCase();
  const students = allStudentsCache.filter(s =>
    !t || s.name.toLowerCase().includes(t) || (s.department || '').toLowerCase().includes(t) || s.nip.includes(t)
  );

  if (students.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center text-slate-400 text-xs py-6">Tidak ada murid yang cocok.</div>`;
    return;
  }

  grid.innerHTML = students.map(s => `
    <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center space-y-2">
      <div class="qr-frame flex justify-center p-2 bg-white rounded-lg">
        <div class="student-grid-qr" data-nip="${s.nip}"></div>
      </div>
      <div class="font-bold text-slate-900 text-xs truncate" title="${s.name}">${s.name}</div>
      <div class="text-[10px] text-slate-500 truncate">${s.department || '-'}</div>
      <div class="font-mono text-[9px] text-slate-400">${s.nip}</div>
    </div>
  `).join('');

  // Render QR ke masing-masing kartu
  grid.querySelectorAll('.student-grid-qr').forEach(el => {
    new QRCode(el, {
      text: `USER_ID:${el.dataset.nip}`,
      width: 90,
      height: 90,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
  });
}

async function openStudentQrModal() {
  const user = state.currentUser;
  if (!user || user.role === 'student') {
    showToast('Hanya Guru & Admin yang bisa melihat QR murid.', 'error');
    return;
  }

  const modal = document.getElementById('modal-student-qr');
  const grid = document.getElementById('student-qr-grid');
  const loading = document.getElementById('student-qr-grid-loading');
  modal.classList.remove('hidden');
  grid.innerHTML = '';
  loading.classList.remove('hidden');

  try {
    const res = await fetch('/api/employees?role=student');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Gagal memuat');

    allStudentsCache = data.employees || [];
    loading.classList.add('hidden');
    buildStudentQrGrid(document.getElementById('student-qr-modal-search').value || '');
  } catch (e) {
    loading.innerHTML = `<span class="text-red-500">Gagal memuat daftar murid.</span>`;
  }
}

function printAllStudentQr() {
  const area = document.getElementById('print-all-qr-area');
  if (!area || typeof QRCode === 'undefined' || allStudentsCache.length === 0) {
    showToast('Tidak ada data murid untuk dicetak.', 'error');
    return;
  }

  const t = (document.getElementById('student-qr-modal-search').value || '').trim().toLowerCase();
  const students = allStudentsCache.filter(s =>
    !t || s.name.toLowerCase().includes(t) || (s.department || '').toLowerCase().includes(t) || s.nip.includes(t)
  );

  area.innerHTML = students.map(s => `
    <div class="print-qr-card">
      <div class="print-qr-code" data-nip="${s.nip}"></div>
      <div class="print-qr-name">${s.name}</div>
      <div class="print-qr-sub">${s.department || '-'} • ${s.position || 'Siswa'}</div>
      <div class="print-qr-nip">${s.nip}</div>
    </div>
  `).join('');

  area.querySelectorAll('.print-qr-code').forEach(el => {
    new QRCode(el, {
      text: `USER_ID:${el.dataset.nip}`,
      width: 100,
      height: 100,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
  });

  setTimeout(() => {
    window.print();
    setTimeout(() => { area.innerHTML = ''; }, 500);
  }, 300);
}

async function loadTodayAttendance() {
  try {
    const res = await fetch('/api/attendance/today');
    const data = await res.json();
    if (!data.success) return;

    const todayDate = data.currentDate;
    document.getElementById('today-date-text').textContent = formatIndoDate(todayDate);

    const att = data.attendance;
    const settings = data.settings || state.officeSettings;
    state.officeSettings = settings;

    // Status badge presensi (absen hanya via QR)
    const statusBadge = document.getElementById('today-status-badge');

    if (!att) {
      // Belum absen masuk
      statusBadge.className = 'px-4 py-1.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 flex items-center space-x-2';
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>Belum Absen — Scan QR di Tab QR</span>`;

      document.getElementById('val-clock-in').textContent = '--:--:--';
      document.getElementById('val-clock-out').textContent = '--:--:--';
    } else if (att.clock_in && !att.clock_out) {
      // Sudah masuk, belum pulang
      const isLate = att.status === 'late';
      statusBadge.className = isLate
        ? 'px-4 py-1.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 flex items-center space-x-2'
        : 'px-4 py-1.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 flex items-center space-x-2';
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full ${isLate ? 'bg-amber-500' : 'bg-emerald-500'}"></span><span>${isLate ? 'Hadir (Terlambat Masuk)' : 'Hadir Tepat Waktu'}</span>`;

      document.getElementById('val-clock-in').textContent = att.clock_in;
      document.getElementById('val-clock-out').textContent = '--:--:--';
    } else if (att.clock_in && att.clock_out) {
      // Sudah lengkap
      statusBadge.className = 'px-4 py-1.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 flex items-center space-x-2';
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-500"></span><span>Presensi Sekolah Lengkap</span>`;

      document.getElementById('val-clock-in').textContent = att.clock_in;
      document.getElementById('val-clock-out').textContent = att.clock_out;
    }

    if (settings) {
      document.getElementById('sub-clock-in').textContent = `Bel Masuk: ${settings.work_start_time} WIB`;
      document.getElementById('sub-clock-out').textContent = `Bel Pulang: ${settings.work_end_time} WIB`;
      document.getElementById('sub-distance').textContent = `Radius gerbang: ${settings.office_radius_meters}m`;
      document.getElementById('map-office-label').textContent = settings.office_name;
    }
  } catch (err) {
    console.error('Gagal mengambil status presensi:', err);
  }
}

// ========================================================
// GEOLOCATION & MAP
// ========================================================

function initGeolocation() {
  const coordsLabel = document.getElementById('map-user-coords');
  const distLabel = document.getElementById('val-distance');
  const radiusBadge = document.getElementById('map-radius-badge');
  const radiusBox = document.getElementById('radius-status-box');

  if (!navigator.geolocation) {
    coordsLabel.textContent = 'Geolocation tidak didukung browser';
    return;
  }

  coordsLabel.textContent = 'Mencari lokasi GPS...';

  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      state.userCoords = { lat, lng };

      coordsLabel.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

      const settings = state.officeSettings;
      if (settings && settings.office_lat && settings.office_lng) {
        const dist = calculateDistance(lat, lng, settings.office_lat, settings.office_lng);
        distLabel.textContent = `${dist} meter`;

        const within = !settings.enable_radius_restriction || dist <= settings.office_radius_meters;
        if (within) {
          radiusBox.className = 'flex items-center justify-between p-2 rounded-lg bg-emerald-50 border border-emerald-100';
          radiusBadge.className = 'font-bold text-emerald-700';
          radiusBadge.textContent = 'Di Area Gerbang Sekolah';
        } else {
          radiusBox.className = 'flex items-center justify-between p-2 rounded-lg bg-red-50 border border-red-100';
          radiusBadge.className = 'font-bold text-red-700';
          radiusBadge.textContent = `Di Luar Radius (${dist}m > ${settings.office_radius_meters}m)`;
        }

        renderEmployeeMap(lat, lng, settings);
      }
    },
    err => {
      console.warn('GPS Error:', err);
      coordsLabel.textContent = 'GPS diblokir / tidak aktif';
      distLabel.textContent = 'Lokasi gagal didapat';
      if (state.officeSettings) {
        renderEmployeeMap(state.officeSettings.office_lat, state.officeSettings.office_lng, state.officeSettings);
      }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

document.getElementById('btn-refresh-gps').addEventListener('click', () => {
  initGeolocation();
  showToast('Memperbarui koordinat lokasi GPS...', 'info');
});

function renderEmployeeMap(userLat, userLng, settings) {
  const container = document.getElementById('emp-map');
  if (!container) return;

  if (state.maps.emp) {
    state.maps.emp.remove();
  }

  const map = L.map('emp-map').setView([settings.office_lat, settings.office_lng], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // Office / School Circle
  L.circle([settings.office_lat, settings.office_lng], {
    color: '#2563eb',
    fillColor: '#3b82f6',
    fillOpacity: 0.15,
    radius: settings.office_radius_meters
  }).addTo(map);

  L.marker([settings.office_lat, settings.office_lng])
    .addTo(map)
    .bindPopup(`<b>${settings.office_name}</b><br>Radius Gerbang: ${settings.office_radius_meters}m`);

  if (userLat && userLng) {
    const userMarker = L.circleMarker([userLat, userLng], {
      color: '#ef4444',
      fillColor: '#ef4444',
      fillOpacity: 0.8,
      radius: 8
    }).addTo(map);
    userMarker.bindPopup('<b>Posisi Anda Saat Ini</b>').openPopup();
  }

  state.maps.emp = map;
}

// ========================================================
// QR ATTENDANCE ENGINE (Render QR, Scanner Kamera, Submit Scan)
// ========================================================

function renderMyQrCode() {
  const user = state.currentUser;
  if (!user) return;
  // Siswa tidak punya QR sama sekali — hanya guru & admin yang punya kartu QR
  if (user.role === 'student') return;
  const container = document.getElementById('my-qr-code');
  if (!container || typeof QRCode === 'undefined') return;
  container.innerHTML = '';
  const payload = `USER_ID:${user.nip}`;
  new QRCode(container, {
    text: payload,
    width: 180,
    height: 180,
    colorDark: '#0f172a',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  document.getElementById('my-qr-name').textContent = user.name;
  document.getElementById('my-qr-detail').textContent = `${user.position || ''} — ${user.department || ''}`;
  document.getElementById('my-qr-nip').textContent = `ID: ${user.nip}`;
}

function setQrStatus(text) {
  const el = document.getElementById('qr-scanner-status');
  if (el) el.textContent = text;
}

async function startQrScanner() {
  if (qrState.scanning) return;
  const video = document.getElementById('qr-video');
  if (!video || typeof jsQR === 'undefined') return;

  try {
    qrState.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    try {
      qrState.stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e2) {
      setQrStatus('Kamera tidak tersedia / izin ditolak');
      return;
    }
  }

  video.srcObject = qrState.stream;
  qrState.scanning = true;
  qrState.lastResult = '';
  const modeLabel = qrState.mode === 'in' ? 'SCAN MASUK' : qrState.mode === 'out' ? 'SCAN PULANG' : 'OTOMATIS';
  setQrStatus(`Mode ${modeLabel} — arahkan ke kartu QR`);
  document.getElementById('btn-toggle-qr-scan').innerHTML = '<i class="fa-solid fa-stop mr-1"></i> Hentikan Scan';

  const tick = () => {
    if (!qrState.scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = qrState.canvas;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) {
        handleQrResult(code.data);
      }
    }
    qrState.rafId = requestAnimationFrame(tick);
  };
  qrState.rafId = requestAnimationFrame(tick);
}

function stopQrScanner() {
  qrState.scanning = false;
  if (qrState.rafId) {
    cancelAnimationFrame(qrState.rafId);
    qrState.rafId = null;
  }
  if (qrState.stream) {
    qrState.stream.getTracks().forEach(t => t.stop());
    qrState.stream = null;
  }
  const video = document.getElementById('qr-video');
  if (video) video.srcObject = null;
  const btn = document.getElementById('btn-toggle-qr-scan');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Mulai Scan';
  setQrStatus('Kamera belum aktif');
}

async function handleQrResult(rawData) {
  // Debounce: QR yang sama dalam 4 detik diabaikan
  const now = Date.now();
  if (rawData === qrState.lastResult && now - qrState.lastResultAt < 4000) return;
  qrState.lastResult = rawData;
  qrState.lastResultAt = now;

  try {
    const res = await fetch('/api/attendance/scan-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qr_data: rawData,
        lat: state.userCoords ? state.userCoords.lat : null,
        lng: state.userCoords ? state.userCoords.lng : null,
        mode: qrState.mode
      })
    });
    const data = await res.json();

    const resultBox = document.getElementById('qr-last-result');
    if (resultBox) {
      resultBox.classList.remove('hidden');
      if (data.success) {
        resultBox.className = 'bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800';
        resultBox.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> ${data.message}`;
      } else {
        resultBox.className = 'bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800';
        resultBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i> ${data.error}`;
      }
    }

    if (data.success) {
      setQrStatus('Berhasil! ' + data.message);
      await loadTodayAttendance();
      if (state.currentUser && state.currentUser.role === 'admin') loadAdminDashboard();
    } else {
      setQrStatus(data.error || 'Scan gagal');
    }
  } catch (err) {
    setQrStatus('Gagal menghubungi server');
  }
}

document.getElementById('btn-toggle-qr-scan').addEventListener('click', () => {
  // Siswa tidak boleh memindai — hanya menampilkan QR
  const isStudent = state.currentUser && state.currentUser.role === 'student';
  if (isStudent) {
    showToast('Akun siswa tidak bisa memindai QR. Tunjukkan kartu QR Anda ke guru piket/petugas.', 'error');
    return;
  }
  if (qrState.scanning) {
    stopQrScanner();
  } else {
    startQrScanner();
  }
});

// Pilihan mode Scan Masuk / Scan Pulang / Otomatis
document.querySelectorAll('.qr-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    qrState.mode = btn.dataset.qrMode;
    document.querySelectorAll('.qr-mode-btn').forEach(b => {
      const active = b === btn;
      b.classList.toggle('bg-blue-600', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('border-blue-600', active);
      b.classList.toggle('shadow-md', active);
      b.classList.toggle('bg-white', !active);
      b.classList.toggle('text-slate-600', !active);
      b.classList.toggle('border-slate-200', !active);
    });
    if (qrState.scanning) {
      const modeLabel = qrState.mode === 'in' ? 'SCAN MASUK' : qrState.mode === 'out' ? 'SCAN PULANG' : 'OTOMATIS';
      setQrStatus(`Mode ${modeLabel} — arahkan ke kartu QR`);
    }
  });
});

// Tombol di tab Absen: lompat ke tab QR
document.getElementById('btn-go-qr-tab').addEventListener('click', () => {
  switchEmployeeTab('qr');
});

window.addEventListener('beforeunload', () => {
  stopQrScanner();
});

// ========================================================
// EMPLOYEE / STUDENT HISTORY & LEAVES
// ========================================================

async function loadEmployeeHistory() {
  const monthInput = document.getElementById('emp-history-month');
  if (!monthInput.value) {
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const tbody = document.getElementById('table-emp-history');    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat data...</td></tr>`;

  try {
    const res = await fetch(`/api/attendance/history?month=${monthInput.value}`);
    const data = await res.json();

    if (!data.success || !data.attendances || data.attendances.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Belum ada catatan presensi pada bulan ini.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.attendances.map(row => {
      const statusBadge = row.status === 'present' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">Tepat Waktu</span>' :
                          row.status === 'late' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Terlambat</span>' :
                          row.status === 'sick' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800">Sakit</span>' :
                          row.status === 'dispensation' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">Dispensasi</span>' :
                          '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">Izin</span>';

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="p-3 font-semibold text-slate-800">${row.date}</td>
          <td class="p-3 font-mono text-xs">${row.clock_in || '-'}</td>
          <td class="p-3 font-mono text-xs">${row.clock_out || '-'}</td>
          <td class="p-3">${statusBadge}</td>
          <td class="p-3 text-xs text-slate-500">${row.distance_in != null ? row.distance_in + 'm' : '-'}</td>
          <td class="p-3 text-xs text-slate-600">${row.notes || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Gagal memuat riwayat.</td></tr>`;
  }
}

document.getElementById('emp-history-month').addEventListener('change', loadEmployeeHistory);

// Form Pengajuan Izin
document.getElementById('form-leave-request').addEventListener('submit', async e => {
  e.preventDefault();
  const type = document.getElementById('leave-type').value;
  const start_date = document.getElementById('leave-start-date').value;
  const end_date = document.getElementById('leave-end-date').value;
  const reason = document.getElementById('leave-reason').value;
  const fileInput = document.getElementById('leave-attachment');

  let attachment = null;
  if (fileInput.files && fileInput.files[0]) {
    attachment = await fileToBase64(fileInput.files[0]);
  }

  try {
    const res = await fetch('/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, start_date, end_date, reason, attachment })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('form-leave-request').reset();
      loadEmployeeLeaves();
    } else {
      showToast(data.error || 'Gagal mengirim pengajuan', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan server', 'error');
  }
});

async function loadEmployeeLeaves() {
  const tbody = document.getElementById('table-emp-leaves');
  tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Memuat data...</td></tr>`;

  try {
    const res = await fetch('/api/leaves');
    const data = await res.json();

    if (!data.success || !data.leaves || data.leaves.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Belum ada permohonan izin/dispensasi.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.leaves.map(l => {
      const statusBadge = l.status === 'approved' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">Disetujui Sekolah</span>' :
                          l.status === 'rejected' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">Ditolak</span>' :
                          '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Menunggu</span>';

      const typeLabel = l.type === 'sick' ? 'Sakit' : l.type === 'dispensation' ? 'Dispensasi Lomba' : 'Izin Orang Tua';

      return `
        <tr class="hover:bg-slate-50 transition text-xs">
          <td class="p-3 text-slate-500">${l.created_at.split(' ')[0]}</td>
          <td class="p-3 font-semibold text-slate-800">${typeLabel}</td>
          <td class="p-3 font-mono">${l.start_date} s/d ${l.end_date}</td>
          <td class="p-3">${l.reason}</td>
          <td class="p-3">${statusBadge}</td>
          <td class="p-3 text-slate-600">${l.admin_notes || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Gagal memuat permohonan.</td></tr>`;
  }
}

// ========================================================
// ADMIN & KEPALA SEKOLAH PORTAL LOGIC
// ========================================================

function placeClockPanelInAdminView() {
  const clockPanel = document.getElementById('panel-emp-clock');
  const scanPanel = document.getElementById('panel-emp-scan');
  const container = document.getElementById('admin-myclock-container');
  container.appendChild(clockPanel);
  if (scanPanel) container.appendChild(scanPanel);

  // Default: tampilkan panel status, sembunyikan scanner
  clockPanel.classList.remove('hidden');
  if (scanPanel) scanPanel.classList.add('hidden');
  renderMyQrCode();
  applyScanPermissionUi();
  lookupStudentQr();
}

function switchAdminTab(tabName) {
  document.querySelectorAll('.tab-btn-adm').forEach(b => {
    b.classList.remove('active');
    b.classList.add('text-slate-500');
  });

  const activeBtn = document.getElementById(`tab-adm-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.classList.remove('text-slate-500');
  }

  document.getElementById('panel-adm-dash').classList.toggle('hidden', tabName !== 'dash');
  document.getElementById('panel-adm-myclock').classList.toggle('hidden', tabName !== 'myclock');
  document.getElementById('panel-adm-today').classList.toggle('hidden', tabName !== 'today');
  document.getElementById('panel-adm-report').classList.toggle('hidden', tabName !== 'report');
  document.getElementById('panel-adm-leaves').classList.toggle('hidden', tabName !== 'leaves');
  document.getElementById('panel-adm-emp').classList.toggle('hidden', tabName !== 'emp');
  document.getElementById('panel-adm-settings').classList.toggle('hidden', tabName !== 'settings');

  // Animasi masuk panel admin yang aktif
  const admPanel = document.getElementById(`panel-adm-${tabName}`);
  if (admPanel) {
    admPanel.classList.remove('panel-enter');
    void admPanel.offsetWidth; // restart animation
    admPanel.classList.add('panel-enter');
  }

  if (tabName === 'myclock') {
    placeClockPanelInAdminView();
    document.getElementById('panel-emp-clock').classList.remove('hidden');
    initGeolocation();
    loadTodayAttendance();
    if (state.maps.emp) setTimeout(() => state.maps.emp.invalidateSize(), 300);
  } else {
    stopQrScanner();
  }



  if (tabName === 'dash') loadAdminDashboard();
  if (tabName === 'today') loadAdminTodayAttendance();
  if (tabName === 'report') loadAdminReport();
  if (tabName === 'leaves') loadAdminLeaves();
  if (tabName === 'emp') loadAdminEmployees();
  if (tabName === 'settings') loadAdminSettingsForm();
}

document.getElementById('tab-adm-dash').addEventListener('click', () => switchAdminTab('dash'));
document.getElementById('tab-adm-myclock').addEventListener('click', () => switchAdminTab('myclock'));

// Tombol "Buka Scanner QR": guru/admin -> scanner (Scan Masuk/Pulang); siswa tidak melihat tombol ini
document.getElementById('btn-go-qr-tab').addEventListener('click', () => {
  const role = state.currentUser ? state.currentUser.role : null;

  if (role === 'student') return;

  if (role === 'admin') {
    const scanPanel = document.getElementById('panel-emp-scan');
    const clockPanel = document.getElementById('panel-emp-clock');
    if (!scanPanel) return;
    clockPanel.classList.add('hidden');
    scanPanel.classList.remove('hidden');
    scanPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    switchEmployeeTab('scan');
  }
});

// Tombol "Perlihatkan QR Murid yang Terdaftar" (khusus guru & admin)
document.getElementById('btn-show-student-qr').addEventListener('click', openStudentQrModal);
document.getElementById('btn-close-student-qr').addEventListener('click', () => {
  document.getElementById('modal-student-qr').classList.add('hidden');
});
document.getElementById('btn-close-student-qr-2').addEventListener('click', () => {
  document.getElementById('modal-student-qr').classList.add('hidden');
});
document.getElementById('btn-print-all-student-qr').addEventListener('click', printAllStudentQr);

// Cari murid di modal (debounce)
let studentQrModalSearchTimer = null;
document.getElementById('student-qr-modal-search').addEventListener('input', () => {
  clearTimeout(studentQrModalSearchTimer);
  studentQrModalSearchTimer = setTimeout(() => buildStudentQrGrid(document.getElementById('student-qr-modal-search').value), 250);
});

// Tutup modal dengan Escape & klik luar
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = document.getElementById('modal-student-qr');
    if (m) m.classList.add('hidden');
  }
});
document.getElementById('modal-student-qr').addEventListener('click', e => {
  if (e.target.id === 'modal-student-qr') e.target.classList.add('hidden');
});
document.getElementById('tab-adm-today').addEventListener('click', () => switchAdminTab('today'));
document.getElementById('tab-adm-report').addEventListener('click', () => switchAdminTab('report'));
document.getElementById('tab-adm-leaves').addEventListener('click', () => switchAdminTab('leaves'));
document.getElementById('tab-adm-emp').addEventListener('click', () => switchAdminTab('emp'));
document.getElementById('tab-adm-settings').addEventListener('click', () => switchAdminTab('settings'));

// 1. Dashboard KPI & Chart Sekolah
async function loadAdminDashboard() {
  try {
    const res = await fetch('/api/attendance/stats');
    const data = await res.json();
    if (!data.success) return;

    const stats = data.stats;
    document.getElementById('kpi-total-emp').textContent = stats.totalAll;
    document.getElementById('kpi-sub-total').textContent = `${stats.totalStudents} Siswa • ${stats.totalTeachers} Guru/Staf`;
    document.getElementById('kpi-present').textContent = stats.present;
    document.getElementById('kpi-late').textContent = stats.late;
    document.getElementById('kpi-excused').textContent = stats.excused;
    document.getElementById('kpi-absent').textContent = stats.absent;

    loadRecentActivities();
  } catch (err) {
    console.error('Gagal memuat data dashboard:', err);
  }
}

async function loadRecentActivities() {
  const container = document.getElementById('dash-recent-activities');
  try {
    const res = await fetch('/api/attendance/all');
    const data = await res.json();

    if (!data.success || !data.attendances || data.attendances.length === 0) {
      container.innerHTML = `<div class="text-center text-slate-400 text-xs py-8">Belum ada aktivitas presensi hari ini.</div>`;
      return;
    }

    container.innerHTML = data.attendances.slice(0, 5).map(att => {
      const isLate = att.status === 'late';
      const icon = isLate ? 'fa-clock text-amber-500 bg-amber-50' : 'fa-circle-check text-emerald-500 bg-emerald-50';
      const roleBadge = att.role === 'admin' ? '<span class="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.5 rounded">Admin</span>' :
                        att.role === 'teacher' ? '<span class="text-[9px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.5 rounded">Guru</span>' : '';

      return `
        <div class="flex items-center space-x-3 p-2.5 rounded-xl hover:bg-slate-50 transition border border-slate-100">
          <div class="w-8 h-8 rounded-lg ${icon} flex items-center justify-center text-sm font-bold">
            <i class="fa-solid ${icon.split(' ')[0]}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold text-slate-800 truncate">${att.employee_name} ${roleBadge}</div>
            <div class="text-[10px] text-slate-500">${att.department} • ${att.clock_in || '-'}</div>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isLate ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
            ${isLate ? 'Terlambat' : 'Tepat Waktu'}
          </span>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-center text-red-500 text-xs py-4">Gagal memuat aktivitas.</div>`;
  }
}

// 2. Monitoring Presensi Sekolah Hari Ini
async function loadAdminTodayAttendance() {
  const tbody = document.getElementById('table-adm-today');
  tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat presensi sekolah...</td></tr>`;

  const dept = document.getElementById('filter-today-dept').value;
  const status = document.getElementById('filter-today-status').value;
  const role = document.getElementById('filter-today-role').value;

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  try {
    const res = await fetch(`/api/attendance/all?date=${todayStr}&department=${encodeURIComponent(dept)}&status=${status}&role=${role}`);
    const data = await res.json();

    if (!data.success || !data.attendances || data.attendances.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Tidak ada data presensi yang sesuai kriteria hari ini.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.attendances.map(row => {
      const statusBadge = row.status === 'present' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">Tepat Waktu</span>' :
                          row.status === 'late' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Terlambat</span>' :
                          row.status === 'sick' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800">Sakit</span>' :
                          row.status === 'dispensation' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">Dispensasi</span>' :
                          '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">Izin</span>';

      const roleBadge = row.role === 'admin' ? '<span class="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1 rounded ml-1">Admin</span>' :
                        row.role === 'teacher' ? '<span class="text-[9px] bg-purple-100 text-purple-800 font-bold px-1 rounded ml-1">Guru</span>' : '';

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="p-3">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold"><i class="fa-solid fa-user"></i></div>
              <div>
                <div class="font-bold text-slate-900">${row.employee_name} ${roleBadge}</div>
                <div class="text-[11px] font-mono text-slate-500">${row.nip}</div>
              </div>
            </div>
          </td>
          <td class="p-3">
            <div class="text-xs font-semibold text-slate-800">${row.department}</div>
            <div class="text-[11px] text-slate-500">${row.position}</div>
          </td>
          <td class="p-3 font-mono text-xs font-bold text-slate-700">${row.clock_in || '-'}</td>
          <td class="p-3 font-mono text-xs font-bold text-slate-700">${row.clock_out || '-'}</td>
          <td class="p-3">${statusBadge}</td>
          <td class="p-3 text-xs font-semibold text-slate-600">${row.distance_in != null ? row.distance_in + ' m' : '-'}</td>
          <td class="p-3">
            <button class="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition"
              onclick="viewAttendanceDetail(${JSON.stringify(row).replace(/"/g, '&quot;')})">
              <i class="fa-solid fa-eye mr-1"></i> Detail
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Gagal memuat presensi.</td></tr>`;
  }
}

document.getElementById('filter-today-role').addEventListener('change', loadAdminTodayAttendance);
document.getElementById('filter-today-dept').addEventListener('change', loadAdminTodayAttendance);
document.getElementById('filter-today-status').addEventListener('change', loadAdminTodayAttendance);
document.getElementById('btn-refresh-today').addEventListener('click', loadAdminTodayAttendance);

// 3. Rekap & Laporan Kelas
async function loadAdminReport() {
  const monthInput = document.getElementById('report-month');
  if (!monthInput.value) {
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const tbody = document.getElementById('table-adm-report');
  tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat rekap...</td></tr>`;

  try {
    const res = await fetch(`/api/attendance/all?month=${monthInput.value}`);
    const data = await res.json();

    if (!data.success || !data.attendances || data.attendances.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Tidak ada data presensi pada bulan terpilih.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.attendances.map(r => {
      const statusBadge = r.status === 'present' ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">Tepat Waktu</span>' :
                          r.status === 'late' ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Terlambat</span>' :
                          r.status === 'sick' ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800">Sakit</span>' :
                          r.status === 'dispensation' ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">Dispensasi</span>' :
                          '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">Izin</span>';

      return `
        <tr class="hover:bg-slate-50 transition text-xs">
          <td class="p-3 font-semibold text-slate-800">${r.date}</td>
          <td class="p-3 font-bold text-slate-900">${r.employee_name} <span class="font-normal text-slate-500 font-mono">(${r.nip})</span></td>
          <td class="p-3 text-slate-600">${r.department}</td>
          <td class="p-3 font-mono">${r.clock_in || '-'}</td>
          <td class="p-3 font-mono">${r.clock_out || '-'}</td>
          <td class="p-3">${statusBadge}</td>
          <td class="p-3 text-slate-500">${r.notes || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Gagal memuat rekap.</td></tr>`;
  }
}

document.getElementById('report-month').addEventListener('change', loadAdminReport);

document.getElementById('btn-export-csv').addEventListener('click', () => {
  const month = document.getElementById('report-month').value;
  window.location.href = `/api/attendance/export?month=${month}`;
});

document.getElementById('btn-open-print-preview').addEventListener('click', async () => {
  const month = document.getElementById('report-month').value;
  const res = await fetch(`/api/attendance/all?month=${month}`);
  const data = await res.json();

  const printTable = document.getElementById('print-table-body');
  document.getElementById('print-period-title').textContent = `Periode: ${month}`;
  document.getElementById('print-generated-date').textContent = new Date().toLocaleString('id-ID');
  if (state.currentUser) document.getElementById('print-hr-name').textContent = `( ${state.currentUser.name} )`;
  if (state.officeSettings) document.getElementById('print-header-company').textContent = state.officeSettings.office_name;

  if (data.success && data.attendances && data.attendances.length > 0) {
    printTable.innerHTML = data.attendances.map((r, i) => `
      <tr>
        <td class="p-2 border-r border-slate-300 text-center">${i + 1}</td>
        <td class="p-2 border-r border-slate-300 font-mono">${r.date}</td>
        <td class="p-2 border-r border-slate-300 font-bold">${r.employee_name} <span class="font-normal text-slate-500">(${r.nip})</span></td>
        <td class="p-2 border-r border-slate-300">${r.department}</td>
        <td class="p-2 border-r border-slate-300 text-center font-mono">${r.clock_in || '-'}</td>
        <td class="p-2 border-r border-slate-300 text-center font-mono">${r.clock_out || '-'}</td>
        <td class="p-2 border-r border-slate-300 text-center">${r.status === 'present' ? 'Hadir' : r.status === 'late' ? 'Terlambat' : r.status === 'dispensation' ? 'Dispensasi' : r.status}</td>
        <td class="p-2 text-slate-600">${r.notes || '-'}</td>
      </tr>
    `).join('');
  } else {
    printTable.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">Tidak ada data untuk dicetak.</td></tr>`;
  }

  document.getElementById('modal-print-preview').classList.remove('hidden');
});

// 4. Persetujuan Izin & Dispensasi Sekolah
async function loadAdminLeaves() {
  const tbody = document.getElementById('table-adm-leaves');    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat data...</td></tr>`;

  try {
    const res = await fetch('/api/leaves');
    const data = await res.json();

    if (!data.success || !data.leaves || data.leaves.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Tidak ada permohonan izin/dispensasi.</td></tr>`;
      return;
    }

    const pending = data.leaves.filter(l => l.status === 'pending').length;
    const badge = document.getElementById('badge-pending-leaves');
    if (pending > 0) {
      badge.textContent = pending;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    tbody.innerHTML = data.leaves.map(l => {
      const statusBadge = l.status === 'approved' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">Disetujui</span>' :
                          l.status === 'rejected' ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">Ditolak</span>' :
                          '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Menunggu</span>';

      const typeLabel = l.type === 'sick' ? 'Sakit' : l.type === 'dispensation' ? 'Dispensasi Lomba' : 'Izin Orang Tua';
      const thumb = l.attachment ? `<img src="${l.attachment}" class="w-8 h-8 rounded-lg object-cover border border-slate-200 cursor-pointer" onclick="window.open('${l.attachment}')" />` : '-';

      const actionBtn = l.status === 'pending'
        ? `<button class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition" onclick="openReviewLeaveModal(${JSON.stringify(l).replace(/"/g, '&quot;')})">Tinjau</button>`
        : `<span class="text-xs text-slate-400 italic">Selesai</span>`;

      return `
        <tr class="hover:bg-slate-50 transition text-xs">
          <td class="p-3">
            <div class="font-bold text-slate-900">${l.employee_name}</div>
            <div class="text-[11px] font-mono text-slate-500">${l.nip} • ${l.department}</div>
          </td>
          <td class="p-3 font-semibold text-slate-800">${typeLabel}</td>
          <td class="p-3 font-mono">${l.start_date} s/d ${l.end_date}</td>
          <td class="p-3 text-slate-700">${l.reason}</td>
          <td class="p-3">${thumb}</td>
          <td class="p-3">${statusBadge}</td>
          <td class="p-3">${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Gagal memuat izin.</td></tr>`;
  }
}

window.openReviewLeaveModal = function(leave) {
  document.getElementById('review-leave-id').value = leave.id;
  document.getElementById('review-leave-name').textContent = `${leave.employee_name} (${leave.nip})`;
  document.getElementById('review-leave-type').textContent = leave.type === 'sick' ? 'Sakit' : leave.type === 'dispensation' ? 'Dispensasi Lomba' : 'Izin Orang Tua';
  document.getElementById('review-leave-dates').textContent = `${leave.start_date} s/d ${leave.end_date}`;
  document.getElementById('review-leave-reason').textContent = leave.reason;
  document.getElementById('review-leave-notes').value = '';

  const attachBox = document.getElementById('review-attachment-box');
  const attachImg = document.getElementById('review-attachment-img');
  if (leave.attachment) {
    attachImg.src = leave.attachment;
    attachBox.classList.remove('hidden');
  } else {
    attachBox.classList.add('hidden');
  }

  document.getElementById('modal-review-leave').classList.remove('hidden');
};

document.getElementById('btn-approve-leave').addEventListener('click', () => submitLeaveReview('approved'));
document.getElementById('btn-reject-leave').addEventListener('click', () => submitLeaveReview('rejected'));

async function submitLeaveReview(status) {
  const id = document.getElementById('review-leave-id').value;
  const admin_notes = document.getElementById('review-leave-notes').value;

  try {
    const res = await fetch(`/api/leaves/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, admin_notes })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('modal-review-leave').classList.add('hidden');
      loadAdminLeaves();
      loadAdminDashboard();
    } else {
      showToast(data.error || 'Gagal memproses permohonan', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan server', 'error');
  }
}

// 5. Data Siswa & Guru Admin
async function loadAdminEmployees() {
  const tbody = document.getElementById('table-adm-employees');
  tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Memuat warga sekolah...</td></tr>`;

  try {
    const res = await fetch('/api/employees');
    const data = await res.json();

    if (!data.success || !data.employees || data.employees.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Belum ada data warga sekolah.</td></tr>`;
      return;
    }

    const depts = [...new Set(data.employees.map(e => e.department).filter(Boolean))];
    const deptSelect = document.getElementById('filter-today-dept');
    deptSelect.innerHTML = `<option value="">Semua Kelas & Unit</option>` + depts.map(d => `<option value="${d}">${d}</option>`).join('');

    tbody.innerHTML = data.employees.map(emp => {
      const isMe = state.currentUser && state.currentUser.id === emp.id;
      const statusBadge = emp.is_active ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">Aktif</span>' : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-600">Nonaktif</span>';

      const roleBadge = emp.role === 'admin' ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-100 text-indigo-800">Kepala Sekolah / Admin</span>' :
                        emp.role === 'teacher' ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-100 text-purple-800">Guru / Staf</span>' :
                        '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">Siswa</span>';

      return `
        <tr class="hover:bg-slate-50 transition text-xs">
          <td class="p-3">
            <div class="font-bold text-slate-900">${emp.name}</div>
            <div class="font-mono text-slate-500">${emp.nip}</div>
          </td>
          <td class="p-3">
            <div class="text-slate-800">${emp.email}</div>
            <div class="text-slate-400">${emp.phone || '-'}</div>
          </td>
          <td class="p-3">
            <div class="font-semibold text-slate-800">${emp.department}</div>
            <div class="text-slate-500">${emp.position}</div>
          </td>
          <td class="p-3">${roleBadge}</td>
          <td class="p-3">${statusBadge}</td>
          <td class="p-3">
            <div class="flex items-center space-x-2">
              <button class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition"
                onclick="openEditEmployeeModal(${JSON.stringify(emp).replace(/"/g, '&quot;')})">
                <i class="fa-solid fa-pen mr-1"></i> Edit
              </button>
              ${!isMe ? `
                <button class="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-bold transition"
                  onclick="deleteEmployee(${emp.id}, '${emp.name}')">
                  <i class="fa-solid fa-trash mr-1"></i> Hapus
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Gagal memuat data warga sekolah.</td></tr>`;
  }
}

document.getElementById('btn-modal-add-emp').addEventListener('click', () => {
  document.getElementById('modal-emp-title').innerHTML = `<i class="fa-solid fa-user-plus text-blue-600"></i> <span>Tambah Siswa / Guru Baru</span>`;
  document.getElementById('form-save-employee').reset();
  document.getElementById('emp-form-id').value = '';
  document.getElementById('emp-form-nip').disabled = false;
  document.getElementById('modal-employee-form').classList.remove('hidden');
});

window.openEditEmployeeModal = function(emp) {
  document.getElementById('modal-emp-title').innerHTML = `<i class="fa-solid fa-user-pen text-blue-600"></i> <span>Edit Data Siswa / Guru</span>`;
  document.getElementById('emp-form-id').value = emp.id;
  document.getElementById('emp-form-nip').value = emp.nip;
  document.getElementById('emp-form-nip').disabled = true;
  document.getElementById('emp-form-name').value = emp.name;
  document.getElementById('emp-form-email').value = emp.email;
  document.getElementById('emp-form-password').value = '';
  document.getElementById('emp-form-dept').value = emp.department;
  document.getElementById('emp-form-position').value = emp.position;
  document.getElementById('emp-form-phone').value = emp.phone || '';
  document.getElementById('emp-form-role').value = emp.role;
  document.getElementById('modal-employee-form').classList.remove('hidden');
};

document.getElementById('form-save-employee').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('emp-form-id').value;
  const isEdit = Boolean(id);

  const payload = {
    nip: document.getElementById('emp-form-nip').value,
    name: document.getElementById('emp-form-name').value,
    email: document.getElementById('emp-form-email').value,
    password: document.getElementById('emp-form-password').value,
    department: document.getElementById('emp-form-dept').value,
    position: document.getElementById('emp-form-position').value,
    phone: document.getElementById('emp-form-phone').value,
    role: document.getElementById('emp-form-role').value
  };

  try {
    const url = isEdit ? `/api/employees/${id}` : '/api/employees';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('modal-employee-form').classList.add('hidden');
      loadAdminEmployees();
    } else {
      showToast(data.error || 'Gagal menyimpan data', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan server', 'error');
  }
});

window.deleteEmployee = async function(id, name) {
  if (!confirm(`Apakah Anda yakin ingin menghapus data "${name}"?`)) return;

  try {
    const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      loadAdminEmployees();
    } else {
      showToast(data.error || 'Gagal menghapus data', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan server', 'error');
  }
};

// 6. Pengaturan Sekolah & Peta
async function loadAdminSettingsForm() {
  await loadSettings();
  const s = state.officeSettings;
  if (!s) return;

  document.getElementById('set-office-name').value = s.office_name;
  document.getElementById('set-start-time').value = s.work_start_time;
  document.getElementById('set-end-time').value = s.work_end_time;
  document.getElementById('set-late-tolerance').value = s.late_tolerance_minutes;
  document.getElementById('set-radius').value = s.office_radius_meters;
  document.getElementById('set-lat').value = s.office_lat;
  document.getElementById('set-lng').value = s.office_lng;
  document.getElementById('set-enable-radius').checked = Boolean(s.enable_radius_restriction);

  renderAdminMap(s);
}

function renderAdminMap(settings) {
  const container = document.getElementById('admin-map');
  if (!container) return;

  if (state.maps.admin) {
    state.maps.admin.remove();
  }

  const map = L.map('admin-map').setView([settings.office_lat, settings.office_lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  let officeMarker = L.marker([settings.office_lat, settings.office_lng], { draggable: true }).addTo(map);
  let radiusCircle = L.circle([settings.office_lat, settings.office_lng], {
    color: '#2563eb',
    fillColor: '#3b82f6',
    fillOpacity: 0.15,
    radius: settings.office_radius_meters
  }).addTo(map);

  function updatePosition(lat, lng) {
    document.getElementById('set-lat').value = lat.toFixed(6);
    document.getElementById('set-lng').value = lng.toFixed(6);
    officeMarker.setLatLng([lat, lng]);
    radiusCircle.setLatLng([lat, lng]);
  }

  officeMarker.on('dragend', e => {
    const pos = e.target.getLatLng();
    updatePosition(pos.lat, pos.lng);
  });

  map.on('click', e => {
    updatePosition(e.latlng.lat, e.latlng.lng);
  });

  document.getElementById('set-radius').addEventListener('input', e => {
    const r = Number(e.target.value) || 100;
    radiusCircle.setRadius(r);
  });

  state.maps.admin = map;
}

document.getElementById('form-settings').addEventListener('submit', async e => {
  e.preventDefault();
  const payload = {
    office_name: document.getElementById('set-office-name').value,
    work_start_time: document.getElementById('set-start-time').value,
    work_end_time: document.getElementById('set-end-time').value,
    late_tolerance_minutes: document.getElementById('set-late-tolerance').value,
    office_radius_meters: document.getElementById('set-radius').value,
    office_lat: document.getElementById('set-lat').value,
    office_lng: document.getElementById('set-lng').value,
    enable_radius_restriction: document.getElementById('set-enable-radius').checked ? 1 : 0
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      state.officeSettings = data.settings;
      document.getElementById('header-office-name').textContent = data.settings.office_name;
    } else {
      showToast(data.error || 'Gagal menyimpan pengaturan', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan server', 'error');
  }
});

// ========================================================
// MODAL DETAIL PRESENSI (FOTO & GPS POPUP)
// ========================================================

window.viewAttendanceDetail = function(att) {
  const modal = document.getElementById('modal-detail-attendance');
  document.getElementById('detail-name').textContent = att.employee_name || (state.currentUser ? state.currentUser.name : '-');
  document.getElementById('detail-date').textContent = formatIndoDate(att.date);
  document.getElementById('detail-times').textContent = `Masuk: ${att.clock_in || '-'} | Pulang: ${att.clock_out || '-'}`;

  const isLate = att.status === 'late';
  const statusEl = document.getElementById('detail-status');
  statusEl.textContent = isLate ? 'Terlambat Masuk' :
                         att.status === 'present' ? 'Hadir Tepat Waktu' :
                         att.status === 'dispensation' ? 'Dispensasi Lomba' : att.status;
  statusEl.className = `font-bold ${isLate ? 'text-amber-600' : 'text-emerald-600'}`;

  document.getElementById('detail-distance').textContent = `Masuk: ${att.distance_in != null ? att.distance_in + 'm' : '-'} | Pulang: ${att.distance_out != null ? att.distance_out + 'm' : '-'}`;
  document.getElementById('detail-notes').textContent = att.notes || '-';

  modal.classList.remove('hidden');

  setTimeout(() => {
    const lat = att.lat_in || (state.officeSettings ? state.officeSettings.office_lat : -6.3614144);
    const lng = att.lng_in || (state.officeSettings ? state.officeSettings.office_lng : 107.0540305);

    if (state.maps.detail) {
      state.maps.detail.remove();
    }

    const detailMap = L.map('detail-map').setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(detailMap);

    L.marker([lat, lng]).addTo(detailMap).bindPopup('Titik Absen Masuk').openPopup();

    if (state.officeSettings) {
      L.circle([state.officeSettings.office_lat, state.officeSettings.office_lng], {
        color: '#2563eb',
        radius: state.officeSettings.office_radius_meters
      }).addTo(detailMap);
    }

    state.maps.detail = detailMap;
  }, 200);
};

// Close all modals
document.querySelectorAll('.btn-close-modal').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#modal-detail-attendance, #modal-employee-form, #modal-review-leave, #modal-print-preview').forEach(m => {
      m.classList.add('hidden');
    });
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('#modal-detail-attendance, #modal-employee-form, #modal-review-leave, #modal-print-preview').forEach(m => {
      m.classList.add('hidden');
    });
  }
});

// ========================================================
// INITIALIZATION
// ========================================================

window.addEventListener('DOMContentLoaded', () => {
  startClock();
  checkAuth();
});
