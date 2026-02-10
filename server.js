const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const app = express();
const PORT = 4052;

app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(express.json());
app.use(express.static(__dirname));

// ========================================
// CONFIGURAZIONE UPLOAD FILE
// ========================================
const uploadsDir = path.join(__dirname, 'uploads');
const cedoliniDir = path.join(uploadsDir, 'cedolini');
const dipendentiDir = path.join(uploadsDir, 'dipendenti');

// Crea le directory se non esistono
[uploadsDir, cedoliniDir, dipendentiDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configurazione Multer per upload cedolini (admin)
const storageCedolini = multer.diskStorage({
    destination: (req, file, cb) => {
        const dipendenteId = req.body.dipendente_id;
        const dir = path.join(cedoliniDir, dipendenteId.toString());
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `${timestamp}_${file.originalname}`);
    }
});

// Configurazione Multer per upload dipendenti
const storageDipendenti = multer.diskStorage({
    destination: (req, file, cb) => {
        const dipendenteId = req.body.dipendente_id || req.session?.dipendente_id;
        const dir = path.join(dipendentiDir, dipendenteId.toString());
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `${timestamp}_${file.originalname}`);
    }
});

const uploadCedolini = multer({
    storage: storageCedolini,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Solo file PDF sono ammessi per i cedolini'));
        }
    }
});

const uploadDipendenti = multer({
    storage: storageDipendenti,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Solo PDF e immagini (JPG, PNG) sono ammessi'));
        }
    }
});

const dbPath = path.join(__dirname, 'gestionale.db');
const db = new sqlite3.Database(dbPath);

// ========================================
// TABELLE
// ========================================
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS dipendenti (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        ruolo TEXT NOT NULL,
        telefono TEXT,
        paga_oraria REAL DEFAULT 10.0,
        ore_contrattuali REAL DEFAULT 8.0,
        attivo INTEGER DEFAULT 1,
        creato_il DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS turni (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dipendente_id INTEGER NOT NULL,
        data DATE NOT NULL,
        orario_inizio TEXT NOT NULL,
        orario_fine TEXT NOT NULL,
        bar TEXT NOT NULL,
        ore_normali REAL DEFAULT 0,
        ore_straordinari REAL DEFAULT 0,
        note TEXT,
        creato_il DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dipendente_id) REFERENCES dipendenti(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS riepilogo_mensile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dipendente_id INTEGER NOT NULL,
        anno INTEGER NOT NULL,
        mese INTEGER NOT NULL,
        ore_normali REAL DEFAULT 0,
        ore_straordinari REAL DEFAULT 0,
        compenso_lordo REAL DEFAULT 0,
        contributi REAL DEFAULT 0,
        netto_da_pagare REAL DEFAULT 0,
        salvato_il DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dipendente_id) REFERENCES dipendenti(id),
        UNIQUE(dipendente_id, anno, mese)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS task_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        colore TEXT NOT NULL,
        reset_freq TEXT NOT NULL,
        ordine INTEGER DEFAULT 0
    )`);
    
    db.get("SELECT COUNT(*) as count FROM task_categories", (err, row) => {
        if (!err && row.count === 0) {
            db.run(`INSERT INTO task_categories (nome, colore, reset_freq, ordine) VALUES 
                ('OGNI TURNO', '#FF0000', 'turno', 1),
                ('GIORNALIERE', '#FFA500', 'turno', 2),
                ('SETTIMANALI', '#00FF00', 'settimana', 3),
                ('MENSILI', '#9370DB', 'mese', 4)`);
        }
    });
    
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        categoria_id INTEGER NOT NULL,
        postazione TEXT NOT NULL,
        giorno_settimana INTEGER,
        attivo INTEGER DEFAULT 1,
        creato_il DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (categoria_id) REFERENCES task_categories(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS task_completions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        dipendente_nome TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        data DATE NOT NULL,
        ora TEXT NOT NULL,
        turno_id INTEGER,
        note TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (turno_id) REFERENCES turni(id)
    )`);

    // ========================================
    // NUOVE TABELLE PER CEDOLINI E AREA DIPENDENTI
    // ========================================

    // Tabella credenziali dipendenti per accesso portale
    db.run(`CREATE TABLE IF NOT EXISTS credenziali_dipendenti (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dipendente_id INTEGER NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        ultimo_accesso DATETIME,
        creato_il DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dipendente_id) REFERENCES dipendenti(id)
    )`);

    // Tabella cedolini caricati dall'admin
    db.run(`CREATE TABLE IF NOT EXISTS cedolini_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dipendente_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        filesize INTEGER NOT NULL,
        anno INTEGER NOT NULL,
        mese INTEGER NOT NULL,
        descrizione TEXT,
        caricato_da TEXT DEFAULT 'admin',
        caricato_il DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dipendente_id) REFERENCES dipendenti(id)
    )`);

    // Tabella file caricati dai dipendenti nella loro area personale
    db.run(`CREATE TABLE IF NOT EXISTS dipendenti_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dipendente_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        filesize INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        descrizione TEXT,
        caricato_il DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dipendente_id) REFERENCES dipendenti(id)
    )`);
});

