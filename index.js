const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const player = require('play-sound')(opts = {});

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('schoolbell.db', (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to SQLite database.');
});

// Create tables
db.serialize(() => {
    // Schedules table
    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        time TEXT NOT NULL,
        sound TEXT NOT NULL
    )`);

    // Sounds table to track uploaded sounds
    db.run(`CREATE TABLE IF NOT EXISTS sounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        originalname TEXT NOT NULL,
        filepath TEXT NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '-');
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

// Helper function to play sound
function playSound(soundPath) {
    const fullPath = path.join(__dirname, 'public', soundPath);
    console.log(`Playing sound: ${fullPath}`);

    player.play(fullPath, (err) => {
        if (err) {
            console.error('Error playing sound:', err);
            // Fallback to ffplay if play-sound fails
            exec(`ffplay -nodisp -autoexit "${fullPath}"`, (error) => {
                if (error) console.error('Error playing with ffplay:', error);
            });
        }
    });
}

// Function to schedule all bells using node-cron
const scheduleAllBells = () => {
    // Clear all existing scheduled tasks
    for (const task of cron.getTasks()) {
        task.stop();
    }

    db.all("SELECT * FROM schedules", (err, rows) => {
        if (err) {
            console.error("Error fetching schedules:", err);
            return;
        }

        rows.forEach(row => {
            const [hour, minute] = row.time.split(':');
            const dayMap = {
                'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                'Thursday': 4, 'Friday': 5, 'Saturday': 6
            };

            const cronExpression = `${minute} ${hour} * * ${dayMap[row.day]}`;
            console.log(`Scheduling bell for ${row.day} at ${row.time} with sound ${row.sound}`);

            cron.schedule(cronExpression, () => {
                console.log(`Triggering bell for ${row.day} at ${row.time}`);
                playSound(row.sound);
            });
        });
    });
};

// API to get all available sounds
app.get('/sounds', (req, res) => {
    db.all("SELECT * FROM sounds ORDER BY uploaded_at DESC", (err, rows) => {
        if (err) return res.status(500).send(err.message);
        res.json(rows);
    });
});

// API to upload MP3
app.post('/upload-sound', upload.single('sound'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const soundPath = `/uploads/${req.file.filename}`;

    db.run(
        "INSERT INTO sounds (filename, originalname, filepath) VALUES (?, ?, ?)",
        [req.file.filename, req.file.originalname, soundPath],
        function (err) {
            if (err) return res.status(500).send(err.message);
            res.status(201).json({
                id: this.lastID,
                filename: req.file.filename,
                originalname: req.file.originalname,
                filepath: soundPath
            });
        }
    );
});

// API to add schedule
app.post('/schedule', (req, res) => {
    const { day, time, soundPath } = req.body;

    db.run(
        "INSERT INTO schedules (day, time, sound) VALUES (?, ?, ?)",
        [day, time, soundPath],
        function (err) {
            if (err) return res.status(500).send(err.message);
            scheduleAllBells(); // Reschedule all bells
            res.status(201).json({
                id: this.lastID,
                day,
                time,
                sound: soundPath
            });
        }
    );
});

// API to get all schedules
app.get('/schedules', (req, res) => {
    db.all("SELECT schedules.*, sounds.originalname FROM schedules LEFT JOIN sounds ON schedules.sound = sounds.filepath", (err, rows) => {
        if (err) return res.status(500).send(err.message);
        res.json(rows);
    });
});

// API to delete a schedule
app.delete('/schedule/:id', (req, res) => {
    const { id } = req.params;

    db.run("DELETE FROM schedules WHERE id = ?", id, function (err) {
        if (err) return res.status(500).send(err.message);
        scheduleAllBells(); // Reschedule all bells
        res.status(200).send("Deleted successfully.");
    });
});

// API to update a schedule
app.put('/schedule/:id', (req, res) => {
    const { id } = req.params;
    const { day, time, soundPath } = req.body;

    db.run(
        "UPDATE schedules SET day = ?, time = ?, sound = ? WHERE id = ?",
        [day, time, soundPath, id],
        function (err) {
            if (err) return res.status(500).send(err.message);
            scheduleAllBells(); // Reschedule all bells
            res.status(200).send("Updated successfully.");
        }
    );
});

// Test endpoint to trigger sound immediately
app.post('/test-sound', (req, res) => {
    const { soundPath } = req.body;
    playSound(soundPath);
    res.status(200).send("Playing sound...");
});

// Schedule all existing bells on server start
scheduleAllBells();

// Start server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));