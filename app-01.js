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

// Task management maps
const cronTasks = new Map();
const cronJobsInfo = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Paths for JSON files
const schedulesFilePath = path.join(__dirname, 'schedules.json');
const soundsFilePath = path.join(__dirname, 'sounds.json');

// Utility functions to read/write JSON files
const readData = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const rawData = fs.readFileSync(filePath);
      return JSON.parse(rawData);
    }
    console.log(`File not found: ${filePath}`);
    return [];
  } catch (error) {
    console.error(`Error reading file at ${filePath}:`, error);
    return [];
  }
};

const writeData = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing to file at ${filePath}:`, error);
  }
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

// Function to play a sound file using mpg123 (via exec with sudo)
function playSound(soundPath) {
  const fullPath = path.join(__dirname, 'public', soundPath);
  console.log(`Playing sound from: ${fullPath}`);

  exec(`sudo -E -u kuvi41 sh -c "mpg123 ${fullPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error playing sound:', error);
    }
    if (stderr) {
      console.error('mpg123 stderr:', stderr);
    }
    if (stdout) {
      console.log('mpg123 stdout:', stdout);
    }
  });
}

// Function to schedule a bell based on a schedule object { id, day, time, sound }
function scheduleBell(schedule) {
  try {
    const [hour, minute] = schedule.time.split(':');
    const dayMap = {
      'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
      'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };

    let cronExpression;
    if (schedule.day === 'Weekdays') {
      // Cron expression for Monday to Thursday (adjust if needed)
      cronExpression = `${minute} ${hour} * * 1-4`;
    } else {
      // Single day cron expression
      cronExpression = `${minute} ${hour} * * ${dayMap[schedule.day]}`;
    }

    console.log(`Scheduling bell for schedule ID ${schedule.id}: ${schedule.day} at ${schedule.time} with sound ${schedule.sound}`);
    console.log(`Cron expression: ${cronExpression}`);

    // Stop and remove any existing task for this schedule
    if (cronTasks.has(schedule.id)) {
      console.log(`Stopping existing task for ID ${schedule.id}`);
      cronTasks.get(schedule.id).stop();
      cronTasks.delete(schedule.id);
      cronJobsInfo.delete(schedule.id);
    }

    // Create and store a new cron task
    const task = cron.schedule(cronExpression, () => {
      console.log(`Triggering bell for schedule ID ${schedule.id}: ${schedule.day} at ${schedule.time}`);
      playSound(schedule.sound);
    });
    cronTasks.set(schedule.id, task);
    task.start();

    // Store serializable info for API purposes
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
    console.error(`Error scheduling bell for schedule ID ${schedule.id}:`, error);
  }
}

// Function to schedule all bells from schedules.json
const scheduleAllBells = () => {
  try {
    console.log("Scheduling all bells...");

    // Stop and clear all existing tasks
    for (const [id, task] of cronTasks.entries()) {
      console.log(`Stopping task ID ${id}`);
      task.stop();
      cronTasks.delete(id);
    }
    cronJobsInfo.clear();

    // Read schedules from file and schedule each one
    const schedules = readData(schedulesFilePath);
    console.log('Loaded schedules:', schedules);

    if (schedules.length === 0) {
      console.log('No schedules found.');
    }

    schedules.forEach(schedule => {
      scheduleBell(schedule);
    });
    console.log("Active tasks after scheduling:", Array.from(cronTasks.keys()));
  } catch (error) {
    console.error("Error in scheduleAllBells:", error);
  }
};

// ------------------ API ENDPOINTS ------------------

// Get all available sounds
app.get('/sounds', (req, res) => {
  const sounds = readData(soundsFilePath);
  res.json(sounds);
});

// Upload a sound file
app.post('/upload-sound', upload.single('sound'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  
  const soundPath = `/uploads/${req.file.filename}`;
  const sounds = readData(soundsFilePath);
  const newSound = {
    id: Date.now(),
    filename: req.file.filename,
    originalname: req.file.originalname,
    filepath: soundPath
  };
  sounds.push(newSound);
  writeData(soundsFilePath, sounds);
  res.status(201).json(newSound);
});

// Create a new schedule
app.post('/schedule', (req, res) => {
  const { day, time, soundPath } = req.body;
  const schedules = readData(schedulesFilePath);
  const newSchedule = { id: Date.now(), day, time, sound: soundPath };
  schedules.push(newSchedule);
  writeData(schedulesFilePath, schedules);
  scheduleBell(newSchedule);
  res.status(201).json(newSchedule);
});

// Get all schedules with enriched sound info
app.get('/schedules', (req, res) => {
  const schedules = readData(schedulesFilePath);
  const sounds = readData(soundsFilePath);
  const soundMap = sounds.reduce((acc, sound) => {
    acc[sound.filepath] = sound.originalname;
    return acc;
  }, {});
  const enrichedSchedules = schedules.map(schedule => ({
    ...schedule,
    filename: schedule.sound,
    originalname: soundMap[schedule.sound] || 'Unknown'
  }));
  res.json(enrichedSchedules);
});

// Delete a schedule by ID
app.delete('/schedule/:id', (req, res) => {
  const { id } = req.params;
  const schedules = readData(schedulesFilePath);
  const scheduleId = parseInt(id);
  const index = schedules.findIndex(schedule => schedule.id === scheduleId);
  if (index !== -1) {
    schedules.splice(index, 1);
    writeData(schedulesFilePath, schedules);

    if (cronTasks.has(scheduleId)) {
      cronTasks.get(scheduleId).stop();
      cronTasks.delete(scheduleId);
      cronJobsInfo.delete(scheduleId);
    }
    res.status(200).send("Deleted successfully.");
  } else {
    res.status(404).send("Schedule not found.");
  }
});

// Update a schedule by ID
app.put('/schedule/:id', (req, res) => {
  const { id } = req.params;
  const { day, time, soundPath } = req.body;
  const schedules = readData(schedulesFilePath);
  const scheduleId = parseInt(id);
  const schedule = schedules.find(s => s.id === scheduleId);
  if (schedule) {
    schedule.day = day;
    schedule.time = time;
    schedule.sound = soundPath;
    writeData(schedulesFilePath, schedules);
    scheduleBell(schedule);
    res.status(200).send("Updated successfully.");
  } else {
    res.status(404).send("Schedule not found.");
  }
});

// Get current custom system time
let customTime = new Date();
app.get('/current-time', (req, res) => {
  res.json({ currentTime: customTime });
});

// Set system time (requires sudo privileges)
app.post('/set-system-time', (req, res) => {
  const { newTime } = req.body;
  if (!newTime) {
    return res.status(400).send("New time must be provided.");
  }
  const parsedTime = new Date(newTime);
  if (isNaN(parsedTime)) {
    return res.status(400).send("Invalid time format.");
  }
  const command = `sudo date --set="${parsedTime.toISOString()}"`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).send(`Error setting system time: ${stderr || error.message}`);
    }
    customTime = parsedTime;
    res.status(200).send(`System time updated to: ${parsedTime}`);
  });
});

