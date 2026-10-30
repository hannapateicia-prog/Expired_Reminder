(() => {
  'use strict';

  /* ---------- 1. Konfigurasi ---------- */
  const CONFIG = {
    keys: { items: 'kadaluwarsa', settings: 'kadaluwarsa-set', sent: 'kadaluwarsa-sent' },
    checkEveryMs: 30 * 60 * 1000,
    toastMs: 7000,
    maxNotifNames: 3,
  };

  /* ---------- 2. Utilitas ---------- */
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  /** Membuat elemen dengan kelas dan teks (aman dari injeksi HTML). */
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** Pembungkus localStorage yang aman jika penyimpanan diblokir. */
  const store = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* abaikan */ }
    },
  };

  const dateUtil = {
    parse(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); },
    toISO(date) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },
    daysLeft(iso) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return Math.round((this.parse(iso) - today) / 86400000);
    },
    format(iso) {
      return this.parse(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    },
  };

  /* ---------- 3. State ---------- */
  const state = {
    items: [],
    settings: { days: 3 },
    filter: 'semua',
    query: '',
    sort: 'tanggal',
    editingId: null,
    toastTimer: null,
  };

  const loadState = () => {
    const items = store.read(CONFIG.keys.items, []);
    state.items = Array.isArray(items) ? items : [];
    Object.assign(state.settings, store.read(CONFIG.keys.settings, {}));
  };
  const saveItems = () => store.write(CONFIG.keys.items, state.items);

  /* ---------- 4. Status makanan ---------- */
  /** Mengubah sisa hari menjadi status: kunci filter, nada warna, dan label. */
  function statusOf(days) {
    if (days < 0) return { key: 'lewat', tone: 'bad', label: `Kadaluwarsa ${Math.abs(days)} hari lalu` };
    if (days === 0) return { key: 'segera', tone: 'warn', label: 'Kadaluwarsa hari ini' };
    if (days <= state.settings.days) return { key: 'segera', tone: 'warn', label: `Segera: ${days} hari lagi` };
    return { key: 'aman', tone: 'ok', label: `Aman: ${days} hari lagi` };
  }

  const describe = (item) => {
    const n = dateUtil.daysLeft(item.tgl);
    const when = n < 0 ? 'sudah kadaluwarsa' : n === 0 ? 'hari ini' : `${n} hari lagi`;
    return `${item.nama} (${when})`;
  };

  /* ---------- 5. Notifikasi ---------- */
  const notifSupported = 'Notification' in window;

  function showToast(text, action) {
    $('#toast-text').textContent = text;
    const button = $('#toast-action');
    button.hidden = !action;
    button.onclick = action ? () => { action.run(); hideToast(); } : null;
    $('#toast').hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(hideToast, CONFIG.toastMs);
  }
  const hideToast = () => { $('#toast').hidden = true; };

  function updateNotifStatus() {
    const pill = $('#notif-status');
    let text = 'Belum diaktifkan', tone = 'warn';
    if (!notifSupported) text = 'Tidak didukung, pengingat dalam halaman tetap aktif';
    else if (Notification.permission === 'granted') { text = 'Aktif'; tone = 'ok'; }
    else if (Notification.permission === 'denied') { text = 'Diblokir di browser'; tone = 'bad'; }
    pill.textContent = text;
    pill.className = `pill pill--${tone}`;
  }

  /** Selalu menampilkan toast; menambah notifikasi sistem bila diizinkan. */
  function notify(title, body) {
    showToast(`${title}: ${body}`);
    if (notifSupported && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, tag: 'kadaluwarsa' });
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* abaikan */ }
    }
  }

  const summarize = (list) => {
    const names = list.slice(0, CONFIG.maxNotifNames).map(describe).join(', ');
    const rest = list.length - CONFIG.maxNotifNames;
    return rest > 0 ? `${names}, dan ${rest} lainnya` : names;
  };

  const urgentItems = () => state.items
    .filter((i) => dateUtil.daysLeft(i.tgl) <= state.settings.days)
    .sort((a, b) => dateUtil.parse(a.tgl) - dateUtil.parse(b.tgl));

  /** Memeriksa makanan yang perlu perhatian; satu kali per makanan per hari. */
  function checkReminders() {
    const today = dateUtil.toISO(new Date());
    let sent = store.read(CONFIG.keys.sent, {});
    if (sent.hari !== today) sent = { hari: today, ids: [] };
    const due = urgentItems().filter((i) => !sent.ids.includes(i.id));
    if (!due.length) return;
    notify(`${due.length} makanan perlu perhatian`, summarize(due));
    sent.ids = sent.ids.concat(due.map((i) => i.id));
    store.write(CONFIG.keys.sent, sent);
  }

  async function enableNotifications() {
    if (!notifSupported) return showToast('Browser ini tidak mendukung notifikasi sistem. Pengingat tetap tampil di halaman.');
    if (Notification.permission === 'denied') return showToast('Notifikasi diblokir. Izinkan lewat pengaturan situs di browser, lalu muat ulang.');
    try { await Notification.requestPermission(); } catch { /* abaikan */ }
    updateNotifStatus();
    if (Notification.permission === 'granted') notify('Notifikasi aktif', 'Anda akan diingatkan sebelum makanan kadaluwarsa.');
  }

  /* ---------- 6. Tampilan ---------- */
  function visibleItems(enriched) {
    const q = state.query.toLowerCase();
    const list = enriched.filter((i) =>
      (state.filter === 'semua' || i.status.key === state.filter) &&
      (!q || `${i.nama} ${i.lokasi}`.toLowerCase().includes(q)));
    const sorters = {
      tanggal: (a, b) => dateUtil.parse(a.tgl) - dateUtil.parse(b.tgl),
      nama: (a, b) => a.nama.localeCompare(b.nama, 'id'),
      terbaru: (a, b) => b.id - a.id,
    };
    return list.sort(sorters[state.sort]);
  }

  function renderBanner(counts) {
    const banner = $('#banner');
    const { lewat, segera } = counts;
    banner.className = 'banner' + (lewat ? ' banner--bad' : segera ? ' banner--warn' : '');
    if (!state.items.length) banner.textContent = 'Belum ada makanan yang dicatat.';
    else if (lewat) banner.textContent = `${lewat} makanan sudah kadaluwarsa` +
      (segera ? ` dan ${segera} lagi segera kadaluwarsa.` : '. Segera periksa dan buang.');
    else if (segera) banner.textContent = `${segera} makanan segera kadaluwarsa. Gunakan lebih dulu.`;
    else banner.textContent = 'Semua makanan masih aman.';
  }

  function renderItem(item) {
    const li = make('li', 'item');
    const main = make('div', 'item__main');
    const name = make('div', 'item__name', item.nama);
    if (item.qty > 1) name.append(make('span', 'item__qty', ` ×${item.qty}`));
    main.append(
      name,
      make('div', 'item__meta', `${item.lokasi} • ${dateUtil.format(item.tgl)}`),
      make('span', `badge badge--${item.status.tone}`, item.status.label),
    );

    const actions = make('div', 'item__actions');
    [['edit', 'Ubah', `Ubah ${item.nama}`], ['done', 'Selesai', `Hapus ${item.nama} dari daftar`]]
      .forEach(([action, label, aria]) => {
        const btn = make('button', 'link-btn', label);
        btn.type = 'button';
        btn.dataset.action = action;
        btn.dataset.id = item.id;
        btn.setAttribute('aria-label', aria);
        actions.append(btn);
      });
    li.append(main, actions);
    return li;
  }

  function render() {
    const enriched = state.items.map((i) => ({ ...i, status: statusOf(dateUtil.daysLeft(i.tgl)) }));
    const counts = { semua: enriched.length, aman: 0, segera: 0, lewat: 0 };
    enriched.forEach((i) => counts[i.status.key]++);

    Object.entries(counts).forEach(([key, n]) => { $(`#count-${key}`).textContent = n; });
    $$('.stat').forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === state.filter));
    renderBanner(counts);

    const shown = visibleItems(enriched);
    const list = $('#items');
    list.replaceChildren();
    if (!shown.length) {
      list.append(make('li', 'empty', state.items.length
        ? 'Tidak ada makanan yang cocok dengan pencarian atau filter.'
        : 'Belum ada data. Tambahkan makanan pertama Anda di formulir.'));
    } else shown.forEach((i) => list.append(renderItem(i)));

    $('#status-note').textContent = `Status “Segera” berlaku untuk makanan yang kadaluwarsa dalam ${state.settings.days} hari.`;
    $('#clear-expired-btn').hidden = !counts.lewat;
    const urgent = counts.lewat + counts.segera;
    document.title = `${urgent ? `(${urgent}) ` : ''}Pengingat Kadaluwarsa`;
    const badge = $('#tab-badge');
    badge.textContent = urgent;
    badge.hidden = !urgent;
  }

  /* ---------- 7. Aksi ---------- */
  const form = $('#food-form');

  /** Berpindah tab: daftar, tambah, atau notif (laptop dan HP). */
  function setTab(name) {
    $('.app').dataset.tab = name;
    $$('.tabbar__btn').forEach((b) => {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0 });
  }

  function resetForm() {
    state.editingId = null;
    form.reset();
    $('#qty').value = 1;
    $('#form-title').textContent = 'Tambah makanan';
    $('#submit-btn').textContent = 'Simpan makanan';
    $('#cancel-btn').hidden = true;
    $('#form-error').textContent = '';
  }

  function startEdit(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    state.editingId = id;
    $('#nama').value = item.nama;
    $('#tgl').value = item.tgl;
    $('#qty').value = item.qty || 1;
    $('#lokasi').value = item.lokasi;
    $('#form-title').textContent = 'Ubah makanan';
    $('#submit-btn').textContent = 'Simpan perubahan';
    $('#cancel-btn').hidden = false;
    setTab('tambah');
    $('#nama').focus();
  }

  function submitForm(event) {
    event.preventDefault();
    const data = {
      nama: $('#nama').value.trim(),
      tgl: $('#tgl').value,
      qty: parseInt($('#qty').value, 10),
      lokasi: $('#lokasi').value,
    };
    const error = $('#form-error');
    if (!data.nama) return void (error.textContent = 'Isi nama makanan.');
    if (!data.tgl) return void (error.textContent = 'Pilih tanggal kadaluwarsa.');
    if (Number.isNaN(data.qty) || data.qty < 1) return void (error.textContent = 'Jumlah minimal 1.');

    if (state.editingId) {
      state.items = state.items.map((i) => (i.id === state.editingId ? { ...i, ...data } : i));
      showToast(`${data.nama} diperbarui.`);
    } else {
      state.items.push({ id: Date.now(), ...data });
      showToast(`${data.nama} ditambahkan.`);
    }
    saveItems();
    resetForm();
    render();
    checkReminders();
    setTab('daftar');
  }

  function removeItem(id) {
    const index = state.items.findIndex((i) => i.id === id);
    if (index < 0) return;
    const [removed] = state.items.splice(index, 1);
    saveItems();
    render();
    showToast(`${removed.nama} dihapus.`, {
      run() { state.items.splice(index, 0, removed); saveItems(); render(); },
    });
  }

  function clearExpired() {
    if (!confirm('Hapus semua makanan yang sudah kadaluwarsa dari daftar?')) return;
    state.items = state.items.filter((i) => dateUtil.daysLeft(i.tgl) >= 0);
    saveItems();
    render();
  }

  /* ---------- 8. Event ---------- */
  function bindEvents() {
    form.addEventListener('submit', submitForm);
    $('#add-btn').addEventListener('click', () => { resetForm(); setTab('tambah'); $('#nama').focus(); });
    $('#cancel-btn').addEventListener('click', () => { resetForm(); setTab('daftar'); });
    $$('.tabbar__btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

    $$('.chip').forEach((chip) => chip.addEventListener('click', () => {
      const date = new Date();
      date.setDate(date.getDate() + parseInt(chip.dataset.days, 10));
      $('#tgl').value = dateUtil.toISO(date);
    }));

    $$('.stat').forEach((btn) => btn.addEventListener('click', () => { state.filter = btn.dataset.filter; render(); }));
    $('#search').addEventListener('input', (e) => { state.query = e.target.value.trim(); render(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

    $('#items').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (btn.dataset.action === 'edit') startEdit(id);
      else removeItem(id);
    });

    $('#clear-expired-btn').addEventListener('click', clearExpired);

    $('#days').addEventListener('change', (e) => {
      state.settings.days = parseInt(e.target.value, 10);
      store.write(CONFIG.keys.settings, state.settings);
      render();
      checkReminders();
    });
    $('#enable-btn').addEventListener('click', enableNotifications);
    $('#test-btn').addEventListener('click', () => {
      const list = urgentItems();
      notify('Coba notifikasi', list.length ? summarize(list) : 'Belum ada makanan yang hampir kadaluwarsa.');
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { render(); checkReminders(); }
    });
  }

  /* ---------- 9. Inisialisasi ---------- */
  function init() {
    loadState();
    $('#days').value = String(state.settings.days);
    bindEvents();
    updateNotifStatus();
    render();
    checkReminders();
    setInterval(() => { render(); checkReminders(); }, CONFIG.checkEveryMs);
  }

  init();
})();
