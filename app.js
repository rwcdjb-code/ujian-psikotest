// assets/app.js
// Versi JSONP fix (tanpa CORS error)
// Pastikan config.js berisi: const BASE_URL = "https://script.google.com/macros/s/AKfycbxypGOydwdvhJbjB9I8y8SJw_2bPI0rxEnmDaomZdUTi5MJ3GlbyzaQvN7J_XxJkxiiPg/exec";

if (!window.app) window.app = {};

(function (ns) {

  // --- JSONP fetcher (tanpa CORS) ---
  async function fetchSheet(sheetName) {
    return new Promise((resolve, reject) => {
      const callback = 'cb_' + Math.floor(Math.random() * 1000000);
      window[callback] = function (data) {
        resolve(data);
        delete window[callback];
      };
      const script = document.createElement('script');
      script.src = `${BASE_URL}?sheet=${encodeURIComponent(sheetName)}&callback=${callback}`;
      script.onerror = () => reject(new Error('Gagal memuat data: ' + sheetName));
      document.body.appendChild(script);
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ---------- Login ----------
  ns.initLogin = function () {
    const form = document.getElementById('loginForm');
    const btnLogin = document.getElementById('btnLogin');
    const errorMsg = document.getElementById('errorMsg');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.classList.add('hidden');
      btnLogin.disabled = true;
      btnLogin.textContent = 'MEMPROSES...';

      const noPeserta = document.getElementById('noPeserta').value.trim();
      const password = document.getElementById('password').value.trim();
      const pinSesi = document.getElementById('pinSesi').value.trim();

      try {
        const pesertaRows = await fetchSheet('peserta');
        const settingRows = await fetchSheet('setting');
        if (!pesertaRows || pesertaRows.length < 2) throw new Error('Data peserta kosong');

        const headers = pesertaRows[0];
        const pesertaData = pesertaRows.slice(1);
        let matched = null;
        for (let i = 0; i < pesertaData.length; i++) {
          const row = pesertaData[i];
          const no = String(row[0] ?? '').trim();
          const nama = String(row[1] ?? '');
          const pass = String(row[2] ?? '').trim();
          const status = String(row[3] ?? '').trim();
          if (no === noPeserta && pass === password) {
            matched = { rowIndex: i + 2, noPeserta: no, nama, password: pass, status };
            break;
          }
        }
        if (!matched) throw new Error('Nomor peserta atau password salah!');
        if (matched.status === 'selesai' || matched.status === 'tidak selesai') {
          throw new Error('Anda sudah pernah mengikuti ujian ini.');
        }

        // cek pin
        let pinBenar = null;
        if (settingRows && settingRows.length >= matched.rowIndex) {
          pinBenar = String(settingRows[matched.rowIndex - 1][0] ?? '').trim();
        } else if (settingRows && settingRows.length >= 2) {
          pinBenar = String(settingRows[1][0] ?? '').trim();
        }
        if (pinBenar && pinSesi !== pinBenar) throw new Error('PIN sesi salah.');

        // buat session
        const sessionId = 'sess-' + Math.random().toString(36).slice(2, 10);
        const userData = { sessionId, noPeserta: matched.noPeserta, nama: matched.nama, rowIndex: matched.rowIndex };
        sessionStorage.setItem('sessionId', sessionId);
        sessionStorage.setItem('peserta', JSON.stringify(userData));

        window.location.href = 'ujian.html';
      } catch (err) {
        errorMsg.textContent = err.message || String(err);
        errorMsg.classList.remove('hidden');
      } finally {
        btnLogin.disabled = false;
        btnLogin.textContent = 'MULAI UJIAN';
      }
    });
  };

  // ---------- Ujian ----------
  ns.initExam = function () {
    const namaEl = document.getElementById('namaPeserta');
    const noEl = document.getElementById('noPesertaDisplay');
    const timerEl = document.getElementById('timer');
    const petaSoal = document.getElementById('petaSoal');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');
    const btnSubmit = document.getElementById('btnSubmit');

    let peserta = null;
    let soalData = [];
    let currentIndex = 0;
    let jawabanPeserta = {};
    let timerInterval = null;
    let sisaDetik = 0;
    let ujianTelahDisubmit = false;

    function toDisplayTime(sec) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    async function loadInitial() {
      const sessionId = sessionStorage.getItem('sessionId');
      const pesertaStr = sessionStorage.getItem('peserta');
      if (!sessionId || !pesertaStr) {
        window.location.href = 'index.html';
        return;
      }
      peserta = JSON.parse(pesertaStr);
      namaEl.textContent = peserta.nama;
      noEl.textContent = 'No. Peserta: ' + peserta.noPeserta;

      const rows = await fetchSheet('soal');
      if (!rows || rows.length < 2) throw new Error('Soal kosong');
      soalData = rows.slice(1).map(r => ({
        no: r[0],
        pertanyaan: r[1],
        opsiA: r[2],
        opsiB: r[3],
        opsiC: r[4],
        opsiD: r[5],
        jawaban: r[6]
      }));

      let waktuMenit = 30;
      try {
        const setRows = await fetchSheet('setting');
        if (setRows && setRows.length >= 2) {
          const maybe = Number(setRows[1][1]);
          if (!isNaN(maybe) && maybe > 0) waktuMenit = maybe;
        }
      } catch (e) { }
      sisaDetik = waktuMenit * 60;
      startTimer();
      renderPetaSoal();
      tampilkanSoal(0);
    }

    function startTimer() {
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        sisaDetik--;
        timerEl.textContent = toDisplayTime(sisaDetik);
        if (sisaDetik <= 0) submitUjian('Waktu Habis!');
      }, 1000);
    }

    function renderPetaSoal() {
      petaSoal.innerHTML = '';
      soalData.forEach((s, i) => {
        const b = document.createElement('button');
        b.textContent = i + 1;
        b.className = 'px-3 py-2 bg-gray-200 rounded';
        b.addEventListener('click', () => tampilkanSoal(i));
        petaSoal.appendChild(b);
      });
      updatePetaSoal();
    }

    function updatePetaSoal() {
      const buttons = petaSoal.querySelectorAll('button');
      buttons.forEach((btn, i) => {
        const answered = !!jawabanPeserta[soalData[i].no];
        btn.className = 'px-3 py-2 rounded ' + (i === currentIndex ? 'ring-4 ring-blue-300 ' : '');
        btn.className += answered ? ' bg-green-400 text-white' : ' bg-gray-200';
      });
    }

    function tampilkanSoal(index) {
      if (index < 0 || index >= soalData.length) return;
      currentIndex = index;
      const s = soalData[index];
      document.getElementById('kontenSoal').innerHTML = `<div class="text-lg mb-3">${s.pertanyaan}</div>`;
      const opsiKeys = ['A', 'B', 'C', 'D'];
      const container = document.getElementById('pilihanContainer');
      container.innerHTML = '';
      opsiKeys.forEach(k => {
        const teks = s['opsi' + k];
        if (!teks) return;
        const div = document.createElement('div');
        div.className = 'p-4 border rounded mb-2 ' + (jawabanPeserta[s.no] === k ? 'border-blue-500 bg-blue-50' : 'border-gray-200');
        div.innerHTML = `<label><input type="radio" name="jawaban" value="${k}" class="mr-2"> ${k}. ${teks}</label>`;
        div.addEventListener('click', () => {
          jawabanPeserta[s.no] = k;
          tampilkanSoal(currentIndex);
          updatePetaSoal();
        });
        container.appendChild(div);
      });
    }

    async function submitUjian(alasan = "Ujian Selesai") {
      if (ujianTelahDisubmit) return;
      ujianTelahDisubmit = true;
      clearInterval(timerInterval);
      try {
        let benar = 0;
        soalData.forEach(s => {
          const jaw = jawabanPeserta[s.no];
          if (!jaw) return;
          if (String(jaw).trim() === String(s.jawaban).trim()) benar++;
        });
        const nilai = soalData.length ? (benar / soalData.length) * 100 : 0;
        const payload = {
          noPeserta: peserta.noPeserta,
          namaPeserta: peserta.nama,
          jawaban: jawabanPeserta,
          nilai: nilai.toFixed(2)
        };
        await fetch(BASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        sessionStorage.setItem('hasilUjian', JSON.stringify({ nilai: nilai.toFixed(2), benar, totalSoal: soalData.length }));
        window.location.href = 'hasil.html';
      } catch (err) {
        alert('Gagal menyimpan jawaban: ' + err.message);
        ujianTelahDisubmit = false;
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !ujianTelahDisubmit) submitUjian("Keluar dari tab!");
    });

    btnPrev.addEventListener('click', () => tampilkanSoal(currentIndex - 1));
    btnNext.addEventListener('click', () => tampilkanSoal(currentIndex + 1));
    btnSubmit.addEventListener('click', () => submitUjian());

    loadInitial().catch(err => {
      alert('Error: ' + err.message);
      window.location.href = 'index.html';
    });
  };

  // ---------- Hasil ----------
  ns.initResult = function () {
    const hasilRaw = sessionStorage.getItem('hasilUjian');
    const pesertaRaw = sessionStorage.getItem('peserta');
    if (!hasilRaw || !pesertaRaw) {
      alert('Data hasil tidak ditemukan.');
      window.location.href = 'index.html';
      return;
    }
    const hasil = JSON.parse(hasilRaw);
    const peserta = JSON.parse(pesertaRaw);
    document.getElementById('namaPeserta').textContent = peserta.nama;
    document.getElementById('noPeserta').textContent = peserta.noPeserta;
    document.getElementById('nilaiAkhir').textContent = hasil.nilai;
    document.getElementById('jumlahBenar').textContent = hasil.benar;
    document.getElementById('totalSoal').textContent = hasil.totalSoal;
  };

  ns.logout = function () {
    sessionStorage.clear();
    window.location.href = 'index.html';
  };

})(window.app);