// Test sound playback
app.post('/test-sound', (req, res) => {
  const { soundPath } = req.body;
  playSound(soundPath);
  res.status(200).send("Playing sound...");
});

// Delete a sound file by ID
app.delete('/delete-sound/:id', (req, res) => {
  const { id } = req.params;
  const sounds = readData(soundsFilePath);
  const soundId = parseInt(id);
  const soundIndex = sounds.findIndex(sound => sound.id === soundId);
  if (soundIndex !== -1) {
    const soundToDelete = sounds[soundIndex];
    const filePath = path.join(__dirname, 'public', soundToDelete.filepath);
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error deleting file:', err);
        return res.status(500).send('Error deleting the file.');
      }
      sounds.splice(soundIndex, 1);
      writeData(soundsFilePath, sounds);
      res.status(200).send('Sound file deleted successfully.');
    });
  } else {
    res.status(404).send('Sound file not found.');
  }
});

// Get all cron job info
app.get('/api/cron-jobs', (req, res) => {
  const jobsArray = Array.from(cronJobsInfo.values());
  res.json({
    total: jobsArray.length,
    jobs: jobsArray
  });
});

// Get a specific cron job info by ID
app.get('/api/cron-jobs/:id', (req, res) => {
  const { id } = req.params;
  const numericId = parseInt(id);
  if (!cronJobsInfo.has(numericId)) {
    return res.status(404).json({ error: `Cron job with ID '${id}' not found` });
  }
  res.json(cronJobsInfo.get(numericId));
});

// Global handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const d = new Date()
console.log("time");

console.log(d.toISOString())
console.log(d.toUTCString());
console.log(d.toLocaleString());

// Start the server and schedule all bells
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  scheduleAllBells();
});
