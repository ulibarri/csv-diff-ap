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
  res.render('index');
});

// Utilidad: normalizar encabezados y obtener valor por clave tolerante
function get(obj, key) {
  if (!obj) return undefined;
  const k = String(key).trim().toLowerCase();
  let found;
  for (const [kk, vv] of Object.entries(obj)) {
    if (String(kk).trim().toLowerCase() === k) {
      found = vv;
      break;
    }
  }
  return typeof found === 'string' ? found.trim() : found;
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8');
  // columns: true => regresa cada fila como objeto con llaves de encabezados
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

// Construye CSV simple (escapa comillas y campos con comas)
function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (s.includes('"')) s = s.replace(/"/g, '""');
    if (/[",\n]/.test(s)) s = `"${s}"`;
    return s;
  };
  const head = headers.map(esc).join(',');
  const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
  return `${head}\n${body}`;
}

// Crea el campo "Patient" desde DRAFT: First Name + Last Name (fallbacks)
function computePatientFromDraft(row) {
  const first = get(row, 'First Name') || '';
  const last = get(row, 'Last Name') || '';
  const middle = get(row, 'Middle_Name') || '';
  const full = [first, middle, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  // Fallbacks si no hay nombres
  return full || get(row, 'Participant') || get(row, 'Patient') || '';
}

function getDraftProjection(draftRow) {
  // Requisitos de salida: PACE MRN, Patient, Patient Address, Time (desde DRAFT.csv)
  return {
    'PACE MRN': get(draftRow, 'PACE MRN') || get(draftRow, 'Pace MRN'),
    'Patient': computePatientFromDraft(draftRow),
    'Patient Address': get(draftRow, 'Patient Address'),
    'Time': get(draftRow, 'Time') || get(draftRow, 'Start Time') || get(draftRow, 'Appointment Time')
  };
}

app.post(
  '/process',
  upload.fields([
    { name: 'filters', maxCount: 1 },
    { name: 'specialty', maxCount: 1 },
    { name: 'draft', maxCount: 1 }
  ]),
  (req, res) => {
    try {
      // Validaciones
      if (!req.files?.filters?.[0] || !req.files?.specialty?.[0] || !req.files?.draft?.[0]) {
        return res.status(400).json({ error: 'Faltan archivos. Sube filters.csv, specialty.csv y draft.csv.' });
      }

      const filtersRows = parseCsv(req.files.filters[0].buffer);
      const specialtyRows = parseCsv(req.files.specialty[0].buffer);
      const draftRows = parseCsv(req.files.draft[0].buffer);

      // Índices por CSN
      const normalizeKey = (v) => (v == null ? '' : String(v).trim());
      const setFrom = (rows) => new Set(rows.map(r => normalizeKey(get(r, 'CSN'))).filter(Boolean));

      const csnFilters = setFrom(filtersRows);
      const csnSpecialty = setFrom(specialtyRows);

      // Mapa DRAFT por CSN para buscar proyecciones rápidamente
      const draftByCSN = new Map();
      for (const r of draftRows) {
        const k = normalizeKey(get(r, 'CSN'));
        if (!k) continue;
        // si hay duplicados, nos quedamos con el primero (o podrías acumular)
        if (!draftByCSN.has(k)) draftByCSN.set(k, r);
      }

      // 1) CSN en FILTERS y NO en SPECIALTY
      const missingInSpecialty = [];
      for (const k of csnFilters) {
        if (!csnSpecialty.has(k)) {
          const draftMatch = draftByCSN.get(k);
          if (draftMatch) {
            missingInSpecialty.push(getDraftProjection(draftMatch));
          }
        }
      }

      // 2) CSN en SPECIALTY y NO en FILTERS
      const missingInFilters = [];
      for (const k of csnSpecialty) {
        if (!csnFilters.has(k)) {
          const draftMatch = draftByCSN.get(k);
          if (draftMatch) {
            missingInFilters.push(getDraftProjection(draftMatch));
          }
        }
      }

      // Construir CSVs requeridos
      const csv1 = toCsv(missingInSpecialty); // trips_In_Filters_Not_In_Specialty.csv
      const csv2 = toCsv(missingInFilters);   // trips_In_Specialty_Not_In_Filters.csv

      // Responder como JSON (la UI crea los enlaces de descarga con Blob)
      res.json({
        trips_In_Filters_Not_In_Specialty: missingInSpecialty,
        trips_In_Specialty_Not_In_Filters: missingInFilters,
        csvFiles: {
          trips_In_Filters_Not_In_Specialty: csv1,
          trips_In_Specialty_Not_In_Filters: csv2
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
