const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const path = require('path');


const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const lang = (req.query.lang === 'en' ? 'en' : 'es');
  res.render('index', { lang });
});

// ---------- utils ----------
function get(obj, key) {
  if (!obj) return undefined;
  const k = String(key).trim().toLowerCase();
  let found;
  for (const [kk, vv] of Object.entries(obj)) {
    if (String(kk).trim().toLowerCase() === k) { found = vv; break; }
  }
  return typeof found === 'string' ? found.trim() : found;
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true });
}

function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (s.includes('"')) s = s.replace(/"/g, '""');
    if (/[",\n]/.test(s)) s = `"${s}"`;
    return s;
  };
  const head = headers.map(esc).join(',');
  const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
  return `${head}\n${body}`;
}

function computePatientFromDraft(row) {
  const first = get(row, 'First Name') || '';
  const last = get(row, 'Last Name') || '';
  const middle = get(row, 'Middle_Name') || '';
  const full = [first, middle, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return full || get(row, 'Participant') || get(row, 'Patient') || '';
}

function getDraftProjection(draftRow) {
  return {
    'PACE MRN': get(draftRow, 'PACE MRN') || get(draftRow, 'Pace MRN'),
    'Patient': computePatientFromDraft(draftRow),
    'Patient Address': get(draftRow, 'Patient Address'),
    'Time': get(draftRow, 'Time') || get(draftRow, 'Start Time') || get(draftRow, 'Appointment Time')
  };
}

// ---- prefijo YYYYMMDD_ desde "Visit Date" del DRAFT ----
function normalizeDateToYYYYMMDD(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const datePart = s.split(/[ T]/)[0];

  let m = datePart.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [_, y, mo, d] = m;
    return `${y}${mo.padStart(2,'0')}${d.padStart(2,'0')}`;
  }
  m = datePart.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    let [_, a, b, y] = m;
    a = a.padStart(2,'0'); b = b.padStart(2,'0');
    const A = parseInt(a,10), B = parseInt(b,10);
    return (A > 12 && B <= 12) ? `${y}${b}${a}` : `${y}${a}${b}`;
  }
  m = datePart.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return datePart;

  const coerced = datePart.replace(/\//g, '-');
  const dt = new Date(coerced);
  if (!isNaN(dt.getTime())) {
    const y = String(dt.getFullYear());
    const mo = String(dt.getMonth()+1).padStart(2,'0');
    const d = String(dt.getDate()).padStart(2,'0');
    return `${y}${mo}${d}`;
  }
  return null;
}

function computeVisitDatePrefixFromDraft(draftRows) {
  const counts = new Map();
  for (const r of draftRows) {
    const v = get(r, 'Visit Date') || get(r, 'Visit date') || get(r, 'VisitDate');
    if (!v) continue;
    const key = String(v).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let chosen = null;
  if (counts.size > 0) {
    chosen = [...counts.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  } else {
    const now = new Date();
    const y = String(now.getFullYear());
    const mo = String(now.getMonth()+1).padStart(2,'0');
    const d = String(now.getDate()).padStart(2,'0');
    return `${y}${mo}${d}_`;
  }
  const ymd = normalizeDateToYYYYMMDD(chosen);
  if (ymd) return `${ymd}_`;
  const now = new Date();
  const y = String(now.getFullYear());
  const mo = String(now.getMonth()+1).padStart(2,'0');
  const d = String(now.getDate()).padStart(2,'0');
  return `${y}${mo}${d}_`;
}

// ---------- endpoint principal ----------
app.post(
  '/process',
  upload.fields([
    { name: 'filters', maxCount: 1 },
    { name: 'specialty', maxCount: 1 },
    { name: 'draft', maxCount: 1 }
  ]),
  (req, res) => {
    try {
      if (!req.files?.filters?.[0] || !req.files?.specialty?.[0] || !req.files?.draft?.[0]) {
        return res.status(400).json({ error: 'Faltan archivos. Sube filters.csv, specialty.csv y draft.csv.' });
      }

      const filtersRows = parseCsv(req.files.filters[0].buffer);
      const specialtyRows = parseCsv(req.files.specialty[0].buffer);
      const draftRows = parseCsv(req.files.draft[0].buffer);

      const normalizeKey = (v) => (v == null ? '' : String(v).trim());
      const setFrom = (rows) => new Set(rows.map(r => normalizeKey(get(r, 'CSN'))).filter(Boolean));

      const csnFilters = setFrom(filtersRows);
      const csnSpecialty = setFrom(specialtyRows);

      const draftByCSN = new Map();
      for (const r of draftRows) {
        const k = normalizeKey(get(r, 'CSN'));
        if (!k) continue;
        if (!draftByCSN.has(k)) draftByCSN.set(k, r);
      }

      const missingInSpecialty = [];
      for (const k of csnFilters) {
        if (!csnSpecialty.has(k)) {
          const draftMatch = draftByCSN.get(k);
          if (draftMatch) missingInSpecialty.push(getDraftProjection(draftMatch));
        }
      }

      const missingInFilters = [];
      for (const k of csnSpecialty) {
        if (!csnFilters.has(k)) {
          const draftMatch = draftByCSN.get(k);
          if (draftMatch) missingInFilters.push(getDraftProjection(draftMatch));
        }
      }

      const csv1 = toCsv(missingInSpecialty);
      const csv2 = toCsv(missingInFilters);

      // Índice para búsqueda (derivado de todo DRAFT)
      const draftIndex = draftRows.map(getDraftProjection);

      // Prefijo por Visit Date
      const visitDatePrefix = computeVisitDatePrefixFromDraft(draftRows);

      res.json({
        trips_In_Filters_Not_In_Specialty: missingInSpecialty,
        trips_In_Specialty_Not_In_Filters: missingInFilters,
        csvFiles: {
          trips_In_Filters_Not_In_Specialty: csv1,
          trips_In_Specialty_Not_In_Filters: csv2
        },
        meta: {
          visitDatePrefix,
          draftIndex  // <-- para la sección de búsqueda
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error procesando CSV. Verifica encabezados y formato.' });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CSV Diff app corriendo en http://localhost:${PORT}`);
});
