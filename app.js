const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const sqlite3 = require('better-sqlite3'); // Use better-sqlite3
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const player = require('play-sound')(opts = {});

const app = express();
const PORT = 3000;

// NEW: Added task management
const cronTasks = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup using better-sqlite3
const db = new sqlite3('schoolbell.db', { verbose: console.log });

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        time TEXT NOT NULL,
        sound TEXT NOT NULL
    );
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS sounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        originalname TEXT NOT NULL,
        filepath TEXT NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

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

    // First try with play-sound
    player.play(fullPath, (err) => {
        if (err) {
            console.error('Error playing sound with play-sound:', err);
            // Fallback to ffplay
            exec(`ffplay -nodisp -autoexit "${fullPath}"`, (error) => {
                if (error) console.error('Error playing with ffplay:', error);
            });
        }
    });
}

// NEW: Separate function to schedule a single bell
function scheduleBell(schedule) {
    const [hour, minute] = schedule.time.split(':');
    const dayMap = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
        'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };

    const cronExpression = `${minute} ${hour} * * ${dayMap[schedule.day]}`;
    console.log(`Scheduling bell for ${schedule.day} at ${schedule.time} with sound ${schedule.sound}`);

    try {
        // Stop existing task if it exists
        if (cronTasks.has(schedule.id)) {
            cronTasks.get(schedule.id).stop();
            cronTasks.delete(schedule.id);
        }

        // Create and store new task
        const task = cron.schedule(cronExpression, () => {
            console.log(`Triggering bell for ${schedule.day} at ${schedule.time}`);
            playSound(schedule.sound);
        });

        cronTasks.set(schedule.id, task);
    } catch (error) {
        console.error(`Error scheduling bell for ID ${schedule.id}:`, error);
    }
}

// MODIFIED: Updated scheduleAllBells function
const scheduleAllBells = () => {
    // Stop all existing tasks
    for (const [id, task] of cronTasks.entries()) {
        task.stop();
        cronTasks.delete(id);
    }

    // Schedule all bells from database
    const rows = db.prepare("SELECT * FROM schedules").all();
    rows.forEach(schedule => {
        scheduleBell(schedule);
    });
};

// API to get all available sounds
app.get('/sounds', (req, res) => {
    const rows = db.prepare("SELECT * FROM sounds ORDER BY uploaded_at DESC").all();
    res.json(rows);
});

// API to upload MP3
app.post('/upload-sound', upload.single('sound'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const soundPath = `/uploads/${req.file.filename}`;

    const stmt = db.prepare("INSERT INTO sounds (filename, originalname, filepath) VALUES (?, ?, ?)");
    const result = stmt.run(req.file.filename, req.file.originalname, soundPath);

    res.status(201).json({
        id: result.lastInsertRowid,
        filename: req.file.filename,
        originalname: req.file.originalname,
        filepath: soundPath
    });
});

// MODIFIED: Updated schedule creation
app.post('/schedule', (req, res) => {
    const { day, time, soundPath } = req.body;

    const stmt = db.prepare("INSERT INTO schedules (day, time, sound) VALUES (?, ?, ?)");
    const result = stmt.run(day, time, soundPath);

    // Schedule the new bell immediately
    scheduleBell({
        id: result.lastInsertRowid,
        day,
        time,
        sound: soundPath
    });

    res.status(201).json({
        id: result.lastInsertRowid,
        day,
        time,
        sound: soundPath
    });
});

// API to get all schedules
app.get('/schedules', (req, res) => {
    const rows = db.prepare(`
        SELECT schedules.*, sounds.originalname 
        FROM schedules 
        LEFT JOIN sounds ON schedules.sound = sounds.filepath
    `).all();
    res.json(rows);
});

// MODIFIED: Updated schedule deletion
app.delete('/schedule/:id', (req, res) => {
    const { id } = req.params;

    // Stop and remove the cron task
    if (cronTasks.has(parseInt(id))) {
        cronTasks.get(parseInt(id)).stop();
        cronTasks.delete(parseInt(id));
    }

    const stmt = db.prepare("DELETE FROM schedules WHERE id = ?");
    stmt.run(id);

    res.status(200).send("Deleted successfully.");
});

// MODIFIED: Updated schedule update
app.put('/schedule/:id', (req, res) => {
    const { id } = req.params;
    const { day, time, soundPath } = req.body;

    const stmt = db.prepare("UPDATE schedules SET day = ?, time = ?, sound = ? WHERE id = ?");
    stmt.run(day, time, soundPath, id);

    // Reschedule the updated bell
    scheduleBell({
        id: parseInt(id),
        day,
        time,
        sound: soundPath
    });

    res.status(200).send("Updated successfully.");
});

let customTime = new Date(); // Initial system time is set to the current date and time.

app.get('/current-time', (req, res) => {
    // Get the custom system time or the actual system time if it's not set
    res.json({ currentTime: customTime });
});

app.post('/set-system-time', (req, res) => {
    const { newTime } = req.body;

    if (!newTime) {
        return res.status(400).send("New time must be provided.");
    }

    // Validate time format (ISO string or other formats)
    const parsedTime = new Date(newTime);
    if (isNaN(parsedTime)) {
        return res.status(400).send("Invalid time format.");
    }

    // Command for Linux/macOS
    const command = `sudo date --set="${parsedTime.toISOString()}"`;

    // For Windows, use `time` command instead of `date`:
    // const command = `time ${parsedTime.getHours()}:${parsedTime.getMinutes()}:${parsedTime.getSeconds()}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).send(`Error setting system time: ${stderr || error.message}`);
        }
        res.status(200).send(`System time updated to: ${parsedTime}`);
    });
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
