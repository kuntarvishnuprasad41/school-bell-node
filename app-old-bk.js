const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const player = require('play-sound')({ player: 'mpg123' });

const app = express();
const PORT = 3000;

// Task management
const cronTasks = new Map();
// New: Add a separate map for serializable cron job data
const cronJobsInfo = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Paths for JSON files
const schedulesFilePath = path.join(__dirname, 'schedules.json');
const soundsFilePath = path.join(__dirname, 'sounds.json');

// Read data from JSON files
const readData = (filePath) => {
    if (fs.existsSync(filePath)) {
        const rawData = fs.readFileSync(filePath);
        return JSON.parse(rawData);
    }
    return [];
};

// Write data to JSON files
const writeData = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

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

function playSound(soundPath) {
    const fullPath = path.join(__dirname, 'public', soundPath);  // Construct the full file path
    console.log(`Playing sound with ffplay: ${fullPath}`);

    // Run the ffplay command as the current user (not root)
    exec(`sudo -E -u kuvi41 sh -c "mpg123 ${fullPath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error('Error playing with ffplay:', error);
        }
        if (stderr) {
            console.error('ffplay error:', stderr);
        }
        if (stdout) {
            console.log('ffplay output:', stdout);
        }
    });
}

function scheduleBell(schedule) {
    const [hour, minute] = schedule.time.split(':');
    const dayMap = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
        'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };

    let cronExpression;

    // Check if the schedule is for weekdays (Monday to Thursday)
    if (schedule.day === 'Weekdays') {
        // Cron expression for Monday to Thursday
        cronExpression = `${minute} ${hour} * * 1-4`; // 1-4 represents Monday to Thursday
    } else {
        // Regular single day cron expression
        cronExpression = `${minute} ${hour} * * ${dayMap[schedule.day]}`;
    }

    console.log(`Scheduling bell for ${schedule.day} at ${schedule.time} with sound ${schedule.sound}`);

    try {
        // Stop existing task if it exists
        if (cronTasks.has(schedule.id)) {
            cronTasks.get(schedule.id).stop();
            cronTasks.delete(schedule.id);

            // Also remove from our serializable map
            cronJobsInfo.delete(schedule.id);
        }

        // Create and store new task
        const task = cron.schedule(cronExpression, () => {
            console.log(`Triggering bell for ${schedule.day} at ${schedule.time}`);
            playSound(schedule.sound);
        });

        cronTasks.set(schedule.id, task);
        task.start(); // Start the task immediately

        // Store serializable info for the API
        cronJobsInfo.set(schedule.id, {
            id: schedule.id,
            day: schedule.day,
            time: schedule.time,
            sound: schedule.sound,
            cronExpression: cronExpression,
            status: 'active',
            createdAt: new Date().toISOString()
        });
    } catch (error) {
        console.error(`Error scheduling bell for ID ${schedule.id}:`, error);
    }
}

// Schedule all bells
const scheduleAllBells = () => {
    // Stop all existing tasks
    for (const [id, task] of cronTasks.entries()) {
        task.stop();
        cronTasks.delete(id);
    }

    // Clear the info map
    cronJobsInfo.clear();

    // Schedule all bells from the loaded data
    const schedules = readData(schedulesFilePath);
    schedules.forEach(schedule => {
        scheduleBell(schedule);
    });
};

// API to get all available sounds
app.get('/sounds', (req, res) => {
    const sounds = readData(soundsFilePath);
    res.json(sounds);
});

// API to upload MP3
app.post('/upload-sound', upload.single('sound'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const soundPath = `/uploads/${req.file.filename}`;

    const sounds = readData(soundsFilePath);
    const newSound = { id: Date.now(), filename: req.file.filename, originalname: req.file.originalname, filepath: soundPath };
    sounds.push(newSound);
    writeData(soundsFilePath, sounds);

    res.status(201).json(newSound);
});

// Schedule creation
app.post('/schedule', (req, res) => {
    const { day, time, soundPath } = req.body;
    const schedules = readData(schedulesFilePath);
    const newSchedule = { id: Date.now(), day, time, sound: soundPath };
    schedules.push(newSchedule);
    writeData(schedulesFilePath, schedules);

    // Schedule the new bell immediately
    scheduleBell(newSchedule);

    res.status(201).json(newSchedule);
});

// API to get all schedules
app.get('/schedules', (req, res) => {
    const schedules = readData(schedulesFilePath);
    const sounds = readData(soundsFilePath);

    // Create a map of sounds using the file path as the key
    const soundMap = sounds.reduce((acc, sound) => {
        acc[sound.filepath] = sound.originalname; // Use 'filepath' as the key
        return acc;
    }, {});

    // Attach filename (filepath) and originalname to each schedule
    const enrichedSchedules = schedules.map(schedule => ({
        ...schedule,
        filename: schedule.sound,  // Assuming `schedule.sound` is the filepath
        originalname: soundMap[schedule.sound] || 'Unknown',
    }));

    res.json(enrichedSchedules);
});

// Schedule deletion
app.delete('/schedule/:id', (req, res) => {
    const { id } = req.params;
    const schedules = readData(schedulesFilePath);

    // Remove the schedule and stop the cron task
    const index = schedules.findIndex(schedule => schedule.id === parseInt(id));
    if (index !== -1) {
        schedules.splice(index, 1);
        writeData(schedulesFilePath, schedules);

        // Stop the cron task
        if (cronTasks.has(parseInt(id))) {
            cronTasks.get(parseInt(id)).stop();
            cronTasks.delete(parseInt(id));

            // Also remove from our info map
            cronJobsInfo.delete(parseInt(id));
        }

        res.status(200).send("Deleted successfully.");
    } else {
        res.status(404).send("Schedule not found.");
    }
});

// Schedule update
app.put('/schedule/:id', (req, res) => {
    const { id } = req.params;
    const { day, time, soundPath } = req.body;
    const schedules = readData(schedulesFilePath);

    const schedule = schedules.find(s => s.id === parseInt(id));
    if (schedule) {
        schedule.day = day;
        schedule.time = time;
        schedule.sound = soundPath;

        writeData(schedulesFilePath, schedules);

        // Reschedule the updated bell
        scheduleBell(schedule);

        res.status(200).send("Updated successfully.");
    } else {
        res.status(404).send("Schedule not found.");
    }
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

// API to delete a sound file
app.delete('/delete-sound/:id', (req, res) => {
    const { id } = req.params;

    // Read the current sounds data
    const sounds = readData(soundsFilePath);

    // Find the sound file by its ID
    const soundIndex = sounds.findIndex(sound => sound.id === parseInt(id));

    if (soundIndex !== -1) {
        // Get the sound file details
        const soundToDelete = sounds[soundIndex];

        // Delete the file from the server
        const filePath = path.join(__dirname, 'public', soundToDelete.filepath);
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error('Error deleting file:', err);
                return res.status(500).send('Error deleting the file.');
            }

            // Remove the sound from the JSON file
            sounds.splice(soundIndex, 1);
            writeData(soundsFilePath, sounds);

            res.status(200).send('Sound file deleted successfully.');
        });
    } else {
        res.status(404).send('Sound file not found.');
    }
});

// FIXED: API to get all cron jobs - now uses the serializable map
app.get('/api/cron-jobs', (req, res) => {
    const jobsArray = Array.from(cronJobsInfo.values());
    res.json({
        total: jobsArray.length,
        jobs: jobsArray
    });
});

// Add a new endpoint to get details about a specific cron job
app.get('/api/cron-jobs/:id', (req, res) => {
    const { id } = req.params;
    const numericId = parseInt(id);

    if (!cronJobsInfo.has(numericId)) {
        return res.status(404).json({ error: `Cron job with ID '${id}' not found` });
    }

    res.json(cronJobsInfo.get(numericId));
});

// Schedule all existing bells on server start
scheduleAllBells();

// Start server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
