var Accessory, Service, Characteristic, hap, UUIDGen

var FFMPEG = require('./ffmpeg').FFMPEG

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory
  hap = homebridge.hap
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  UUIDGen = homebridge.hap.uuid

  homebridge.registerPlatform('homebridge-raspberry-camera', 'raspberry-camera', HomebridgeRaspberryCameraPlatform, true)
}

function HomebridgeRaspberryCameraPlatform (log, config, api) {
  var self = this

  self.log = log
  self.config = config || {}

  if (api) {
    self.api = api

    if (api.version < 2.1) {
      throw new Error('Unexpected API version.')
    }

    self.api.on('didFinishLaunching', self.didFinishLaunching.bind(this))
  }
}

HomebridgeRaspberryCameraPlatform.prototype.configureAccessory = function (accessory) {
}

HomebridgeRaspberryCameraPlatform.prototype.didFinishLaunching = function () {
  var self = this

  var configuredAccessories = []

  var cameras = [{ name: 'raspberry-camera' }]
  cameras.forEach(function (cameraConfig) {
    var cameraName = cameraConfig.name
    var uuid = UUIDGen.generate(cameraName)
    var cameraAccessory = new Accessory(cameraName, uuid, hap.Accessory.Categories.CAMERA)
    var cameraAccessoryInfo = cameraAccessory.getService(Service.AccessoryInformation)
    if (cameraConfig.manufacturer) {
      cameraAccessoryInfo.setCharacteristic(Characteristic.Manufacturer, cameraConfig.manufacturer)
    }
    if (cameraConfig.model) {
      cameraAccessoryInfo.setCharacteristic(Characteristic.Model, cameraConfig.model)
    }
    if (cameraConfig.serialNumber) {
      cameraAccessoryInfo.setCharacteristic(Characteristic.SerialNumber, cameraConfig.serialNumber)
    }
    if (cameraConfig.firmwareRevision) {
      cameraAccessoryInfo.setCharacteristic(Characteristic.FirmwareRevision, cameraConfig.firmwareRevision)
    }

    cameraAccessory.context.log = self.log

    var cameraSource = new FFMPEG(hap, cameraConfig, self.log)
    cameraAccessory.configureCameraSource(cameraSource)
    configuredAccessories.push(cameraAccessory)
  })

  self.api.publishCameraAccessories('raspberry-camera', configuredAccessories)
}
