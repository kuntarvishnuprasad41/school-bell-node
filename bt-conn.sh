#!/bin/bash

# Function to scan for 10 seconds and get device MAC
scan_for_device() {
    echo "Starting 10-second scan for XKB02..."
    bluetoothctl scan on &
    SCAN_PID=$!
    sleep 10
    kill $SCAN_PID
    bluetoothctl scan off
    
    # Get the MAC address of XKB02
    DEVICE_MAC=$(bluetoothctl devices | grep "XKB02" | head -n 1 | awk '{print $2}')
    
    if [ -n "$DEVICE_MAC" ]; then
        echo "Found XKB02 device: $DEVICE_MAC"
        return 0
    else
        echo "XKB02 not found in scan"
        return 1
    fi
}

# Function to connect using the exact sequence that worked
connect_sequence() {
    local MAC=$1
    
    echo "Starting connection sequence for $MAC"
    
    # Pair
    echo "Attempting to pair..."
    bluetoothctl pair $MAC
    sleep 2
    
    # Trust
    echo "Setting trust..."
    bluetoothctl trust $MAC
    sleep 1
    
    # Connect
    echo "Connecting..."
    bluetoothctl connect $MAC
    
    # Verify connection
    if bluetoothctl info $MAC | grep -q "Connected: yes"; then
        echo "Connection successful"
        return 0
    else
        echo "Connection failed"
        return 1
    fi
}

# Main script
echo "Starting Bluetooth auto-connect script..."

while true; do
    if scan_for_device; then
        if [ -n "$DEVICE_MAC" ]; then
            if connect_sequence "$DEVICE_MAC"; then
                echo "Device connected. Monitoring connection..."
                
                # Monitor connection
                while bluetoothctl info $DEVICE_MAC | grep -q "Connected: yes"; do
                    sleep 5
                done
                
                echo "Connection lost. Restarting search..."
            fi
        fi
    fi
    
    echo "Waiting 5 seconds before next attempt..."
    sleep 5
done