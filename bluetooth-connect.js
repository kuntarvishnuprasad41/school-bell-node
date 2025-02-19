const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");

const app = express();
app.use(cors());

let deviceMac = null;
let scanProcess = null;
let connectionProcess = null;

// SSE clients
const clients = [];

// Function to send live logs to clients
function sendLog(message) {
    console.log(message);
    clients.forEach(res => res.write(`data: ${message}\n\n`));
}

// Scan for Bluetooth device
app.get("/scan", (req, res) => {
    sendLog("Starting 10-second scan for XKB02...");

    scanProcess = spawn("bluetoothctl", ["scan", "on"]);
    scanProcess.stdout.on("data", data => sendLog(`Scan stdout: ${data.toString()}`));
    scanProcess.stderr.on("data", data => sendLog(`Scan stderr: ${data.toString()}`));

    setTimeout(() => {
        sendLog("Stopping scan...");
        scanProcess.kill();
        spawn("bluetoothctl", ["scan", "off"]);

        sendLog("Fetching list of devices...");
        const listDevices = spawn("bluetoothctl", ["devices"]);
        let output = "";

        listDevices.stdout.on("data", data => {
            output += data.toString();
            sendLog(`Devices list stdout: ${data.toString()}`);
        });

        listDevices.stderr.on("data", data => sendLog(`Devices list stderr: ${data.toString()}`));

        listDevices.on("close", () => {
            sendLog("Parsing device list...");
            const match = output.match(/((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})/);
            if (match) {
                deviceMac = match[1];
                sendLog(`Found XKB02: ${deviceMac}`);
                res.json({ status: "success", mac: deviceMac });
            } else {
                sendLog("XKB02 not found.");
                res.json({ status: "not_found" });
            }
        });
    }, 10000);
});

// Connect to Bluetooth device
app.get("/connect", (req, res) => {
    if (!deviceMac) {
        sendLog("No device found to connect.");
        return res.json({ status: "no_device_found" });
    }

    sendLog(`Attempting to connect to ${deviceMac}...`);
    connectionProcess = spawn("bluetoothctl", ["connect", deviceMac]);

    connectionProcess.stdout.on("data", data => sendLog(`Connect stdout: ${data.toString()}`));
    connectionProcess.stderr.on("data", data => sendLog(`Connect stderr: ${data.toString()}`));

    connectionProcess.on("close", (code) => {
        sendLog(`Connection process ended with exit code ${code}`);
        res.json({ status: "completed" });
    });
});

// SSE Endpoint for Live Logs
app.get("/logs", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    clients.push(res);
    sendLog("New client connected for logs.");

    req.on("close", () => {
        sendLog("Client disconnected from logs.");
        clients.splice(clients.indexOf(res), 1);
    });
});

app.listen(3501, () => sendLog("Server running on port 3501"));
