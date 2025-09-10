# homebridge-wled-v2

A [Homebridge](https://homebridge.io) plugin to control [WLED](https://kno.wled.ge) devices with **real-time WebSocket sync**, **automatic HTTP fallback**, and **debug logging**.  
Exposes your WLED device as a **native HomeKit light accessory** with:

- ✅ On/Off
- ✅ Brightness
- ✅ Hue & Saturation (color control)
- ✅ Real-time updates from WLED via WebSocket
- ✅ Auto-fallback to polling if WebSocket fails
- ✅ Auto-switch-back when WebSocket reconnects
- ✅ Optional Debug Logging for troubleshooting

---

## Installation

1. Install Homebridge (if not already):
   ```bash
   npm install -g homebridge

2. Install this plugin:

  ```bash
  npm install -g homebridge-wled-v2
  ````

3. Add to your Homebridge config.json
  ```bash
  {
    "accessories": [
      {
        "accessory": "WLED",
        "name": "Living Room LEDs",
        "ip": "192.168.1.50",
        "debug": false
      }
    ]
  }
  ```
