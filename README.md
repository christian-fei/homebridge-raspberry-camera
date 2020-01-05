# homebridge-raspberry-camera

raspberry camera plugin for [Homebridge](https://github.com/nfarina/homebridge)

forked from [https://github.com/moritzmhmk/homebridge-camera-rpi](moritzmhmk/homebridge-camera-rpi)

## Installation

1. Install ffmpeg on your computer (note that in some cases, this requires compiling ffmpeg from scratch due to the use of rstp, namely for pi configurations)
2. Install this plugin using: npm install -g homebridge-raspberry-camera
3. Edit ``config.json`` and add the camera.
3. Run Homebridge
4. Add extra camera accessories in Home app. The setup code is the same as homebridge.

### Config.json Example

```json
{
  "bridge": {
      "name": "HomeBridge",
      "username": "0E:E5:23:4C:B4:31",
      "port": 51826,
      "pin": "777-88-999"
  },
  "mdns": {
      "interface": "192.168.1.110"
  },
  "accessories": [],
  "platforms": [
      {
          "platform": "raspberry-camera"
      }
  ]
}
```