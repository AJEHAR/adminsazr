// ============================================================
//  api.js  —  SAZR Admin GitHub Pages
//  Versi: 2.0.0
//
//  TUJUAN:
//  Gantikan google.script.run dengan fetch() ke GAS Web App.
//  Semua fail HTML tidak perlu diubah — shim mencipta semula
//  objek google.script.run yang berfungsi dengan API yang sama.
//
//  CARA GUNA:
//  Letakkan <script src="api.js"></script> sebagai PERTAMA
//  dalam setiap fail HTML, sebelum skrip lain.
//
//  SETUP:
//  1. Deploy adminCode.gs sebagai Web App (Execute as: Me,
//     Who has access: Anyone)
//  2. Salin URL deployment ke GAS_ENDPOINT di bawah
//  3. Muat naik api.js dan semua HTML ke GitHub Pages
// ============================================================


// ============================================================
//  BAHAGIAN 1 — KONFIGURASI ENDPOINT
//
//  Isi GAS_ENDPOINT selepas deploy GAS sebagai Web App.
//  Format URL: https://script.google.com/macros/s/XXXX.../exec
// ============================================================

var GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbyj7zDpk7IO7WkvKuj1Z8slpJOjL-wYNbIZ4HcHgv0PKsi6-SGgGwFZQHW5C1t5MtCGGQ/exec";

// Timeout untuk setiap request (ms). 30s sesuai untuk GAS.
var GAS_TIMEOUT_MS = 30000;

// Debug mode — tukar ke true untuk log semua request/response
var GAS_DEBUG = false;


// ============================================================
//  BAHAGIAN 2 — FUNGSI TERAS: gasCall()
//
//  Hantar request ke GAS Web App dan pulangkan Promise.
//
//  Penggunaan:
//    gasCall('dbSemuaKategori', KOD)
//      .then(function(data) { ... })
//      .catch(function(err) { ... });
//
//  Parameter:
//    fn   — nama fungsi GAS (string)
//    ...  — argumen yang dihantar ke fungsi tersebut
//
//  Return:
//    Promise yang resolve dengan data dari GAS,
//    atau reject dengan Error jika gagal.
// ============================================================

function gasCall(fn) {
  var args = Array.prototype.slice.call(arguments, 1);

  if (GAS_DEBUG) {
    console.log('[GAS] →', fn, args);
  }

  if (!GAS_ENDPOINT || GAS_ENDPOINT === "ISI_URL_GAS_WEBAPP_DI_SINI") {
    return Promise.reject(new Error(
      "GAS_ENDPOINT belum diisi dalam api.js. " +
      "Deploy adminCode.gs sebagai Web App dan isi URL-nya."
    ));
  }

  // ── Bina request body ─────────────────────────────────────
  var body = JSON.stringify({ fn: fn, args: args });

  // ── Abort controller untuk timeout ───────────────────────
  var controller = null;
  var timeoutId  = null;
  if (typeof AbortController !== 'undefined') {
    controller = new AbortController();
    timeoutId  = setTimeout(function() {
      controller.abort();
    }, GAS_TIMEOUT_MS);
  }

  var fetchOptions = {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : body
  };
  if (controller) {
    fetchOptions.signal = controller.signal;
  }

  return fetch(GAS_ENDPOINT, fetchOptions)
    .then(function(response) {
      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }
      return response.json();
    })
    .then(function(data) {
      if (GAS_DEBUG) {
        console.log('[GAS] ←', fn, data);
      }

      // GAS ada masa pulangkan ralat dalam badan (bukan HTTP error)
      // Biarkan data mengalir terus — handler HTML akan semak status
      return data;
    })
    .catch(function(err) {
      if (timeoutId) clearTimeout(timeoutId);

      // Timeout
      if (err.name === 'AbortError') {
        var timeoutErr = new Error(
          'Permintaan ke pelayan tamat masa (' + (GAS_TIMEOUT_MS / 1000) + 's). ' +
          'Cuba semula atau semak sambungan internet anda.'
        );
        if (GAS_DEBUG) console.error('[GAS] TIMEOUT:', fn);
        throw timeoutErr;
      }

      if (GAS_DEBUG) console.error('[GAS] ERROR:', fn, err);
      throw err;
    });
}


