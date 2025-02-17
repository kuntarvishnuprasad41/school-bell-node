const { exec } = require('child_process');
const path = require('path');

// Path to your MP3 file
const mp3FilePath = path.join(__dirname, 'c.mp3'); // Ensure path is correct

// Use mpg123 to play the MP3 file
exec(`mpg123 "${mp3FilePath}"`, (err, stdout, stderr) => {
    if (err) {
        console.log("Error playing audio:", err);
    } else {
        console.log("Audio is playing...");
    }
});
