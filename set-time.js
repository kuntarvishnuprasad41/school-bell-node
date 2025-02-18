const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const app = express();
const port = 3500;
const cors = require('cors');  // Add this line


// Initial system time is set to the current date and time.

app.use(bodyParser.json());

app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json());

// Endpoint to get the current system time
app.get('/current-time', async (req, res) => {
    // Return the custom system time or the actual system time if it's not set
    let customTime = new Date();
    res.json({ currentTime: await customTime });
});

// Endpoint to set the system time
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
        // Update the custom time variable with the new system time
        customTime = parsedTime;
        res.status(200).send(`System time updated to: ${parsedTime}`);
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
