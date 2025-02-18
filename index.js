const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('schoolbell.db', (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to SQLite database.');
});

db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    sound TEXT NOT NULL
)`);

// Function to update crontab
const updateCrontab = () => {
    db.all("SELECT * FROM schedules", (err, rows) => {
        if (err) {
            console.error("Error fetching schedules:", err);
            return;
        }
        let cronJobs = rows.map(row => `${row.time} ffplay -nodisp -autoexit ${row.sound} &`).join('\n');
        fs.writeFileSync('/tmp/schoolbell_cron', cronJobs);
        exec("crontab /tmp/schoolbell_cron", (error) => {
            if (error) console.error("Error updating crontab:", error);
            else console.log("Crontab updated successfully.");
        });
    });
};

// API to add a bell schedule
app.post('/schedule', (req, res) => {
    const { time, sound } = req.body;
    if (!time || !sound) return res.status(400).send("Missing time or sound.");

    db.run("INSERT INTO schedules (time, sound) VALUES (?, ?)", [time, sound], function (err) {
        if (err) return res.status(500).send(err.message);
        updateCrontab();
        res.status(201).json({ id: this.lastID, time, sound });
    });
});

// API to get all schedules
app.get('/schedules', (req, res) => {
    db.all("SELECT * FROM schedules", (err, rows) => {
        if (err) return res.status(500).send(err.message);
        res.json(rows);
    });
});

// API to delete a schedule
app.delete('/schedule/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM schedules WHERE id = ?", id, function (err) {
        if (err) return res.status(500).send(err.message);
        updateCrontab();
        res.status(200).send("Deleted successfully.");
    });
});

// API to update a schedule
app.put('/schedule/:id', (req, res) => {
    const { id } = req.params;
    const { time, sound } = req.body;
    db.run("UPDATE schedules SET time = ?, sound = ? WHERE id = ?", [time, sound, id], function (err) {
        if (err) return res.status(500).send(err.message);
        updateCrontab();
        res.status(200).send("Updated successfully.");
    });
});

// Serve HTML UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
