#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'gestionale.db');
const db = new sqlite3.Database(dbPath);

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

async function resetTasks() {
    log('🔄 Inizio reset task...');

    const now = new Date();
    const dayOfWeek = now.getDay();
    const dayOfMonth = now.getDate();

    try {
        await new Promise((resolve, reject) => {
            const query = `
                DELETE FROM task_completions 
                WHERE task_id IN (
                    SELECT t.id FROM tasks t
                    JOIN task_categories c ON t.categoria_id = c.id
                    WHERE c.reset_freq = 'giorno'
                )
                AND data < date('now')
            `;
            
            db.run(query, function(err) {
                if (err) {
                    reject(err);
                } else {
                    log(`✅ Reset giornalieri: ${this.changes} completamenti rimossi`);
                    resolve();
                }
            });
        });

        if (dayOfWeek === 1) {
            await new Promise((resolve, reject) => {
                const query = `
                    DELETE FROM task_completions 
                    WHERE task_id IN (
                        SELECT t.id FROM tasks t
                        JOIN task_categories c ON t.categoria_id = c.id
                        WHERE c.reset_freq = 'settimana'
                    )
                    AND data < date('now', '-7 days')
                `;
                
                db.run(query, function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        log(`✅ Reset settimanali (Lunedì): ${this.changes} completamenti rimossi`);
                        resolve();
                    }
                });
            });
        }

        if (dayOfMonth === 1) {
            await new Promise((resolve, reject) => {
                const query = `
                    DELETE FROM task_completions 
                    WHERE task_id IN (
                        SELECT t.id FROM tasks t
                        JOIN task_categories c ON t.categoria_id = c.id
                        WHERE c.reset_freq = 'mese'
                    )
                    AND data < date('now', 'start of month')
                `;
                
                db.run(query, function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        log(`✅ Reset mensili (primo del mese): ${this.changes} completamenti rimossi`);
                        resolve();
                    }
                });
            });
        }

        await new Promise((resolve, reject) => {
            const query = `DELETE FROM task_completions WHERE data < date('now', '-90 days')`;
            
            db.run(query, function(err) {
                if (err) {
                    reject(err);
                } else {
                    log(`🧹 Pulizia dati vecchi: ${this.changes} completamenti rimossi`);
                    resolve();
                }
            });
        });

        log('✅ Reset completato con successo!');
        
    } catch (error) {
        log(`❌ ERRORE durante reset: ${error.message}`);
        process.exit(1);
    } finally {
        db.close();
    }
}

resetTasks().then(() => {
    process.exit(0);
}).catch(err => {
    log(`❌ ERRORE FATALE: ${err.message}`);
    process.exit(1);
});