// ============================================================
//  BAHAGIAN 3 — SHIM: google.script.run
//
//  Mencipta semula objek google.script.run menggunakan Proxy.
//  HTML sedia ada tidak perlu diubah langsung.
//
//  Sokongan:
//    google.script.run.withSuccessHandler(fn).namaFungsi(args)
//    google.script.run.withFailureHandler(fn).namaFungsi(args)
//    google.script.run.withSuccessHandler(fn).withFailureHandler(fn).namaFungsi(args)
//
//  Setiap rangkaian panggilan adalah bebas (tidak berkongsi state).
// ============================================================

(function() {
  // ── Buat runner object ──────────────────────────────────────
  function _makeRunner() {
    var _sh = null;  // successHandler
    var _fh = null;  // failureHandler

    var handler = {
      get: function(target, prop) {

        // .withSuccessHandler(fn)
        if (prop === 'withSuccessHandler') {
          return function(fn) {
            _sh = (typeof fn === 'function') ? fn : null;
            return proxy;
          };
        }

        // .withFailureHandler(fn)
        if (prop === 'withFailureHandler') {
          return function(fn) {
            _fh = (typeof fn === 'function') ? fn : null;
            return proxy;
          };
        }

        // .namaFungsi(...) — mana-mana fungsi lain
        return function() {
          var fnArgs  = Array.prototype.slice.call(arguments);
          var sh      = _sh;
          var fh      = _fh;
          var fnName  = prop;

          // Reset handlers untuk panggilan seterusnya
          _sh = null;
          _fh = null;

          // Bina args array: [arg1, arg2, ...]
          var callArgs = [fnName].concat(fnArgs);

          gasCall.apply(null, callArgs)
            .then(function(result) {
              if (typeof sh === 'function') {
                try { sh(result); } catch(e) {
                  console.error('[GAS shim] successHandler error:', e);
                }
              }
            })
            .catch(function(err) {
              if (typeof fh === 'function') {
                try { fh(err); } catch(e) {
                  console.error('[GAS shim] failureHandler error:', e);
                }
              } else {
                // Tiada failureHandler — log ke console
                console.error('[GAS] Ralat tanpa failureHandler:', fnName, err.message);
              }
            });
        };
      }
    };

    var proxy = new Proxy({}, handler);
    return proxy;
  }

  // ── Inject ke window.google.script.run ────────────────────
  if (typeof window !== 'undefined') {
    if (!window.google) window.google = {};
    if (!window.google.script) window.google.script = {};

    // Setiap akses ke .run buat runner baru (state bersih)
    Object.defineProperty(window.google.script, 'run', {
      get: function() { return _makeRunner(); },
      configurable: true
    });

    if (GAS_DEBUG) {
      console.log('[GAS] Shim aktif. Endpoint:', GAS_ENDPOINT);
    }
  }
})();


// ============================================================
//  BAHAGIAN 4 — TOKEN MANAGER
//
//  Pengurusan token auth yang konsisten antara semua halaman.
//  Fallback ke memory jika sessionStorage disekat (iframe/CSP).
//
//  Nota: admin.html ada getToken/setToken/clearToken sendiri.
//  Fungsi ini digunakan oleh halaman HTML lain (CetakJadual,
//  SemakanPeserta, dll.) yang tidak ada fungsi token sendiri.
//
//  Jika halaman sudah ada getToken(), fungsi di sini tidak akan
//  overwrite (ada semakan typeof dulu).
// ============================================================

var _GAS_TK_KEY = 'sazr_admin_token';
var _GAS_TK_MEM = '';

// Dapatkan token aktif
function _gasGetToken() {
  if (_GAS_TK_MEM) return _GAS_TK_MEM;
  try {
    var t = sessionStorage.getItem(_GAS_TK_KEY);
    if (t) { _GAS_TK_MEM = t; return t; }
  } catch(e) {}
  return '';
}

