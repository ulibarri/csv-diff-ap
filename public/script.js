const i18n = {
  es: {
    title: 'Comparar archivos filtrados vs San Diego PACE Rough Draft',
    language: 'Idioma',
    hint: 'Sube los archivos <strong>filters.csv</strong>, <strong>draft.csv</strong> y <strong>specialty.csv</strong>.',
    step1: '1) Cargar archivos',
    step2: '2) Resultados',
    step3: '3) Búsqueda en Draft.csv',
    searchHint: 'Busca por <strong>PACE MRN</strong> o <strong>Patient</strong>.',
    process: 'Procesar datos',
    download: 'Descargar CSV',
    empty: 'Sin datos',
    footer: 'CFS California Fleet Services Inc. 2025',
    processing: 'Procesando...',
    errorPrefix: 'Error: ',
    searchBtn: 'Buscar',
    searchPlaceholder: 'Criterio de búsqueda (ej. Caro, SDP10035365)'
  },
  en: {
    title: 'Compare Filtered files vs San Diego PACE Rough Draft',
    language: 'Language',
    hint: 'Upload filters.csv, draft.csv and specialty.csv files',
    step1: '1) Upload files',
    step2: '2) Results',
    step3: '3) Search in Draft.csv',
    searchHint: 'Search by <strong>PACE MRN</strong> or <strong>Patient</strong>.',
    process: 'Process data',
    download: 'Download CSV',
    empty: 'No data',
    footer: 'CFS California Fleet Services Inc. 2025',
    processing: 'Processing...',
    errorPrefix: 'Error: ',
    searchBtn: 'Search',
    searchPlaceholder: 'Search criteria (e.g., Caro, SDP10035365)'
  }
};


function applyLang(lang) {
  const d = i18n[lang] || i18n.es;
  document.getElementById('t_title').textContent = d.title;
  document.getElementById('t_language').textContent = d.language;
  document.getElementById('t_hint').innerHTML = d.hint;
  document.getElementById('t_step1').textContent = d.step1;
  document.getElementById('t_step2').textContent = d.step2;
  document.getElementById('t_process_btn').textContent = d.process;
  document.getElementById('t_download').textContent = d.download;
  document.getElementById('t_download2').textContent = d.download;
  document.getElementById('t_footer').textContent = d.footer;

  // Búsqueda
  document.getElementById('t_step3').textContent = d.step3;
  document.getElementById('t_search_hint').innerHTML = d.searchHint;
  document.getElementById('t_search_btn').textContent = d.searchBtn;
  const input = document.getElementById('searchInput');
  input.placeholder = d.searchPlaceholder;

  // Tablas vacías
  const t1 = document.getElementById('table1');
  const t2 = document.getElementById('table2');
  const st = document.getElementById('searchTable');
  if (t1.classList.contains('empty')) t1.textContent = d.empty;
  if (t2.classList.contains('empty')) t2.textContent = d.empty;
  if (st.classList.contains('empty')) st.textContent = d.empty;
}

(function initLang(){
  const initial = window.__APP_LANG__ || 'es';
  const select = document.getElementById('langSelect');
  applyLang(initial);
  select.value = initial;
  select.addEventListener('change', () => {
    const val = select.value;
    applyLang(val);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', val);
    window.history.replaceState({}, '', url.toString());
  });
})();

// ---------- lógica de app ----------
const form = document.getElementById('csvForm');
const statusEl = document.getElementById('status');

const table1 = document.getElementById('table1');
const table2 = document.getElementById('table2');

const downloadCsv1 = document.getElementById('downloadCsv1');
const downloadCsv2 = document.getElementById('downloadCsv2');

// Búsqueda
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchTable = document.getElementById('searchTable');

// Índice de Draft (se llena tras /process)
let DRAFT_INDEX = [];