// ========================================
// API DIPENDENTI
// ========================================
app.get('/api/dipendenti', (req, res) => {
    db.all("SELECT * FROM dipendenti WHERE attivo = 1 ORDER BY nome", (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/dipendenti-attivi', (req, res) => {
    db.all("SELECT id, nome, ruolo FROM dipendenti WHERE attivo = 1 ORDER BY nome", (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/dipendenti', (req, res) => {
    const {nome, ruolo, telefono, paga_oraria, ore_contrattuali} = req.body;
    db.run(`INSERT INTO dipendenti (nome, ruolo, telefono, paga_oraria, ore_contrattuali) 
            VALUES (?, ?, ?, ?, ?)`,
        [nome, ruolo, telefono, paga_oraria || 10, ore_contrattuali || 8], 
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({id: this.lastID});
        });
});

app.put('/api/dipendenti/:id', (req, res) => {
    const {nome, ruolo, telefono, paga_oraria, ore_contrattuali} = req.body;
    db.run(`UPDATE dipendenti SET nome=?, ruolo=?, telefono=?, paga_oraria=?, ore_contrattuali=? WHERE id=?`,
        [nome, ruolo, telefono, paga_oraria, ore_contrattuali, req.params.id], 
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({message: 'OK'});
        });
});

app.delete('/api/dipendenti/:id', (req, res) => {
    db.run("UPDATE dipendenti SET attivo=0 WHERE id=?", [req.params.id], function(err) {
        if (err) return res.status(500).json({error: err.message});
        res.json({message: 'OK'});
    });
});

// ========================================
// API TURNI
// ========================================
app.get('/api/turni/settimana/:data', (req, res) => {
    const dataInizio = req.params.data;
    const query = `
        SELECT t.*, d.nome as dipendente_nome, d.ore_contrattuali
        FROM turni t 
        JOIN dipendenti d ON t.dipendente_id = d.id 
        WHERE d.attivo = 1 
        AND t.data >= date(?)
        AND t.data < date(?, '+7 days')
        ORDER BY d.nome, t.data, t.orario_inizio
    `;
    db.all(query, [dataInizio, dataInizio], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/export-data', (req, res) => {
    const {data_inizio, data_fine, dipendenti_ids} = req.body;
    
    const query = `
        SELECT t.*, d.nome as dipendente_nome, d.ruolo, d.id as dipendente_id
        FROM turni t 
        JOIN dipendenti d ON t.dipendente_id = d.id 
        WHERE d.attivo = 1 
        AND t.data >= date(?)
        AND t.data <= date(?)
        ${dipendenti_ids && dipendenti_ids.length > 0 ? 'AND d.id IN (' + dipendenti_ids.join(',') + ')' : ''}
        ORDER BY d.nome, t.data, t.orario_inizio
    `;
    
    db.all(query, [data_inizio, data_fine], (err, turni) => {
        if (err) return res.status(500).json({error: err.message});
        
        const dipQuery = `SELECT * FROM dipendenti WHERE attivo = 1 ${dipendenti_ids && dipendenti_ids.length > 0 ? 'AND id IN (' + dipendenti_ids.join(',') + ')' : ''} ORDER BY nome`;
        
        db.all(dipQuery, [], (err, dipendenti) => {
            if (err) return res.status(500).json({error: err.message});
            res.json({turni, dipendenti, data_inizio, data_fine});
        });
    });
});

app.post('/api/turni', (req, res) => {
    const {dipendente_id, data, orario_inizio, orario_fine, bar, ore_normali, ore_straordinari, note} = req.body;
    db.run(`INSERT INTO turni (dipendente_id, data, orario_inizio, orario_fine, bar, ore_normali, ore_straordinari, note) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [dipendente_id, data, orario_inizio, orario_fine, bar, ore_normali, ore_straordinari, note], 
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({id: this.lastID});
        });
});

app.post('/api/turni/multipli', (req, res) => {
    const {dipendente_id, data_inizio, data_fine, giorni_settimana, orario_inizio, orario_fine, bar, ore_normali, ore_straordinari, note} = req.body;
    
    const start = new Date(data_inizio);
    const end = new Date(data_fine);
    const turniCreati = [];
    
    const giorniMap = {lun:1, mar:2, mer:3, gio:4, ven:5, sab:6, dom:0};
    const giorniSelezionati = giorni_settimana.map(g => giorniMap[g]);
    
    for(let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        
        if(giorniSelezionati.includes(dayOfWeek)) {
            const dataStr = d.toISOString().split('T')[0];
            
            db.run(`INSERT INTO turni (dipendente_id, data, orario_inizio, orario_fine, bar, ore_normali, ore_straordinari, note) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [dipendente_id, dataStr, orario_inizio, orario_fine, bar, ore_normali, ore_straordinari, note],
                function(err) {
                    if (err) console.error('Errore inserimento turno:', err);
                    else turniCreati.push(dataStr);
                });
        }
    }
    
    setTimeout(() => {
        res.json({message: 'OK', count: turniCreati.length, turni: turniCreati});
    }, 500);
});

app.put('/api/turni/:id', (req, res) => {
    const {data, orario_inizio, orario_fine, bar, ore_normali, ore_straordinari, note} = req.body;
    db.run(`UPDATE turni SET data=?, orario_inizio=?, orario_fine=?, bar=?, ore_normali=?, ore_straordinari=?, note=? WHERE id=?`,
        [data, orario_inizio, orario_fine, bar, ore_normali, ore_straordinari, note, req.params.id],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({message: 'OK'});
        });
});

