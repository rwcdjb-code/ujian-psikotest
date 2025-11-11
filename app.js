// assets/app.js
// Mengumpulkan semua fungsi yang dibutuhkan untuk index, ujian, hasil.
// Mengharapkan file config.js berisi BASE_URL

if (!window.app) window.app = {};

(function(ns) {
  // helper fetch sheet
  async function fetchSheet(sheetName) {
    const url = `${BASE_URL}?sheet=${encodeURIComponent(sheetName)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Gagal fetch sheet: ' + sheetName);
    const data = await res.json();
    return data; // returns 2D array (rows)
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ---------- Login page ----------
  ns.initLogin = function() {
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
        // ambil peserta + setting
        const pesertaRows = await fetchSheet('peserta'); // full table (header + rows)
        const settingRows = await fetchSheet('setting');

        if (!pesertaRows || pesertaRows.length < 2) throw new Error('Data peserta kosong');
        const headers = pesertaRows[0];
        const pesertaData = pesertaRows.slice(1); // rows

        // find peserta
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
        if (!matched) {
          throw new Error('Nomor peserta atau password salah!');
        }

        // check status
        if (matched.status === 'selesai' || matched.status === 'tidak selesai') {
          throw new Error('Anda sudah pernah mengikuti ujian ini.');
        }

        // check pin: mapping pin row for that participant
        // assume settingRows[0] header, then pins from row 2 correspond to peserta row 2 etc.
        let pinBenar = null;
        if (settingRows && settingRows.length >= matched.rowIndex) {
          // if settingRows has as many rows as peserta table; else try first column
          pinBenar = String(settingRows[matched.rowIndex - 1][0] ?? '').trim();
        } else if (settingRows && settingRows.length >= 2) {
          // fallback: try same index as participants by order (if not aligned)
          pinBenar = String(settingRows[1][0] ?? '').trim();
        }

        if (pinBenar && pinSesi !== pinBenar) {
          throw new Error('PIN sesi salah untuk peserta ini.');
        }

        // buat session lokal
        const sessionId = 'sess-' + Math.random().toString(36).slice(2, 10);
        const userData = { sessionId, noPeserta: matched.noPeserta, nama: matched.nama, rowIndex: matched.rowIndex };
        sessionStorage.setItem('sessionId', sessionId);
        sessionStorage.setItem('peserta', JSON.stringify(userData));

        // redirect ke Ujian
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

  // ---------- Exam page ----------
  ns.initExam = function() {
    // elements
    const namaEl = document.getElementById('namaPeserta');
    const noEl = document.getElementById('noPesertaDisplay');
    const timerEl = document.getElementById('timer');
    const kontenSoal = document.getElementById('kontenSoal');
    const pilihanContainer = document.getElementById('pilihanContainer');
    const petaSoal = document.getElementById('petaSoal');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');
    const btnSubmit = document.getElementById('btnSubmit');

    let peserta = null;
    let soalData = [];
    let currentIndex = 0;
    let jawabanPeserta = {}; // { nomorSoal: 'A' }
    let timerInterval = null;
    let sisaDetik = 0;
    let ujianTelahDisubmit = false;

    function toDisplayTime(sec) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    async function loadInitial() {
      // validate session
      const sessionId = sessionStorage.getItem('sessionId');
      const pesertaStr = sessionStorage.getItem('peserta');
      if (!sessionId || !pesertaStr) {
        // redirect to login
        window.location.href = 'index.html';
        return;
      }
      peserta = JSON.parse(pesertaStr);
      namaEl.textContent = peserta.nama;
      noEl.textContent = 'No. Peserta: ' + peserta.noPeserta;

      // load soal & waktu
      const rows = await fetchSheet('soal');
      if (!rows || rows.length < 2) {
        throw new Error('Soal kosong');
      }
      // rows is 2D array, header at 0
      const arr = rows.slice(1).map(r => ({
        no: r[0],
        pertanyaan: r[1],
        opsiA: r[2],
        opsiB: r[3],
        opsiC: r[4],
        opsiD: r[5],
        jawaban: r[6]
      }));
      // shuffle array order for exam (but keep nomor as identifier)
      soalData = shuffleArray(arr);

      // load waktu from setting? try to read 'setting' sheet first cell B? fallback 30 min
      let waktuMenit = 30;
      try {
        const setRows = await fetchSheet('setting');
        if (setRows && setRows.length >= 2) {
          // attempt: if there's a numeric in column 2 row2
          const maybe = Number(setRows[1][1]);
          if (!isNaN(maybe) && maybe > 0) waktuMenit = maybe;
        }
      } catch (e) {
        // ignore and use default
      }

      sisaDetik = waktuMenit * 60;
      startTimer();

      renderPetaSoal();
      tampilkanSoal(0);
      updateButtons();
    }

    function shuffleArray(array) {
      const arr = array.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    function startTimer() {
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        sisaDetik--;
        if (sisaDetik < 0) sisaDetik = 0;
        timerEl.textContent = toDisplayTime(sisaDetik);
        if (sisaDetik === 0) {
          // auto submit
          submitUjian('Waktu Habis!');
        }
      }, 1000);
    }

    function renderPetaSoal() {
      petaSoal.innerHTML = '';
      soalData.forEach((s, i) => {
        const b = document.createElement('button');
        b.textContent = (i + 1);
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
        btn.className = 'px-3 py-2 rounded ' + (i === currentIndex ? 'ring-4 ring-blue-300 scale-105 ' : '');
        btn.className += answered ? ' bg-green-400 text-white' : ' bg-gray-200';
      });
    }

    function tampilkanSoal(index) {
      if (index < 0 || index >= soalData.length) return;
      currentIndex = index;
      const s = soalData[index];
      document.getElementById('kontenSoal').innerHTML = `<div class="text-lg text-gray-800 mb-3">${s.pertanyaan}</div>`;
      const opsi = ['opsiA','opsiB','opsiC','opsiD'].map((k, idx) => ({ key: ['A','B','C','D'][idx], teks: s[k] })).filter(o=>o.teks && o.teks.toString().trim() !== '');
      const container = document.getElementById('pilihanContainer');
      container.innerHTML = '';
      opsi.forEach(o => {
        const div = document.createElement('div');
        const isChecked = jawabanPeserta[s.no] === o.key;
        div.className = 'p-4 rounded border ' + (isChecked ? 'border-blue-500 bg-blue-50' : 'border-gray-200');
        div.innerHTML = `<label class="flex items-start cursor-pointer">
            <input type="radio" name="jawaban" value="${o.key}" ${isChecked ? 'checked' : ''} class="mr-4 mt-1">
            <div class="flex-1">${o.key}. <span>${o.teks}</span></div>
          </label>`;
        div.addEventListener('click', () => {
          jawabanPeserta[s.no] = o.key;
          updatePetaSoal();
          tampilkanSoal(currentIndex); // rerender to show chosen style
        });
        container.appendChild(div);
      });
      updateButtons();
      updatePetaSoal();
    }

    function updateButtons() {
      btnPrev.disabled = currentIndex === 0;
      const isLast = currentIndex === (soalData.length - 1);
      btnNext.style.display = isLast ? 'none' : '';
      btnSubmit.style.display = isLast ? '' : 'none';
    }

    btnPrev.addEventListener('click', () => tampilkanSoal(currentIndex - 1));
    btnNext.addEventListener('click', () => tampilkanSoal(currentIndex + 1));
    document.getElementById('btnSubmit')?.addEventListener('click', () => {
      document.getElementById('terjawab').textContent = Object.keys(jawabanPeserta).length;
      document.getElementById('totalSoalModal').textContent = soalData.length;
      document.getElementById('modalSubmit').classList.remove('hidden');
    });
    document.getElementById('btnBatal')?.addEventListener('click', () => {
      document.getElementById('modalSubmit').classList.add('hidden');
    });
    document.getElementById('btnKonfirmasi')?.addEventListener('click', () => {
      document.getElementById('modalSubmit').classList.add('hidden');
      submitUjian();
    });

    async function submitUjian(alasan = "Ujian Selesai") {
      if (ujianTelahDisubmit) return;
      ujianTelahDisubmit = true;
      clearInterval(timerInterval);

      try {
        // compute score
        let benar = 0;
        let total = soalData.length;
        const kunci = {};
        soalData.forEach(s => {
          if (s.jawaban !== undefined && s.jawaban !== null) {
            kunci[s.no] = String(s.jawaban).trim();
          }
        });
        for (let no in jawabanPeserta) {
          const jaw = jawabanPeserta[no];
          // jawaban pada sheet mungkin berupa teks lengkap atau huruf; original mapping used A/B/C/D by comparing opsi text
          // Here we'll check: if jaw equals kunci[no] (if key is 'A'/'B'), or if kunci value equals opsi text we attempt mapping.
          const soal = soalData.find(x=>String(x.no)===String(no));
          if (!soal) continue;
          let benarHuruf = null;
          // if kunci[no] is A/B/C/D directly
          if (['A','B','C','D'].includes(String(kunci[no]))) {
            benarHuruf = kunci[no];
          } else {
            // try to find which option equals kunci[no]
            if (String(soal.opsiA) === String(kunci[no])) benarHuruf = 'A';
            else if (String(soal.opsiB) === String(kunci[no])) benarHuruf = 'B';
            else if (String(soal.opsiC) === String(kunci[no])) benarHuruf = 'C';
            else if (String(soal.opsiD) === String(kunci[no])) benarHuruf = 'D';
          }
          if (jaw === benarHuruf) benar++;
        }
        const jumlahDijawab = Object.keys(jawabanPeserta).length;
        const nilai = total > 0 ? (benar / total) * 100 : 0;

        // post to Apps Script /rekap (doPost)
        const payload = {
          noPeserta: peserta.noPeserta,
          namaPeserta: peserta.nama,
          jawaban: jawabanPeserta,
          nilai: nilai.toFixed(2)
        };

        const res = await fetch(BASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const j = await res.json();

        // store hasil in sessionStorage to show on result page
        const hasil = { nilai: nilai.toFixed(2), benar, salah: jumlahDijawab - benar, totalSoal: total };
        sessionStorage.setItem('hasilUjian', JSON.stringify(hasil));

        // mark participant status locally (note: original script updated peserta status in sheet; here we rely on re-run admin scripts or manual)
        // redirect to hasil page
        window.location.href = 'hasil.html';
      } catch (err) {
        console.error(err);
        alert('Gagal menyimpan jawaban: ' + (err.message || err));
        ujianTelahDisubmit = false;
      }
    }

    // visibility change: detect tab change -> submit
    document.addEventListener('visibilitychange', function() {
      if (document.hidden && !ujianTelahDisubmit) {
        submitUjian("Anda Beralih Tab!");
      }
    });

    // load on start
    loadInitial().catch(err => {
      console.error(err);
      alert('Terjadi kesalahan: ' + (err.message || err));
      window.location.href = 'index.html';
    });
  };

  // ---------- Result page ----------
  ns.initResult = function() {
    const hasilRaw = sessionStorage.getItem('hasilUjian');
    const pesertaRaw = sessionStorage.getItem('peserta');
    if (!hasilRaw || !pesertaRaw) {
      alert('Data hasil tidak ditemukan. Silakan login ulang.');
      window.location.href = 'index.html';
      return;
    }
    const hasil = JSON.parse(hasilRaw);
    const peserta = JSON.parse(pesertaRaw);
    // show
    document.getElementById('namaPeserta').textContent = peserta.nama;
    document.getElementById('noPeserta').textContent = peserta.noPeserta;
    document.getElementById('nilaiAkhir').textContent = hasil.nilai;
    document.getElementById('jumlahBenar').textContent = hasil.benar;
    document.getElementById('jumlahSalah').textContent = hasil.salah;
    document.getElementById('totalSoal').textContent = hasil.totalSoal;
    // progress bar (if any)
  };

  ns.logout = function() {
    sessionStorage.clear();
    window.location.href = 'index.html';
  };

})(window.app);
