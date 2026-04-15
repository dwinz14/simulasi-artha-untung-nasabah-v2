/**
 * simulasi-custom.js
 * Modul Simulasi Deposito Khusus — BPR Artha Pamenang
 *
 * Modul ini bersifat mandiri (self-contained). Ia meng-inject markup HTML
 * ke dalam elemen #panel-custom yang ada di index.html, kemudian mengelola
 * seluruh interaksi dan logika perhitungan secara terisolasi.
 *
 * ──────────────────────────────────────────────
 * STANDAR PERHITUNGAN (sesuai konvensi deposito BPR)
 * ──────────────────────────────────────────────
 *   Hari          = Tenor (Bulan) × 30
 *   Bunga Kotor   = Pokok × (Suku Bunga p.a. / 100) × (Hari / 365)
 *   Pajak Bunga   = Bunga Kotor × 20%
 *   Bunga Bersih  = Bunga Kotor × 80%
 *   Per Bulan     = Bunga Bersih / Tenor (Bulan)
 *   Min. Pokok    = Rp 8.000.000
 * ──────────────────────────────────────────────
 */

(function () {
  "use strict";

  /* ═══════════════════════════════════════════
     KONSTANTA & KONFIGURASI
     ═══════════════════════════════════════════ */

  /** Batas minimum setoran awal (Rp) */
  const MIN_NOMINAL = 8_000_000;

  /** Batas suku bunga yang dapat diterima (%) */
  const MIN_BUNGA = 0.01;
  const MAX_BUNGA = 99.99;

  /** Batas jangka waktu yang dapat diterima (bulan) */
  const MIN_TENOR = 1;
  const MAX_TENOR = 60;

  /** Tarif pajak bunga deposito (PPh Final) */
  const TARIF_PAJAK = 0.2;

  /** Basis hari per tahun dan per bulan */
  const HARI_PER_TAHUN = 365;
  const HARI_PER_BULAN = 30;

  /**
   * Data preset produk deposito.
   * Sesuai regulasi bunga yang berlaku saat ini.
   * Untuk menambah/ubah preset, cukup edit array ini.
   */
  const PRESETS = [
    { id: "pre-5_50-3", rate: 5.5, bulan: 3, labelRate: "5,50%", labelTenor: "3 Bulan" },
    { id: "pre-5_50-6", rate: 5.5, bulan: 6, labelRate: "5,50%", labelTenor: "6 Bulan" },
    { id: "pre-5_75-3", rate: 5.75, bulan: 3, labelRate: "5,75%", labelTenor: "3 Bulan" },
    { id: "pre-5_75-6", rate: 5.75, bulan: 6, labelRate: "5,75%", labelTenor: "6 Bulan" },
    { id: "pre-6_00-3", rate: 6.0, bulan: 3, labelRate: "6,00%", labelTenor: "3 Bulan" },
    { id: "pre-6_00-6", rate: 6.0, bulan: 6, labelRate: "6,00%", labelTenor: "6 Bulan" },
  ];

  /* ═══════════════════════════════════════════
     STATE INTERNAL
     ═══════════════════════════════════════════ */
  let rawNominal = MIN_NOMINAL; // angka murni nominal (integer)
  let rawBunga = 0; // angka murni suku bunga (float, dalam %)
  let rawTenor = 0; // angka murni tenor (integer, dalam bulan)
  let debouncer = null; // timer debounce untuk kalkulasi otomatis

  /* ═══════════════════════════════════════════
     HELPER FUNCTIONS
     ═══════════════════════════════════════════ */

  /** Format angka ke rupiah: Rp 8.000.000 */
  const fmt = (n) => "Rp\u00A0" + Math.trunc(n).toLocaleString("id-ID");

  /** Format angka dengan pemisah ribuan untuk display input */
  const fmtDisp = (n) => n.toLocaleString("id-ID");

  /** Format suku bunga: "5,75% p.a." */
  const fmtRate = (r) => r.toFixed(2).replace(".", ",") + "% p.a.";

  /** Ikon error SVG (inline, dipakai di beberapa tempat) */
  const ERR_ICON = /* html */ `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="#B83232" stroke-width="1.5"/>
      <path d="M8 5v3.5M8 11v.5" stroke="#B83232" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;

  /* ═══════════════════════════════════════════
     HTML BUILDER
     ═══════════════════════════════════════════ */

  /** Render tombol-tombol preset produk */
  function buildPresetButtons() {
    return PRESETS.map(
      (p) => /* html */ `
      <button
        type="button"
        class="preset-btn"
        data-rate="${p.rate}"
        data-bulan="${p.bulan}"
        id="${p.id}"
        aria-pressed="false"
        title="Bunga ${p.labelRate} selama ${p.labelTenor}"
      >
        <span class="p-rate">${p.labelRate}</span>
        <span class="p-tenor">${p.labelTenor}</span>
      </button>`,
    ).join("");
  }

  /** Markup lengkap modul (form + result + disclaimer) */
  function buildModuleHTML() {
    return /* html */ `
      <!-- ── Form Card Khusus ── -->
      <div class="form-card">
        <h2>Detail Penempatan</h2>
        <form id="customForm" novalidate>

          <!-- ─ Setoran Awal ─ -->
          <div class="field" id="c-field-nominal">
            <label for="c-nominal">
              Setoran Awal
              <span class="required-dot" aria-hidden="true"></span>
            </label>
            <div class="input-wrap">
              <span class="input-prefix" aria-hidden="true">Rp</span>
              <input
                type="text"
                id="c-nominal"
                name="c-nominal"
                value="8.000.000"
                autocomplete="off"
                inputmode="numeric"
                placeholder="0"
                aria-describedby="c-nominal-hint c-nominal-error"
                aria-required="true"
              />
            </div>
            <p id="c-nominal-hint" class="field-hint">Minimum penempatan Rp 8.000.000</p>
            <p id="c-nominal-error" class="field-error" role="alert" aria-live="polite">
              ${ERR_ICON} Setoran awal minimal Rp 8.000.000
            </p>
          </div>

          <!-- ─ Preset Produk ─ -->
          <div class="field">
            <label>
              Pilihan Produk
              <span class="required-dot" aria-hidden="true"></span>
            </label>
            <p class="field-hint c-preset-hint">Pilih preset atau isi bunga &amp; jangka waktu secara manual</p>
            <div
              class="preset-grid"
              role="group"
              aria-label="Pilih preset produk deposito khusus"
            >
              ${buildPresetButtons()}
            </div>
          </div>

          <!-- ─ Input Manual: Bunga & Tenor (2 kolom) ─ -->
          <div class="custom-inputs-row">

            <!-- Suku Bunga -->
            <div class="field" id="c-field-bunga">
              <label for="c-bunga">
                Suku Bunga
                <span class="required-dot" aria-hidden="true"></span>
              </label>
              <div class="input-wrap">
                <input
                  type="text"
                  id="c-bunga"
                  name="c-bunga"
                  autocomplete="off"
                  inputmode="decimal"
                  placeholder="0,00"
                  class="c-input-suffix-pad"
                  aria-describedby="c-bunga-hint c-bunga-error"
                  aria-required="true"
                />
                <span class="input-suffix" aria-hidden="true">% p.a.</span>
              </div>
              <p id="c-bunga-hint" class="field-hint">Contoh: 5,5 atau 5.75</p>
              <p id="c-bunga-error" class="field-error" role="alert" aria-live="polite">
                ${ERR_ICON} Masukkan bunga 0,01 – 99,99%
              </p>
            </div>

            <!-- Jangka Waktu -->
            <div class="field" id="c-field-tenor">
              <label for="c-tenor">
                Jangka Waktu
                <span class="required-dot" aria-hidden="true"></span>
              </label>
              <div class="input-wrap">
                <input
                  type="text"
                  id="c-tenor"
                  name="c-tenor"
                  autocomplete="off"
                  inputmode="numeric"
                  placeholder="0"
                  class="c-input-suffix-pad"
                  aria-describedby="c-tenor-hint c-tenor-error"
                  aria-required="true"
                />
                <span class="input-suffix" aria-hidden="true">Bln</span>
              </div>
              <p id="c-tenor-hint" class="field-hint">1 – 60 bulan</p>
              <p id="c-tenor-error" class="field-error" role="alert" aria-live="polite">
                ${ERR_ICON} Masukkan 1 – 60 bulan
              </p>
            </div>

          </div><!-- /.custom-inputs-row -->

        </form>
      </div><!-- /.form-card -->

      <!-- ── Result Panel ── -->
      <section
        id="c-result"
        class="result-panel"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Hasil simulasi deposito khusus"
      >
        <div class="result-header">
          <div class="result-header-left">
            <h3>Hasil Perhitungan</h3>
            <p>Berdasarkan data penempatan Anda</p>
          </div>
          <span class="result-badge" id="c-res-badge">— Bulan</span>
        </div>

        <div class="result-body">
          <!-- Dana Penempatan -->
          <div class="result-section">
            <p class="result-section-label">Dana Penempatan</p>
            <div class="result-row">
              <span class="rr-label">
                <span class="dot dot-navy" aria-hidden="true"></span>Setoran Awal
              </span>
              <span class="rr-value highlight" id="c-res-nominal">—</span>
            </div>
            <div class="result-row">
              <span class="rr-label">
                <span class="dot dot-navy" aria-hidden="true"></span>Suku Bunga
              </span>
              <span class="rr-value" id="c-res-rate">—</span>
            </div>
          </div>

          <!-- Bunga Bersih -->
          <div class="result-section">
            <p class="result-section-label">Bunga</p>
            <div class="result-row">
              <span class="rr-label">
                <span class="dot dot-gold" aria-hidden="true"></span>Per Bulan
              </span>
              <span class="rr-value green" id="c-res-bulan">—</span>
            </div>
            <div class="result-row">
              <span class="rr-label">
                <span class="dot dot-gold" aria-hidden="true"></span>
                Total <span id="c-res-tenor-label">—</span> Bulan
              </span>
              <span class="rr-value green highlight" id="c-res-total">—</span>
            </div>
          </div>
        </div>
      </section><!-- /#c-result -->

      <!-- ── Disclaimer Khusus ── -->
      <div class="disclaimer" role="note" aria-label="Catatan simulasi khusus">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" stroke="#8095AB" stroke-width="1.4"/>
          <path d="M8 7v4M8 5.5V5" stroke="#8095AB" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <p>
          Simulasi ini bersifat indikatif. Perhitungan menggunakan asumsi.
          Angka aktual dapat berbeda sesuai kebijakan yang berlaku.
        </p>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════
     MOUNT: INJECT KE DOM
     ═══════════════════════════════════════════ */
  function mount() {
    const container = document.getElementById("panel-custom");
    if (!container) {
      console.warn("[simulasi-custom] Elemen #panel-custom tidak ditemukan.");
      return;
    }
    container.innerHTML = buildModuleHTML();
    bindEvents();
  }

  /* ═══════════════════════════════════════════
     KALKULASI
     ═══════════════════════════════════════════ */

  /**
   * Jalankan perhitungan dan render hasil ke panel result.
   * Hanya dipanggil jika semua input sudah lolos validasi.
   */
  function customCalculate() {
    /* Guard: pastikan semua nilai dalam rentang yang sah */
    if (rawNominal < MIN_NOMINAL) return;
    if (rawBunga < MIN_BUNGA || rawBunga > MAX_BUNGA) return;
    if (rawTenor < MIN_TENOR || rawTenor > MAX_TENOR) return;

    /* ── Rumus perhitungan ── */
    const hari = rawTenor * HARI_PER_BULAN;
    const bungaKotor = rawNominal * (rawBunga / 100) * (hari / HARI_PER_TAHUN);
    const bungaBersih = bungaKotor * (1 - TARIF_PAJAK);
    const bungaPerBulan = bungaBersih / rawTenor;

    /* ── Render ke DOM ── */
    document.getElementById("c-res-badge").textContent = rawTenor + " Bulan";
    document.getElementById("c-res-nominal").textContent = fmt(rawNominal);
    document.getElementById("c-res-rate").textContent = fmtRate(rawBunga);
    document.getElementById("c-res-tenor-label").textContent = rawTenor;
    document.getElementById("c-res-bulan").textContent = fmt(bungaPerBulan);
    document.getElementById("c-res-total").textContent = fmt(bungaBersih);

    /* ── Tampilkan panel jika belum terlihat ── */
    const resultEl = document.getElementById("c-result");
    if (!resultEl.classList.contains("visible")) {
      resultEl.classList.add("visible");
      setTimeout(() => resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
    }
  }

  /** Coba kalkulasi jika semua kondisi terpenuhi (dipanggil dari debouncer) */
  function tryCalculate() {
    if (rawNominal >= MIN_NOMINAL && rawBunga >= MIN_BUNGA && rawBunga <= MAX_BUNGA && rawTenor >= MIN_TENOR && rawTenor <= MAX_TENOR) {
      customCalculate();
    }
  }

  /* ═══════════════════════════════════════════
     VALIDASI
     ═══════════════════════════════════════════ */

  /**
   * Toggle kelas .invalid pada input dan .visible pada pesan error.
   * @param {HTMLElement} inputEl  - elemen input
   * @param {HTMLElement} errEl    - elemen pesan error
   * @param {boolean}     isValid  - true jika valid
   */
  function setFieldValid(inputEl, errEl, isValid) {
    inputEl.classList.toggle("invalid", !isValid);
    errEl.classList.toggle("visible", !isValid);
  }

  /** Hilangkan status aktif dari semua tombol preset */
  function clearPresetSelection() {
    document.querySelectorAll("#panel-custom .preset-btn").forEach((btn) => {
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    });
  }

  /* ═══════════════════════════════════════════
     EVENT LISTENERS
     ═══════════════════════════════════════════ */
  function bindEvents() {
    /* Ambil referensi elemen setelah HTML ter-inject */
    const nominalEl = document.getElementById("c-nominal");
    const nomErrEl = document.getElementById("c-nominal-error");
    const bungaEl = document.getElementById("c-bunga");
    const bungaErrEl = document.getElementById("c-bunga-error");
    const tenorEl = document.getElementById("c-tenor");
    const tenorErrEl = document.getElementById("c-tenor-error");

    /* ────────────────────────────────────────
       NOMINAL — Setoran Awal
       ──────────────────────────────────────── */
    nominalEl.addEventListener("input", function () {
      /* Ambil hanya digit, format dengan pemisah ribuan */
      const digits = this.value.replace(/\D/g, "");
      rawNominal = parseInt(digits, 10) || 0;

      /* Pertahankan posisi kursor setelah format ulang */
      const caretFromRight = this.value.length - (this.selectionStart ?? this.value.length);
      const formatted = rawNominal > 0 ? fmtDisp(rawNominal) : "";
      this.value = formatted;
      try {
        const pos = Math.max(0, formatted.length - caretFromRight);
        this.setSelectionRange(pos, pos);
      } catch (_) {
        /* iOS Safari fallback */
      }

      /* Validasi: toleransi saat field masih kosong (rawNominal === 0) */
      setFieldValid(this, nomErrEl, rawNominal === 0 || rawNominal >= MIN_NOMINAL);

      /* Debounce kalkulasi otomatis */
      clearTimeout(debouncer);
      debouncer = setTimeout(tryCalculate, 400);
    });

    nominalEl.addEventListener("blur", function () {
      if (rawNominal === 0) {
        this.value = "";
        setFieldValid(this, nomErrEl, false);
        return;
      }
      this.value = fmtDisp(rawNominal);
      setFieldValid(this, nomErrEl, rawNominal >= MIN_NOMINAL);
      if (rawNominal >= MIN_NOMINAL) {
        clearTimeout(debouncer);
        tryCalculate();
      }
    });

    /* ────────────────────────────────────────
       BUNGA — Suku Bunga p.a.
       Mendukung titik (.) dan koma (,) sebagai pemisah desimal.
       ──────────────────────────────────────── */
    bungaEl.addEventListener("input", function () {
      /* Hanya izinkan digit dan satu pemisah desimal */
      let raw = this.value.replace(/[^0-9.,]/g, "");

      /* Pastikan tidak ada lebih dari satu pemisah */
      const firstSep = raw.search(/[.,]/);
      if (firstSep !== -1) {
        const head = raw.slice(0, firstSep + 1);
        const tail = raw.slice(firstSep + 1).replace(/[.,]/g, "");
        raw = head + tail;
      }

      this.value = raw;

      /* Normalisasi ke float (koma → titik untuk parseFloat) */
      rawBunga = parseFloat(raw.replace(",", ".")) || 0;

      const isValid = rawBunga >= MIN_BUNGA && rawBunga <= MAX_BUNGA;
      setFieldValid(this, bungaErrEl, isValid || raw === "");

      /* Saat user mengetik manual, lepas pilihan preset */
      clearPresetSelection();

      clearTimeout(debouncer);
      debouncer = setTimeout(tryCalculate, 400);
    });

    bungaEl.addEventListener("blur", function () {
      rawBunga = parseFloat(this.value.replace(",", ".")) || 0;
      const isValid = rawBunga >= MIN_BUNGA && rawBunga <= MAX_BUNGA;
      setFieldValid(this, bungaErrEl, isValid || this.value === "");
      if (isValid) {
        clearTimeout(debouncer);
        tryCalculate();
      }
    });

    /* ────────────────────────────────────────
       TENOR — Jangka Waktu (Bulan)
       ──────────────────────────────────────── */
    tenorEl.addEventListener("input", function () {
      /* Hanya digit */
      const raw = this.value.replace(/\D/g, "");
      this.value = raw;
      rawTenor = parseInt(raw, 10) || 0;

      const isValid = rawTenor >= MIN_TENOR && rawTenor <= MAX_TENOR;
      setFieldValid(this, tenorErrEl, isValid || raw === "");

      /* Saat user mengetik manual, lepas pilihan preset */
      clearPresetSelection();

      clearTimeout(debouncer);
      debouncer = setTimeout(tryCalculate, 400);
    });

    tenorEl.addEventListener("blur", function () {
      rawTenor = parseInt(this.value, 10) || 0;
      const isValid = rawTenor >= MIN_TENOR && rawTenor <= MAX_TENOR;
      setFieldValid(this, tenorErrEl, isValid || this.value === "");
      if (isValid) {
        clearTimeout(debouncer);
        tryCalculate();
      }
    });

    /* ────────────────────────────────────────
       PRESET BUTTONS
       Klik → isi otomatis bunga & tenor → hitung
       ──────────────────────────────────────── */
    document.querySelectorAll("#panel-custom .preset-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const rate = parseFloat(this.dataset.rate);
        const bulan = parseInt(this.dataset.bulan, 10);

        /* Update state */
        rawBunga = rate;
        rawTenor = bulan;

        /* Tampilkan nilai di input field (gunakan koma sebagai desimal) */
        bungaEl.value = rate.toFixed(2).replace(".", ",");
        tenorEl.value = String(bulan);

        /* Reset error state karena nilai dari preset pasti valid */
        setFieldValid(bungaEl, bungaErrEl, true);
        setFieldValid(tenorEl, tenorErrEl, true);

        /* Tandai preset yang aktif */
        clearPresetSelection();
        this.classList.add("active");
        this.setAttribute("aria-pressed", "true");

        /* Hitung langsung (tanpa debounce) jika nominal sudah valid */
        clearTimeout(debouncer);
        if (rawNominal >= MIN_NOMINAL) {
          setFieldValid(nominalEl, nomErrEl, true);
          customCalculate();
        } else {
          /* Jika nominal belum valid, fokuskan ke field nominal */
          setFieldValid(nominalEl, nomErrEl, false);
          nominalEl.focus();
        }
      });
    });

    /* ────────────────────────────────────────
       FORM SUBMIT FALLBACK (Enter key)
       ──────────────────────────────────────── */
    document.getElementById("customForm").addEventListener("submit", function (e) {
      e.preventDefault();

      let allValid = true;

      if (rawNominal < MIN_NOMINAL) {
        setFieldValid(nominalEl, nomErrEl, false);
        allValid = false;
      }
      if (rawBunga < MIN_BUNGA || rawBunga > MAX_BUNGA) {
        setFieldValid(bungaEl, bungaErrEl, false);
        allValid = false;
      }
      if (rawTenor < MIN_TENOR || rawTenor > MAX_TENOR) {
        setFieldValid(tenorEl, tenorErrEl, false);
        allValid = false;
      }

      if (allValid) {
        clearTimeout(debouncer);
        customCalculate();
      } else {
        /* Fokuskan ke field pertama yang invalid */
        if (rawNominal < MIN_NOMINAL) nominalEl.focus();
        else if (rawBunga < MIN_BUNGA) bungaEl.focus();
        else tenorEl.focus();
      }
    });
  }

  /* ═══════════════════════════════════════════
     BOOTSTRAP
     Daftarkan mount() ke DOMContentLoaded,
     atau jalankan langsung jika DOM sudah siap.
     ═══════════════════════════════════════════ */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    /* Script dimuat setelah DOMContentLoaded (misal: defer/async atau posisi akhir body) */
    mount();
  }
})(); /* ── end IIFE ── */