app.delete('/api/turni/:id', (req, res) => {
    db.run("DELETE FROM turni WHERE id=?", [req.params.id], function(err) {
        if (err) return res.status(500).json({error: err.message});
        res.json({message: 'OK'});
    });
});

// ========================================
// API RIEPILOGO
// ========================================
app.get('/api/riepilogo/:dipendente_id/:anno/:mese', (req, res) => {
    const {dipendente_id, anno, mese} = req.params;
    const meseFormatted = mese.padStart(2, '0');
    
    const query = `
        SELECT 
            d.nome, d.paga_oraria,
            SUM(t.ore_normali) as tot_normali,
            SUM(t.ore_straordinari) as tot_straordinari,
            SUM(t.ore_normali + t.ore_straordinari) as tot_ore,
            COUNT(t.id) as num_turni,
            SUM(t.ore_normali * d.paga_oraria) as comp_normali,
            SUM(t.ore_straordinari * d.paga_oraria) as comp_straordinari,
            SUM((t.ore_normali + t.ore_straordinari) * d.paga_oraria) as comp_totale
        FROM dipendenti d
        LEFT JOIN turni t ON d.id = t.dipendente_id 
            AND strftime('%Y', t.data) = ? 
            AND strftime('%m', t.data) = ?
        WHERE d.id = ?
    `;
    
    db.get(query, [anno, meseFormatted, dipendente_id], (err, row) => {
        if (err) return res.status(500).json({error: err.message});
        
        db.get("SELECT * FROM riepilogo_mensile WHERE dipendente_id=? AND anno=? AND mese=?", 
            [dipendente_id, anno, mese], (err, saved) => {
                if (err) return res.status(500).json({error: err.message});
                res.json({...row, saved: saved || null});
            });
    });
});

