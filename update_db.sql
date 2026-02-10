CREATE TABLE IF NOT EXISTS turni (
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
);
