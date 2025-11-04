const form = document.getElementById('csvForm');
const statusEl = document.getElementById('status');

const table1 = document.getElementById('table1');
const table2 = document.getElementById('table2');

const downloadCsv1 = document.getElementById('downloadCsv1');
const downloadCsv2 = document.getElementById('downloadCsv2');

function renderTable(el, rows) {
  // Limpia enlaces previos
  el.innerHTML = '';
  el.classList.remove('empty');

  if (!rows || rows.length === 0) {
    el.textContent = 'No data';
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

function csvToBlobUrl(csvText) {
  const blob = new Blob([csvText || ''], { type: 'text/csv;charset=utf-8;' });
  return URL.createObjectURL(blob);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Processing...';
  downloadCsv1.style.display = 'none';
  downloadCsv2.style.display = 'none';
  table1.classList.add('empty');
  table2.classList.add('empty');
  table1.textContent = 'No data';
  table2.textContent = 'No data';

  try {
    const fd = new FormData(form);
    const res = await fetch('/process', {
      method: 'POST',
      body: fd
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Error inesperado');

    // Render tablas
    renderTable(table1, data.trips_In_Filters_Not_In_Specialty);
    renderTable(table2, data.trips_In_Specialty_Not_In_Filters);

    // Links de descarga (desde CSV devuelto por API, sin tocar disco)
    if (data.csvFiles?.trips_In_Filters_Not_In_Specialty) {
      const url1 = csvToBlobUrl(data.csvFiles.trips_In_Filters_Not_In_Specialty);
      downloadCsv1.href = url1;
      downloadCsv1.style.display = 'inline-block';
    }
    if (data.csvFiles?.trips_In_Specialty_Not_In_Filters) {
      const url2 = csvToBlobUrl(data.csvFiles.trips_In_Specialty_Not_In_Filters);
      downloadCsv2.href = url2;
      downloadCsv2.style.display = 'inline-block';
    }

    statusEl.textContent = 'Done ✅';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error: ' + err.message;
  }
});