app.post('/api/riepilogo/salva', (req, res) => {
    const {dipendente_id, anno, mese, ore_normali, ore_straordinari, compenso_lordo, contributi, netto_da_pagare} = req.body;
    
    db.run(`INSERT OR REPLACE INTO riepilogo_mensile 
            (dipendente_id, anno, mese, ore_normali, ore_straordinari, compenso_lordo, contributi, netto_da_pagare, salvato_il) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [dipendente_id, anno, mese, ore_normali, ore_straordinari, compenso_lordo, contributi, netto_da_pagare],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({message: 'Riepilogo salvato', id: this.lastID});
        });
});

app.get('/api/riepilogo/storico/:dipendente_id', (req, res) => {
    db.all("SELECT * FROM riepilogo_mensile WHERE dipendente_id=? ORDER BY anno DESC, mese DESC", 
        [req.params.dipendente_id], (err, rows) => {
            if (err) return res.status(500).json({error: err.message});
            res.json(rows);
        });
});

app.get('/api/riepilogo/settimana/:data_inizio', (req, res) => {
    const dataInizio = req.params.data_inizio;
    
    const query = `
        SELECT 
            d.id, d.nome, d.paga_oraria,
            SUM(t.ore_normali) as tot_normali,
            SUM(t.ore_straordinari) as tot_straordinari,
            SUM((t.ore_normali + t.ore_straordinari) * d.paga_oraria) as comp_totale
        FROM dipendenti d
        LEFT JOIN turni t ON d.id = t.dipendente_id 
            AND t.data >= date(?)
            AND t.data < date(?, '+7 days')
        WHERE d.attivo = 1
        GROUP BY d.id
        ORDER BY d.nome
    `;
    
    db.all(query, [dataInizio, dataInizio], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

// ========================================
// API CHECKLIST
// ========================================
app.get('/api/turni/adesso', (req, res) => {
    const now = new Date();
    const oggi = now.toISOString().split('T')[0];
    
    const oraAttuale = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    
    const nowMinus30 = new Date(now.getTime() - 30 * 60000);
    const oraTolleranzaInizio = String(nowMinus30.getHours()).padStart(2, '0') + ':' + String(nowMinus30.getMinutes()).padStart(2, '0');
    
    const nowPlus90 = new Date(now.getTime() + 90 * 60000);
    const oraTolleranzaFine = String(nowPlus90.getHours()).padStart(2, '0') + ':' + String(nowPlus90.getMinutes()).padStart(2, '0');
    
    const query = `
        SELECT t.id as turno_id, d.nome, t.bar, t.orario_inizio, t.orario_fine
        FROM turni t
        JOIN dipendenti d ON t.dipendente_id = d.id
        WHERE t.data = ?
        AND t.orario_inizio <= ?
        AND t.orario_fine >= ?
        AND d.attivo = 1
        ORDER BY d.nome
    `;
    
    db.all(query, [oggi, oraAttuale, oraTolleranzaInizio], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/admin/login', (req, res) => {
    const {pin} = req.body;
    if (pin === '259088') {
        res.json({success: true});
    } else {
        res.json({success: false});
    }
});

app.get('/api/task-categories', (req, res) => {
    db.all("SELECT * FROM task_categories ORDER BY ordine", (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/tasks', (req, res) => {
    const query = `
        SELECT t.*, c.nome as categoria_nome, c.colore, c.reset_freq
        FROM tasks t
        JOIN task_categories c ON t.categoria_id = c.id
        WHERE t.attivo = 1
        ORDER BY c.ordine, t.nome
    `;
    db.all(query, (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/tasks', (req, res) => {
    const {nome, categoria_id, postazione, giorno_settimana} = req.body;
    db.run(`INSERT INTO tasks (nome, categoria_id, postazione, giorno_settimana) VALUES (?, ?, ?, ?)`,
        [nome, categoria_id, postazione, giorno_settimana || null],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({id: this.lastID});
        });
});

app.put('/api/tasks/:id', (req, res) => {
    const {nome, categoria_id, postazione, giorno_settimana} = req.body;
    db.run(`UPDATE tasks SET nome=?, categoria_id=?, postazione=?, giorno_settimana=? WHERE id=?`,
        [nome, categoria_id, postazione, giorno_settimana || null, req.params.id],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({message: 'OK'});
        });
});

app.delete('/api/tasks/:id', (req, res) => {
    db.run("UPDATE tasks SET attivo=0 WHERE id=?", [req.params.id], function(err) {
        if (err) return res.status(500).json({error: err.message});
        res.json({message: 'OK'});
    });
});

app.get('/api/tasks/postazione/:postazione', (req, res) => {
    const {postazione} = req.params;
    const now = new Date();
    const oggi = now.toISOString().split('T')[0];
    const dayOfWeek = now.getDay();
    const dayOfMonth = now.getDate();
    const isUltimaSettimana = dayOfMonth >= 24;
    
    const query = `
        SELECT t.*, c.nome as categoria_nome, c.colore, c.reset_freq
        FROM tasks t
        JOIN task_categories c ON t.categoria_id = c.id
        WHERE t.attivo = 1
        AND (t.postazione = ? OR t.postazione = 'qualsiasi')
        AND (
            c.reset_freq = 'turno' OR
            c.reset_freq = 'giorno' OR
            (c.reset_freq = 'settimana' AND (t.giorno_settimana = ? OR t.giorno_settimana IS NULL)) OR
            (c.reset_freq = 'mese' AND ?)
        )
        ORDER BY c.ordine, t.nome
    `;
    
    db.all(query, [postazione, dayOfWeek, isUltimaSettimana ? 1 : 0], (err, tasks) => {
        if (err) return res.status(500).json({error: err.message});
        
        const taskIds = tasks.map(t => t.id);
        if (taskIds.length === 0) return res.json([]);
        
        const completionsQuery = `
            SELECT tc.task_id, tc.dipendente_nome, tc.timestamp, tc.data, tc.ora,
                   cat.reset_freq
            FROM task_completions tc
            JOIN tasks t ON tc.task_id = t.id
            JOIN task_categories cat ON t.categoria_id = cat.id
            WHERE tc.task_id IN (${taskIds.join(',')})
            AND tc.data = ?
            ORDER BY tc.timestamp DESC
        `;
        
        db.all(completionsQuery, [oggi], (err, completions) => {
            if (err) return res.status(500).json({error: err.message});
            
            const oraAttuale = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            const nowMinus30 = new Date(now.getTime() - 30 * 60000);
            const oraTolleranzaInizio = String(nowMinus30.getHours()).padStart(2, '0') + ':' + String(nowMinus30.getMinutes()).padStart(2, '0');
            
            const nowPlus90 = new Date(now.getTime() + 90 * 60000);
            const oraTolleranzaFine = String(nowPlus90.getHours()).padStart(2, '0') + ':' + String(nowPlus90.getMinutes()).padStart(2, '0');
            
            const turnoQuery = `
                SELECT DISTINCT d.nome
                FROM turni t
                JOIN dipendenti d ON t.dipendente_id = d.id
                WHERE t.data = ?
                AND t.orario_inizio <= ?
                AND t.orario_fine >= ?
                AND d.attivo = 1
            `;
            
            db.all(turnoQuery, [oggi, oraAttuale, oraTolleranzaInizio], (errT, turniAdesso) => {
                const dipendentiInTurno = (turniAdesso || []).map(t => t.nome);
                
                const completionsMap = {};
                completions.forEach(c => {
                    if (c.reset_freq === 'turno') {
                        if (!dipendentiInTurno.includes(c.dipendente_nome)) {
                            return;
                        }
                    }
                    
                    if (!completionsMap[c.task_id]) {
                        completionsMap[c.task_id] = [];
                    }
                    completionsMap[c.task_id].push(c);
                });
                
                const tasksWithCompletions = tasks.map(t => ({
                    ...t,
                    completions: completionsMap[t.id] || [],
                    completed: (completionsMap[t.id] || []).length > 0
                }));
                
                res.json(tasksWithCompletions);
            });
        });
    });
});

app.post('/api/tasks/complete', (req, res) => {
    const {task_id, dipendente_nome, turno_id, note} = req.body;
    const now = new Date();
    const oggi = now.toISOString().split('T')[0];
    const ora = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    
    db.run(`INSERT INTO task_completions (task_id, dipendente_nome, data, ora, turno_id, note)
            VALUES (?, ?, ?, ?, ?, ?)`,
        [task_id, dipendente_nome, oggi, ora, turno_id || null, note || null],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({id: this.lastID, message: 'Task completato!'});
        });
});

app.get('/api/tasks/completions/:data', (req, res) => {
    const {data} = req.params;
    
    const query = `
        SELECT 
            tc.*, 
            t.nome as task_nome,
            cat.nome as categoria_nome,
            cat.colore
        FROM task_completions tc
        JOIN tasks t ON tc.task_id = t.id
        JOIN task_categories cat ON t.categoria_id = cat.id
        WHERE tc.data = ?
        ORDER BY tc.timestamp DESC
    `;
    
    db.all(query, [data], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/tasks/incomplete/:data', (req, res) => {
    const {data} = req.params;
    const now = new Date(data);
    const dayOfWeek = now.getDay();
    const dayOfMonth = now.getDate();
    const isUltimaSettimana = dayOfMonth >= 24;
    
    const query = `
        SELECT 
            t.id,
            t.nome as task_nome,
            t.postazione,
            c.nome as categoria_nome,
            c.colore
        FROM tasks t
        JOIN task_categories c ON t.categoria_id = c.id
        WHERE t.attivo = 1
        AND (
            c.reset_freq = 'turno' OR
            c.reset_freq = 'giorno' OR
            (c.reset_freq = 'settimana' AND (t.giorno_settimana = ? OR t.giorno_settimana IS NULL)) OR
            (c.reset_freq = 'mese' AND ?)
        )
        AND t.id NOT IN (
            SELECT task_id FROM task_completions WHERE data = ?
        )
        ORDER BY c.ordine, t.nome
    `;
    
    db.all(query, [dayOfWeek, isUltimaSettimana ? 1 : 0, data], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/tasks/reset', (req, res) => {
    const {reset_type} = req.body;
    
    let query = '';
    if (reset_type === 'giorno') {
        query = "DELETE FROM task_completions WHERE data < date('now', '-7 days')";
    } else if (reset_type === 'settimana') {
        query = "DELETE FROM task_completions WHERE data < date('now', '-30 days')";
    } else if (reset_type === 'mese') {
        query = "DELETE FROM task_completions WHERE data < date('now', '-90 days')";
    }
    
    db.run(query, function(err) {
        if (err) return res.status(500).json({error: err.message});
        res.json({message: 'Reset completato', deleted: this.changes});
    });
});


// CHIUSURA TURNO
app.post('/api/turni/chiudi', (req, res) => {
    const {dipendente_nome, turno_id, task_completati, task_totali} = req.body;
    const now = new Date();
    const oggi = now.toISOString().split('T')[0];
    const ora = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    
    db.run(`INSERT INTO turni_chiusure (turno_id, dipendente_nome, data, ora_chiusura, task_completati, task_totali)
            VALUES (?, ?, ?, ?, ?, ?)`,
        [turno_id || null, dipendente_nome, oggi, ora, task_completati, task_totali],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({id: this.lastID, message: 'Turno chiuso con successo!'});
        });
});

// VERIFICA SE TURNO È CHIUSO
app.get('/api/turni/chiuso/:dipendente/:data', (req, res) => {
    const {dipendente, data} = req.params;
    
    db.get(`SELECT * FROM turni_chiusure 
            WHERE dipendente_nome = ? AND data = ?
            ORDER BY timestamp DESC LIMIT 1`,
        [dipendente, data], (err, row) => {
            if (err) return res.status(500).json({error: err.message});
            res.json({chiuso: !!row, chiusura: row || null});
        });
});

// LISTA CHIUSURE (per admin)
app.get('/api/turni/chiusure/:data', (req, res) => {
    const {data} = req.params;
    
    db.all(`SELECT * FROM turni_chiusure WHERE data = ? ORDER BY ora_chiusura DESC`,
        [data], (err, rows) => {
            if (err) return res.status(500).json({error: err.message});
            res.json(rows);
        });
});


// ==================== API ASSENZE ====================

// GET tutte le assenze
app.get('/api/assenze', (req, res) => {
    db.all(`
        SELECT a.*, d.nome as dipendente_nome 
        FROM assenze a 
        JOIN dipendenti d ON a.dipendente_id = d.id 
        ORDER BY a.data_inizio DESC
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET assenze di un dipendente
app.get('/api/assenze/dipendente/:id', (req, res) => {
    db.all(`
        SELECT * FROM assenze 
        WHERE dipendente_id = ? 
        ORDER BY data_inizio DESC
    `, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET assenze per periodo
app.get('/api/assenze/periodo/:anno/:mese', (req, res) => {
    const { anno, mese } = req.params;
    const start = `${anno}-${mese.padStart(2, '0')}-01`;
    const end = `${anno}-${mese.padStart(2, '0')}-31`;
    
    db.all(`
        SELECT a.*, d.nome as dipendente_nome 
        FROM assenze a 
        JOIN dipendenti d ON a.dipendente_id = d.id 
        WHERE (a.data_inizio BETWEEN ? AND ?) OR (a.data_fine BETWEEN ? AND ?)
        ORDER BY a.data_inizio DESC
    `, [start, end, start, end], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST nuova assenza
app.post('/api/assenze', (req, res) => {
    const { dipendente_id, data_inizio, data_fine, tipo, note } = req.body;
    
    db.run(`
        INSERT INTO assenze (dipendente_id, data_inizio, data_fine, tipo, note) 
        VALUES (?, ?, ?, ?, ?)
    `, [dipendente_id, data_inizio, data_fine, tipo, note || ''], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

// PUT modifica assenza
app.put('/api/assenze/:id', (req, res) => {
    const { dipendente_id, data_inizio, data_fine, tipo, note } = req.body;
    
    db.run(`
        UPDATE assenze 
        SET dipendente_id = ?, data_inizio = ?, data_fine = ?, tipo = ?, note = ?
        WHERE id = ?
    `, [dipendente_id, data_inizio, data_fine, tipo, note || '', req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ changes: this.changes });
    });
});

// DELETE assenza
app.delete('/api/assenze/:id', (req, res) => {
    db.run('DELETE FROM assenze WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ changes: this.changes });
    });
});

// ==================== FINE API ASSENZE ====================



// API turni di oggi con nomi dipendenti
app.get('/api/turni/oggi', (req, res) => {
    const oggi = new Date().toISOString().split('T')[0];
    
    db.all(`
        SELECT t.*, d.nome, d.ruolo 
        FROM turni t
        JOIN dipendenti d ON t.dipendente_id = d.id
        WHERE t.data = ?
        ORDER BY t.orario_inizio
    `, [oggi], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});


// ==================== API TURNI GIORNO (per checklist) ====================
app.get('/api/turni/giorno/:data', (req, res) => {
    db.all(`
        SELECT t.*, d.nome, d.ruolo 
        FROM turni t
        JOIN dipendenti d ON t.dipendente_id = d.id
        WHERE t.data = ?
        ORDER BY t.orario_inizio
    `, [req.params.data], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});
// ==================== FINE API TURNI GIORNO ====================

// ========================================
// API GESTIONE CREDENZIALI DIPENDENTI
// ========================================

// Crea credenziali per un dipendente (admin)
app.post('/api/credenziali/crea', async (req, res) => {
    const { dipendente_id, username, password } = req.body;

    if (!dipendente_id || !username || !password) {
        return res.status(400).json({ error: 'Dati mancanti' });
    }

    try {
        // Hash della password
        const password_hash = await bcrypt.hash(password, 10);

        db.run(
            `INSERT INTO credenziali_dipendenti (dipendente_id, username, password_hash) VALUES (?, ?, ?)`,
            [dipendente_id, username, password_hash],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Username o dipendente già esistente' });
                    }
                    return res.status(500).json({ error: err.message });
                }
                res.json({ success: true, id: this.lastID });
            }
        );
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login dipendente
app.post('/api/dipendente/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username e password richiesti' });
    }

    db.get(
        `SELECT c.*, d.nome, d.ruolo
         FROM credenziali_dipendenti c
         JOIN dipendenti d ON c.dipendente_id = d.id
         WHERE c.username = ? AND d.attivo = 1`,
        [username],
        async (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!row) {
                return res.status(401).json({ error: 'Credenziali non valide' });
            }

            // Verifica password
            const match = await bcrypt.compare(password, row.password_hash);

            if (!match) {
                return res.status(401).json({ error: 'Credenziali non valide' });
            }

            // Aggiorna ultimo accesso
            db.run(
                `UPDATE credenziali_dipendenti SET ultimo_accesso = CURRENT_TIMESTAMP WHERE id = ?`,
                [row.id]
            );

            res.json({
                success: true,
                dipendente_id: row.dipendente_id,
                username: row.username,
                nome: row.nome,
                ruolo: row.ruolo
            });
        }
    );
});

// Cambio password dipendente
app.post('/api/dipendente/cambio-password', async (req, res) => {
    const { dipendente_id, vecchia_password, nuova_password } = req.body;

    if (!dipendente_id || !vecchia_password || !nuova_password) {
        return res.status(400).json({ error: 'Dati mancanti' });
    }

    db.get(
        `SELECT * FROM credenziali_dipendenti WHERE dipendente_id = ?`,
        [dipendente_id],
        async (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!row) {
                return res.status(404).json({ error: 'Credenziali non trovate' });
            }

            // Verifica vecchia password
            const match = await bcrypt.compare(vecchia_password, row.password_hash);

            if (!match) {
                return res.status(401).json({ error: 'Vecchia password errata' });
            }

            // Hash nuova password
            const new_hash = await bcrypt.hash(nuova_password, 10);

            db.run(
                `UPDATE credenziali_dipendenti SET password_hash = ? WHERE dipendente_id = ?`,
                [new_hash, dipendente_id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ success: true });
                }
            );
        }
    );
});

// Lista dipendenti con credenziali (admin)
app.get('/api/credenziali/lista', (req, res) => {
    db.all(
        `SELECT d.id, d.nome, d.ruolo, c.username, c.ultimo_accesso, c.creato_il
         FROM dipendenti d
         LEFT JOIN credenziali_dipendenti c ON d.id = c.dipendente_id
         WHERE d.attivo = 1
         ORDER BY d.nome`,
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

// ========================================
// API ADMIN - UPLOAD CEDOLINI
// ========================================

// Upload cedolino PDF (admin)
app.post('/api/admin/upload-cedolino', uploadCedolini.single('cedolino'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nessun file caricato' });
    }

    const { dipendente_id, anno, mese, descrizione } = req.body;

    if (!dipendente_id || !anno || !mese) {
        // Rimuovi file caricato se i dati sono incompleti
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Dati mancanti: dipendente_id, anno, mese richiesti' });
    }

    db.run(
        `INSERT INTO cedolini_files (dipendente_id, filename, filepath, filesize, anno, mese, descrizione)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            dipendente_id,
            req.file.originalname,
            req.file.path,
            req.file.size,
            anno,
            mese,
            descrizione || null
        ],
        function(err) {
            if (err) {
                // Rimuovi file se inserimento DB fallisce
                fs.unlinkSync(req.file.path);
                return res.status(500).json({ error: err.message });
            }
            res.json({
                success: true,
                id: this.lastID,
                filename: req.file.originalname,
                size: req.file.size
            });
        }
    );
});

// Lista cedolini per dipendente (admin o dipendente)
app.get('/api/cedolini/:dipendente_id', (req, res) => {
    db.all(
        `SELECT c.*, d.nome as dipendente_nome
         FROM cedolini_files c
         JOIN dipendenti d ON c.dipendente_id = d.id
         WHERE c.dipendente_id = ?
         ORDER BY c.anno DESC, c.mese DESC`,
        [req.params.dipendente_id],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            // Rimuovi il filepath completo per sicurezza
            const sanitized = rows.map(r => ({
                ...r,
                filepath: undefined,
                download_url: `/api/cedolini/download/${r.id}`
            }));
            res.json(sanitized);
        }
    );
});

// Download cedolino PDF
app.get('/api/cedolini/download/:id', (req, res) => {
    db.get(
        `SELECT * FROM cedolini_files WHERE id = ?`,
        [req.params.id],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!row) {
                return res.status(404).json({ error: 'Cedolino non trovato' });
            }

            // Verifica che il file esista
            if (!fs.existsSync(row.filepath)) {
                return res.status(404).json({ error: 'File non trovato sul server' });
            }

            res.download(row.filepath, row.filename);
        }
    );
});

// Elimina cedolino (admin)
app.delete('/api/admin/cedolino/:id', (req, res) => {
    db.get(
        `SELECT * FROM cedolini_files WHERE id = ?`,
        [req.params.id],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!row) {
                return res.status(404).json({ error: 'Cedolino non trovato' });
            }

            // Elimina file dal filesystem
            if (fs.existsSync(row.filepath)) {
                fs.unlinkSync(row.filepath);
            }

            // Elimina record dal database
            db.run(
                `DELETE FROM cedolini_files WHERE id = ?`,
                [req.params.id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ success: true });
                }
            );
        }
    );
});

// ========================================
// API DIPENDENTE - UPLOAD FILE PERSONALI
// ========================================

// Upload file personale (dipendente)
app.post('/api/dipendente/upload-file', uploadDipendenti.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nessun file caricato' });
    }

    const { dipendente_id, descrizione } = req.body;

    if (!dipendente_id) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'dipendente_id richiesto' });
    }

    db.run(
        `INSERT INTO dipendenti_uploads (dipendente_id, filename, filepath, filesize, tipo, descrizione)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            dipendente_id,
            req.file.originalname,
            req.file.path,
            req.file.size,
            req.file.mimetype,
            descrizione || null
        ],
        function(err) {
            if (err) {
                fs.unlinkSync(req.file.path);
                return res.status(500).json({ error: err.message });
            }
            res.json({
                success: true,
                id: this.lastID,
                filename: req.file.originalname,
                size: req.file.size
            });
        }
    );
});

// Lista file caricati dal dipendente
app.get('/api/dipendente/files/:dipendente_id', (req, res) => {
    db.all(
        `SELECT id, filename, filesize, tipo, descrizione, caricato_il
         FROM dipendenti_uploads
         WHERE dipendente_id = ?
         ORDER BY caricato_il DESC`,
        [req.params.dipendente_id],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

// Download file personale dipendente
app.get('/api/dipendente/download/:id', (req, res) => {
    db.get(
        `SELECT * FROM dipendenti_uploads WHERE id = ?`,
        [req.params.id],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!row) {
                return res.status(404).json({ error: 'File non trovato' });
            }

            if (!fs.existsSync(row.filepath)) {
                return res.status(404).json({ error: 'File non trovato sul server' });
            }

            res.download(row.filepath, row.filename);
        }
    );
});

// Elimina file personale dipendente
app.delete('/api/dipendente/file/:id', (req, res) => {
    const { dipendente_id } = req.body;

    db.get(
        `SELECT * FROM dipendenti_uploads WHERE id = ? AND dipendente_id = ?`,
        [req.params.id, dipendente_id],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!row) {
                return res.status(404).json({ error: 'File non trovato' });
            }

            // Elimina file dal filesystem
            if (fs.existsSync(row.filepath)) {
                fs.unlinkSync(row.filepath);
            }

            // Elimina record dal database
            db.run(
                `DELETE FROM dipendenti_uploads WHERE id = ?`,
                [req.params.id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ success: true });
                }
            );
        }
    );
});

app.listen(PORT, () => {
    console.log('🚀 SERVER AVVIATO: http://localhost:' + PORT);
    console.log('📋 Gestionale Turni: http://localhost:' + PORT + '/index.html');
    console.log('✅ Checklist Dipendenti: http://localhost:' + PORT + '/checklist.html');
    console.log('🔧 Admin Checklist: http://localhost:' + PORT + '/admin-tasks.html');
    console.log('📄 Admin Cedolini: http://localhost:' + PORT + '/admin-cedolini.html');
    console.log('👤 Portale Dipendente: http://localhost:' + PORT + '/portale-dipendente.html');
});