function renderTable(el, rows) {
  el.innerHTML = '';
  el.classList.remove('empty');

  if (!rows || rows.length === 0) {
    const lang = (document.getElementById('langSelect').value || 'es');
    el.textContent = i18n[lang].empty;
    el.classList.add('empty');
    return;
  }

  const headers = Object.keys(rows[0]);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');

  const trh = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach(r => {
    const tr = document.createElement('tr');
    headers.forEach(h => {
      const td = document.createElement('td');
      td.textContent = r[h] ?? '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  el.appendChild(table);
}

// Datagrid para búsqueda: fuerza columnas solicitadas
function renderSearchTable(rows) {
  const cols = ['PACE MRN', 'Patient', 'Patient Address', 'Time'];
  searchTable.innerHTML = '';
  searchTable.classList.remove('empty');

  if (!rows || rows.length === 0) {
    const lang = (document.getElementById('langSelect').value || 'es');
    searchTable.textContent = i18n[lang].empty;
    searchTable.classList.add('empty');
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');

  const trh = document.createElement('tr');
  cols.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach(r => {
    const tr = document.createElement('tr');
    cols.forEach(h => {
      const td = document.createElement('td');
      td.textContent = r[h] ?? '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  searchTable.appendChild(table);
}

function runSearchSingle(query) {
  if (!query || !DRAFT_INDEX || DRAFT_INDEX.length === 0) return [];
  const q = String(query).toLowerCase().trim();
  return DRAFT_INDEX.filter(r => {
    const pm = String(r['PACE MRN'] ?? '').toLowerCase();
    const pt = String(r['Patient'] ?? '').toLowerCase();
    return pm.includes(q) || pt.includes(q);
  });
}

// Búsqueda combinada (unión de varios criterios)
function runSearchCombined(queries) {
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    const rows = runSearchSingle(q);
    for (const r of rows) {
      const key = `${r['PACE MRN']}|${r['Patient']}|${r['Patient Address']}|${r['Time']}`;
      if (!seen.has(key)) { seen.add(key); out.push(r); }
    }
  }
  return out;
}

searchBtn.addEventListener('click', () => {
  const val = searchInput.value || '';
  const rows = runSearchSingle(val);
  renderSearchTable(rows);
});

function csvToBlobUrl(csvText) {
  const blob = new Blob([csvText || ''], { type: 'text/csv;charset=utf-8;' });
  return URL.createObjectURL(blob);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const lang = (document.getElementById('langSelect').value || 'es');
  statusEl.textContent = i18n[lang].processing;

  // Limpieza previa
  downloadCsv1.style.display = 'none';
  downloadCsv2.style.display = 'none';
  table1.classList.add('empty');
  table2.classList.add('empty');
  searchTable.classList.add('empty');
  table1.textContent = i18n[lang].empty;
  table2.textContent = i18n[lang].empty;
  searchTable.textContent = i18n[lang].empty;

  try {
    const fd = new FormData(form);
    const res = await fetch('/process', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unexpected error');

    // Tablas de resultados
    renderTable(table1, data.trips_In_Filters_Not_In_Specialty);
    renderTable(table2, data.trips_In_Specialty_Not_In_Filters);

    // Enlaces de descarga con prefijo
    const prefix = data?.meta?.visitDatePrefix || '';
    if (data.csvFiles?.trips_In_Filters_Not_In_Specialty) {
      const url1 = csvToBlobUrl(data.csvFiles.trips_In_Filters_Not_In_Specialty);
      downloadCsv1.href = url1;
      downloadCsv1.download = `${prefix}trips_In_Filters_Not_In_Specialty.csv`;
      downloadCsv1.style.display = 'inline-block';
    }
    if (data.csvFiles?.trips_In_Specialty_Not_In_Filters) {
      const url2 = csvToBlobUrl(data.csvFiles.trips_In_Specialty_Not_In_Filters);
      downloadCsv2.href = url2;
      downloadCsv2.download = `${prefix}trips_In_Specialty_Not_In_Filters.csv`;
      downloadCsv2.style.display = 'inline-block';
    }

    // Índice para búsqueda
    DRAFT_INDEX = data?.meta?.draftIndex || [];

    // --- BÚSQUEDA AUTOMÁTICA TRAS "Procesar" ---
    // Criterios: Patient="Caro" y PACE MRN="SDP10035365"
    const autoRows = runSearchCombined(['Caro', 'SDP10035365']);
    renderSearchTable(autoRows);

    statusEl.textContent = 'Listo ✅';
  } catch (err) {
    const lang2 = (document.getElementById('langSelect').value || 'es');
    statusEl.textContent = i18n[lang2].errorPrefix + err.message;
    console.error(err);
  }
});
