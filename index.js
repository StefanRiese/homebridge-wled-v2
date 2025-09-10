const fetch = require("node-fetch");
const WebSocket = require("ws");

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-wled-v2", "WLED", WLEDAccessory);
};

class WLEDAccessory {
  constructor(log, config) {
    this.log = log;
    this.name = config.name || "WLED Light";
    this.ip = config.ip;
    this.pollInterval = config.pollInterval || 10000; // 10s fallback
    this.debug = config.debug || false; // enable verbose logging

    this.service = new Service.Lightbulb(this.name);

    this.service
      .getCharacteristic(Characteristic.On)
      .on("get", this.getOn.bind(this))
      .on("set", this.setOn.bind(this));

    this.service
      .getCharacteristic(Characteristic.Brightness)
      .on("get", this.getBrightness.bind(this))
      .on("set", this.setBrightness.bind(this));

    this.service
      .getCharacteristic(Characteristic.Hue)
      .on("get", this.getHue.bind(this))
      .on("set", this.setHue.bind(this));

    this.service
      .getCharacteristic(Characteristic.Saturation)
      .on("get", this.getSaturation.bind(this))
      .on("set", this.setSaturation.bind(this));

    // Internal state
    this.hue = 0;
    this.saturation = 0;
    this.brightness = 100;
    this.isOn = false;

    this.wsRetryCount = 0;
    this.maxWsRetries = 5;
    this.pollTimer = null;
    this.wsReconnectTimer = null;

    // Start WebSocket
    this._log("info", "Initializing WLED accessory");
    this.connectWebSocket();
  }

  // --- Logging methods ---
  _log(level, ...args) {
    if (level === "info") this.log.info(...args);
    else if (level === "warn") this.log.warn(...args);
    else if (level === "error") this.log.error(...args);
    else if (level === "debug" && this.debug) this.log.info("[DEBUG]", ...args);
  }

  async request(body) {
    this._log("debug", "Sending HTTP request:", body);
    try {
      await fetch(`http://${this.ip}/json/state`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
      this._log("debug", "HTTP request successful");
    } catch (e) {
      this._log("error", "HTTP request failed:", e.message);
    }
  }

  async fetchState() {
    this._log("debug", "Fetching WLED state via HTTP");
    try {
      const res = await fetch(`http://${this.ip}/json/state`);
      const json = await res.json();
      this.updateFromState(json);
      this._log("debug", "Fetched state:", json);
    } catch (e) {
      this._log("error", "Polling fetch failed:", e.message);
    }
  }

  startPolling() {
    if (!this.pollTimer) {
      this._log("info", `Switching to HTTP polling every ${this.pollInterval}ms`);
      this.pollTimer = setInterval(() => this.fetchState(), this.pollInterval);
    }
    this.scheduleWsReconnect();
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this._log("info", "Stopped polling (WebSocket active)");
    }
    if (this.wsReconnectTimer) {
      clearInterval(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }

  scheduleWsReconnect() {
    if (!this.wsReconnectTimer) {
      this.wsReconnectTimer = setInterval(() => {
        this._log("debug", "Trying to reconnect WebSocket...");
        this.connectWebSocket();
      }, 30000);
    }
  }

  connectWebSocket() {
    this._log("info", `Connecting to WLED WebSocket at ws://${this.ip}/ws`);
    const url = `ws://${this.ip}/ws`;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this._log("info", "Connected to WLED WebSocket");
      this.wsRetryCount = 0;
      this.stopPolling();
    });

    this.ws.on("message", (data) => {
      this._log("debug", "Received WS message:", data.toString());
      try {
        const state = JSON.parse(data.toString());
        this.updateFromState(state);
      } catch (e) {
        this._log("error", "WebSocket parse error:", e.message);
      }
    });

    this.ws.on("close", () => {
      this._log("warn", "WLED WebSocket closed");
      this.retryWebSocket();
    });

    this.ws.on("error", (err) => {
      this._log("error", "WebSocket error:", err.message);
      this.ws.close();
    });
  }

  retryWebSocket() {
    this.wsRetryCount++;
    if (this.wsRetryCount <= this.maxWsRetries) {
      const delay = 2000 * this.wsRetryCount;
      this._log("warn", `Retrying WebSocket in ${delay / 1000}s...`);
      setTimeout(() => this.connectWebSocket(), delay);
    } else {
      this._log("warn", "Max WebSocket retries reached — switching to polling");
      this.startPolling();
    }
  }

  updateFromState(state) {
    this._log("debug", "Updating accessory state from WLED:", state);
    if (state.on !== undefined) {
      this.isOn = state.on;
      this.service.updateCharacteristic(Characteristic.On, this.isOn);
    }
    if (state.bri !== undefined) {
      this.brightness = Math.round((state.bri / 255) * 100);
      this.service.updateCharacteristic(Characteristic.Brightness, this.brightness);
    }
    if (state.seg && state.seg[0] && state.seg[0].col && state.seg[0].col[0]) {
      const [r, g, b] = state.seg[0].col[0];
      const [h, s, v] = this.rgb2hsv(r, g, b);
      this.hue = h;
      this.saturation = s;
      this.brightness = v;
      this.service.updateCharacteristic(Characteristic.Hue, this.hue);
      this.service.updateCharacteristic(Characteristic.Saturation, this.saturation);
      this.service.updateCharacteristic(Characteristic.Brightness, this.brightness);
    }
  }

  // HomeKit <-> WLED control
  getOn(callback) { callback(null, this.isOn); }
  setOn(value, callback) { this.isOn = value; this.request({ on: value }); callback(null); }
  getBrightness(callback) { callback(null, this.brightness); }
  setBrightness(value, callback) { this.brightness = value; this.request({ bri: Math.round(value * 2.55) }); callback(null); }
  getHue(callback) { callback(null, this.hue); }
  setHue(value, callback) { this.hue = value; this.updateColor(); callback(null); }
  getSaturation(callback) { callback(null, this.saturation); }
  setSaturation(value, callback) { this.saturation = value; this.updateColor(); callback(null); }

  updateColor() {
    const rgb = this.hsv2rgb(this.hue, this.saturation, this.brightness);
    this._log("debug", "Updating color to RGB:", rgb);
    this.request({ seg: [{ col: [[rgb[0], rgb[1], rgb[2]]] }] });
  }

  // Helpers
  hsv2rgb(h, s, v) {
    s /= 100; v /= 100;
    let f = (n, k = (n + h / 60) % 6) =>
      v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
    return [
      Math.round(f(5) * 255),
      Math.round(f(3) * 255),
      Math.round(f(1) * 255),
    ];
  }

  rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max, d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) h = 0;
    else {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
  }

  getServices() { return [this.service]; }
}