// Simpan token
function _gasSetToken(t) {
  _GAS_TK_MEM = t || '';
  try { if (t) sessionStorage.setItem(_GAS_TK_KEY, t); } catch(e) {}
}

// Padam token (logout)
function _gasCleanToken() {
  _GAS_TK_MEM = '';
  try { sessionStorage.removeItem(_GAS_TK_KEY); } catch(e) {}
}

// Expose sebagai global hanya jika belum ada
if (typeof window !== 'undefined') {
  if (typeof window.getToken === 'undefined') {
    window.getToken    = _gasGetToken;
    window.setToken    = _gasSetToken;
    window.clearToken  = _gasCleanToken;
  }
}


// ============================================================
//  BAHAGIAN 5 — HELPER: gasCallAuth()
//
//  Seperti gasCall() tapi auto-inject token sebagai args[0].
//  Guna untuk fungsi yang memerlukan token:
//    padamPertandingan, toggleStatusAcara, dll.
//
//  Penggunaan (dalam HTML jika perlu):
//    gasCallAuth('padamPertandingan', KOD)
//      .then(function(h) { ... });
//
//  Nota: Kebanyakan HTML guna google.script.run shim dan
//  menghantar token secara manual. Fungsi ini untuk kemudahan.
// ============================================================

function gasCallAuth(fn) {
  var extraArgs = Array.prototype.slice.call(arguments, 1);
  var token     = (typeof getToken === 'function') ? getToken() : _gasGetToken();
  var allArgs   = [fn, token].concat(extraArgs);
  return gasCall.apply(null, allArgs);
}


// ============================================================
//  BAHAGIAN 6 — HELPER: gasCallJson()
//
//  Hantar request dan expect { status: "OK"|"ERROR" }.
//  Auto-reject jika status ERROR.
//
//  Penggunaan:
//    gasCallJson('dbTambahKategori', KOD, data)
//      .then(function(h) { /* h.status === "OK" dijamin */ })
//      .catch(function(err) { /* network error ATAU status ERROR */ });
// ============================================================

function gasCallJson(fn) {
  var args = Array.prototype.slice.call(arguments);
  return gasCall.apply(null, args)
    .then(function(result) {
      if (result && result.status === 'ERROR') {
        throw new Error(result.mesej || 'Ralat GAS');
      }
      return result;
    });
}


// ============================================================
//  BAHAGIAN 7 — FALLBACK UNTUK BROWSER LAMA
//
//  Proxy tidak disokong oleh IE11 ke bawah.
//  Jika Proxy tidak tersedia, tunjukkan mesej ralat.
// ============================================================

if (typeof Proxy === 'undefined') {
  console.error(
    '[SAZR] Browser anda tidak menyokong ciri yang diperlukan (ES6 Proxy). ' +
    'Sila gunakan Chrome, Firefox, Edge, atau Safari terkini.'
  );

  // Fallback minimal — tunjukkan modal ralat jika ada
  window.addEventListener('DOMContentLoaded', function() {
    var msg = document.getElementById('msg-browser-lama');
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'msg-browser-lama';
      msg.style.cssText = [
        'position:fixed;top:0;left:0;right:0;z-index:9999',
        'background:#dc2626;color:white;padding:12px 20px',
        'font-family:sans-serif;font-size:14px;text-align:center'
      ].join(';');
      msg.textContent = 'Browser anda tidak disokong. Sila guna Chrome atau Firefox terkini.';
      document.body.appendChild(msg);
    }
  });
}


// ============================================================
//  BAHAGIAN 8 — VERSI & METADATA
// ============================================================

var SAZR_API = {
  versi    : '2.0.0',
  endpoint : GAS_ENDPOINT,
  debug    : GAS_DEBUG
};

if (GAS_DEBUG) {
  console.log('[SAZR] api.js v' + SAZR_API.versi + ' loaded.');
}
