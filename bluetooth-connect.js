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

    setTimeout(() => {
        scanProcess.kill();
        spawn("bluetoothctl", ["scan", "off"]);

        // Get MAC address
        const listDevices = spawn("bluetoothctl", ["devices"]);
        let output = "";
        listDevices.stdout.on("data", data => output += data.toString());
        listDevices.on("close", () => {
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
    if (!deviceMac) return res.json({ status: "no_device_found" });

    sendLog(`Connecting to ${deviceMac}...`);
    connectionProcess = spawn("bluetoothctl", ["connect", deviceMac]);

    connectionProcess.stdout.on("data", data => sendLog(data.toString()));

    connectionProcess.on("close", () => {
        sendLog("Connection process ended.");
        res.json({ status: "completed" });
    });
});

// SSE Endpoint for Live Logs
app.get("/logs", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    clients.push(res);

    req.on("close", () => {
        clients.splice(clients.indexOf(res), 1);
    });
});

app.listen(3501, () => console.log("Server running on port 3501"));
