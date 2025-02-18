const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const player = require('play-sound')(opts = {});

const app = express();
const PORT = 3000;

// Task management
const cronTasks = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup
let db;
async function initializeDatabase() {
    db = await open({
        filename: 'schoolbell.db',
        driver: sqlite3.Database
    });

    // Create tables
    await db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        time TEXT NOT NULL,
        sound TEXT NOT NULL
    )`);

    await db.run(`CREATE TABLE IF NOT EXISTS sounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        originalname TEXT NOT NULL,
        filepath TEXT NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Database initialized');
    scheduleAllBells();
}

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Configure Multer
const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '-');
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

// Sound playback function (unchanged)
function playSound(soundPath) {
    const fullPath = path.join(__dirname, 'public', soundPath);
    console.log(`Playing sound: ${fullPath}`);

    player.play(fullPath, (err) => {
        if (err) {
            console.error('Error playing sound with play-sound:', err);
            exec(`ffplay -nodisp -autoexit "${fullPath}"`, (error) => {
                if (error) console.error('Error playing with ffplay:', error);
            });
        }
    });
}

// Scheduling functions (unchanged logic)
function scheduleBell(schedule) {
    const [hour, minute] = schedule.time.split(':');
    const dayMap = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
        'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };

    const cronExpression = `${minute} ${hour} * * ${dayMap[schedule.day]}`;

    if (cronTasks.has(schedule.id)) {
        cronTasks.get(schedule.id).stop();
        cronTasks.delete(schedule.id);
    }

    const task = cron.schedule(cronExpression, () => {
        console.log(`Triggering bell for ${schedule.day} at ${schedule.time}`);
        playSound(schedule.sound);
    });

    cronTasks.set(schedule.id, task);
}

const scheduleAllBells = async () => {
    cronTasks.forEach(task => task.stop());
    cronTasks.clear();

    try {
        const rows = await db.all("SELECT * FROM schedules");
        rows.forEach(schedule => scheduleBell(schedule));
    } catch (err) {
        console.error("Error fetching schedules:", err);
    }
};

// API Endpoints
app.get('/sounds', async (req, res) => {
    try {
        const rows = await db.all("SELECT * FROM sounds ORDER BY uploaded_at DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/upload-sound', upload.single('sound'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const soundPath = `/uploads/${req.file.filename}`;

    try {
        const result = await db.run(
            "INSERT INTO sounds (filename, originalname, filepath) VALUES (?, ?, ?)",
            [req.file.filename, req.file.originalname, soundPath]
        );

        res.status(201).json({
            id: result.lastID,
            filename: req.file.filename,
            originalname: req.file.originalname,
            filepath: soundPath
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/schedule', async (req, res) => {
    const { day, time, soundPath } = req.body;

    try {
        const result = await db.run(
            "INSERT INTO schedules (day, time, sound) VALUES (?, ?, ?)",
            [day, time, soundPath]
        );

        scheduleBell({
            id: result.lastID,
            day,
            time,
            sound: soundPath
        });

        res.status(201).json({
            id: result.lastID,
            day,
            time,
            sound: soundPath
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/schedules', async (req, res) => {
    try {
        const rows = await db.all(
            "SELECT schedules.*, sounds.originalname FROM schedules " +
            "LEFT JOIN sounds ON schedules.sound = sounds.filepath"
        );
        res.json(rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.delete('/schedule/:id', async (req, res) => {
    const id = parseInt(req.params.id);

    if (cronTasks.has(id)) {
        cronTasks.get(id).stop();
        cronTasks.delete(id);
    }

    try {
        await db.run("DELETE FROM schedules WHERE id = ?", id);
        res.status(200).send("Deleted successfully.");
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.put('/schedule/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { day, time, soundPath } = req.body;

    try {
        await db.run(
            "UPDATE schedules SET day = ?, time = ?, sound = ? WHERE id = ?",
            [day, time, soundPath, id]
        );

        scheduleBell({
            id,
            day,
            time,
            sound: soundPath
        });

        res.status(200).send("Updated successfully.");
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Remaining endpoints (test-sound, time-related) remain unchanged

// Initialize database and start server
initializeDatabase()
    .then(() => {
        app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    })
    .catch(err => {
        console.error('Database initialization failed:', err);
        process.exit(1);
    });