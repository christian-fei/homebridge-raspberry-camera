'use strict'
let uuid, Service, StreamController

const crypto = require('crypto')
const ip = require('ip')
const spawn = require('child_process').spawn

module.exports = {
  FFMPEG: FFMPEG
}

function FFMPEG (hap, cameraConfig, log) {
  uuid = hap.uuid
  Service = hap.Service
  StreamController = hap.StreamController
  this.log = log

  var ffmpegOpt = {
    source: '-f v4l2 -r 30 -s 1280x720 -i /dev/video0',
    stillImageSource: '-i file:///home/pi/snapshots/current.png',
    maxBitrate: 1024,
    maxStreams: 8,
    maxWidth: 1280,
    maxHeight: 720,
    maxFPS: 30,
    vcodec: 'h264',
    debug: true
  }

  this.name = cameraConfig.name
  this.vcodec = ffmpegOpt.vcodec
  this.videoProcessor = 'ffmpeg'
  this.audio = ffmpegOpt.audio
  this.acodec = ffmpegOpt.acodec
  this.packetsize = ffmpegOpt.packetSize
  this.fps = ffmpegOpt.maxFPS || 10
  this.maxBitrate = ffmpegOpt.maxBitrate || 300
  this.debug = ffmpegOpt.debug
  this.additionalCommandline = ffmpegOpt.additionalCommandline || '-tune zerolatency'
  this.vflip = ffmpegOpt.vflip || false
  this.hflip = ffmpegOpt.hflip || false
  this.mapvideo = ffmpegOpt.mapvideo || '0:0'
  this.mapaudio = ffmpegOpt.mapaudio || '0:1'
  this.videoFilter = ffmpegOpt.videoFilter || null // null is a valid discrete value
  this.interfaceName = ''

  if (!ffmpegOpt.source) {
    throw new Error('Missing source for camera.')
  }

  this.ffmpegSource = ffmpegOpt.source
  this.ffmpegImageSource = ffmpegOpt.stillImageSource

  this.services = []
  this.streamControllers = []

  this.pendingSessions = {}
  this.ongoingSessions = {}

  this.uploader = cameraConfig.uploader || false

  var numberOfStreams = ffmpegOpt.maxStreams || 8
  var videoResolutions = []

  this.maxWidth = ffmpegOpt.maxWidth || 1280
  this.maxHeight = ffmpegOpt.maxHeight || 720
  var maxFPS = (this.fps > 30) ? 30 : this.fps

  if (this.maxWidth >= 320) {
    if (this.maxHeight >= 240) {
      videoResolutions.push([320, 240, maxFPS])
      if (maxFPS > 15) {
        videoResolutions.push([320, 240, 15])
      }
    }

    if (this.maxHeight >= 180) {
      videoResolutions.push([320, 180, maxFPS])
      if (maxFPS > 15) {
        videoResolutions.push([320, 180, 15])
      }
    }
  }

  if (this.maxWidth >= 480) {
    if (this.maxHeight >= 360) {
      videoResolutions.push([480, 360, maxFPS])
    }

    if (this.maxHeight >= 270) {
      videoResolutions.push([480, 270, maxFPS])
    }
  }

  if (this.maxWidth >= 640) {
    if (this.maxHeight >= 480) {
      videoResolutions.push([640, 480, maxFPS])
    }

    if (this.maxHeight >= 360) {
      videoResolutions.push([640, 360, maxFPS])
    }
  }

  if (this.maxWidth >= 1280) {
    if (this.maxHeight >= 960) {
      videoResolutions.push([1280, 960, maxFPS])
    }

    if (this.maxHeight >= 720) {
      videoResolutions.push([1280, 720, maxFPS])
    }
  }

  if (this.maxWidth >= 1920) {
    if (this.maxHeight >= 1080) {
      videoResolutions.push([1920, 1080, maxFPS])
    }
  }

  const options = {
    proxy: false, // Requires RTP/RTCP MUX Proxy
    srtp: true, // Supports SRTP AES_CM_128_HMAC_SHA1_80 encryption
    video: {
      resolutions: videoResolutions,
      codec: {
        profiles: [0, 1, 2], // Enum, please refer StreamController.VideoCodecParamProfileIDTypes
        levels: [0, 1, 2] // Enum, please refer StreamController.VideoCodecParamLevelTypes
      }
    },
    audio: {
      codecs: [
        {
          type: 'OPUS', // Audio Codec
          samplerate: 24 // 8, 16, 24 KHz
        },
        {
          type: 'AAC-eld',
          samplerate: 16
        }
      ]
    }
  }

  this.createCameraControlService()
  this._createStreamControllers(numberOfStreams, options)
}

FFMPEG.prototype.handleCloseConnection = function (connectionID) {
  this.streamControllers.forEach(function (controller) {
    controller.handleCloseConnection(connectionID)
  })
}

FFMPEG.prototype.handleSnapshotRequest = function (request, callback) {
  const resolution = request.width + 'x' + request.height
  var imageSource = this.ffmpegImageSource !== undefined ? this.ffmpegImageSource : this.ffmpegSource
  const ffmpeg = spawn(this.videoProcessor, (imageSource + ' -t 1 -s ' + resolution + ' -f image2 -').split(' '), { env: process.env })
  var imageBuffer = Buffer.alloc(0)
  this.log('Snapshot from ' + this.name + ' at ' + resolution)
  if (this.debug) console.log('ffmpeg ' + imageSource + ' -t 1 -s ' + resolution + ' -f image2 -')
  ffmpeg.stdout.on('data', function (data) {
    imageBuffer = Buffer.concat([imageBuffer, data])
  })
  const self = this
  ffmpeg.on('error', function (error) {
    self.log('An error occurs while making snapshot request', error)
  })
  ffmpeg.on('close', function (code) {
    callback(undefined, imageBuffer)
  })
}

FFMPEG.prototype.prepareStream = function (request, callback) {
  var sessionInfo = {}

  const sessionID = request['sessionID']
  const targetAddress = request['targetAddress']

  sessionInfo['address'] = targetAddress

  var response = {}

  const videoInfo = request['video']
  if (videoInfo) {
    const targetPort = videoInfo['port']
    const key = videoInfo['srtp_key']
    const salt = videoInfo['srtp_salt']

    // SSRC is a 32 bit integer that is unique per stream
    const ssrcSource = crypto.randomBytes(4)
    ssrcSource[0] = 0
    const ssrc = ssrcSource.readInt32BE(0, true)

    const videoResp = {
      port: targetPort,
      ssrc: ssrc,
      srtp_key: key,
      srtp_salt: salt
    }

    response['video'] = videoResp

    sessionInfo['video_port'] = targetPort
    sessionInfo['video_srtp'] = Buffer.concat([key, salt])
    sessionInfo['video_ssrc'] = ssrc
  }

  const audioInfo = request['audio']
  if (audioInfo) {
    const targetPort = audioInfo['port']
    const key = audioInfo['srtp_key']
    const salt = audioInfo['srtp_salt']

    // SSRC is a 32 bit integer that is unique per stream
    const ssrcSource = crypto.randomBytes(4)
    ssrcSource[0] = 0
    const ssrc = ssrcSource.readInt32BE(0, true)

    const audioResp = {
      port: targetPort,
      ssrc: ssrc,
      srtp_key: key,
      srtp_salt: salt
    }

    response['audio'] = audioResp

    sessionInfo['audio_port'] = targetPort
    sessionInfo['audio_srtp'] = Buffer.concat([key, salt])
    sessionInfo['audio_ssrc'] = ssrc
  }

  const currentAddress = ip.address(this.interfaceName)
  var addressResp = {
    address: currentAddress
  }

  if (ip.isV4Format(currentAddress)) {
    addressResp['type'] = 'v4'
  } else {
    addressResp['type'] = 'v6'
  }

  response['address'] = addressResp
  this.pendingSessions[uuid.unparse(sessionID)] = sessionInfo

  callback(response)
}

FFMPEG.prototype.handleStreamRequest = function (request) {
  var sessionID = request['sessionID']
  var requestType = request['type']
  if (sessionID) {
    const sessionIdentifier = uuid.unparse(sessionID)

    if (requestType === 'start') {
      var sessionInfo = this.pendingSessions[sessionIdentifier]
      if (sessionInfo) {
        var width = 1280
        var height = 720
        var fps = this.fps || 30
        var vbitrate = this.maxBitrate
        var abitrate = 32
        var asamplerate = 16
        var vcodec = this.vcodec || 'libx264'
        var acodec = this.acodec || 'libfdk_aac'
        var packetsize = this.packetsize || 1316 // 188 376
        var additionalCommandline = this.additionalCommandline
        var mapvideo = this.mapvideo
        var mapaudio = this.mapaudio

        const videoInfo = request['video']
        if (videoInfo) {
          width = videoInfo['width']
          height = videoInfo['height']

          const expectedFPS = videoInfo['fps']
          if (expectedFPS < fps) {
            fps = expectedFPS
          }
          if (videoInfo['max_bit_rate'] < vbitrate) {
            vbitrate = videoInfo['max_bit_rate']
          }
        }

        const audioInfo = request['audio']
        if (audioInfo) {
          abitrate = audioInfo['max_bit_rate']
          asamplerate = audioInfo['sample_rate']
        }

        const targetAddress = sessionInfo['address']
        const targetVideoPort = sessionInfo['video_port']
        const videoKey = sessionInfo['video_srtp']
        const videoSsrc = sessionInfo['video_ssrc']
        const targetAudioPort = sessionInfo['audio_port']
        const audioKey = sessionInfo['audio_srtp']
        const audioSsrc = sessionInfo['audio_ssrc']
        const vf = []

        const videoFilter = ((this.videoFilter === '') ? ('scale=' + width + ':' + height + '') : (this.videoFilter)) // empty string indicates default
        // In the case of null, skip entirely
        if (videoFilter !== null && videoFilter !== 'none') {
          vf.push(videoFilter)

          if (this.hflip) { vf.push('hflip') }

          if (this.vflip) { vf.push('vflip') }
        }

        let fcmd = this.ffmpegSource

        const ffmpegVideoArgs = ' -map ' + mapvideo +
          ' -vcodec ' + vcodec +
          ' -pix_fmt yuv420p' +
          ' -r ' + fps +
          ' -f rawvideo' +
          ' ' + additionalCommandline +
          ((vf.length > 0) ? (' -vf ' + vf.join(',')) : ('')) +
          ' -b:v ' + vbitrate + 'k' +
          ' -bufsize ' + vbitrate + 'k' +
          ' -maxrate ' + vbitrate + 'k' +
          ' -payload_type 99'

        const ffmpegVideoStream = ' -ssrc ' + videoSsrc +
          ' -f rtp' +
          ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
          ' -srtp_out_params ' + videoKey.toString('base64') +
          ' srtp://' + targetAddress + ':' + targetVideoPort +
          '?rtcpport=' + targetVideoPort +
          '&localrtcpport=' + targetVideoPort +
          '&pkt_size=' + packetsize

        // build required video arguments
        fcmd += ffmpegVideoArgs
        fcmd += ffmpegVideoStream

        // build optional audio arguments
        if (this.audio) {
          const ffmpegAudioArgs = ' -map ' + mapaudio +
              ' -acodec ' + acodec +
              ' -profile:a aac_eld' +
              ' -flags +global_header' +
              ' -f null' +
              ' -ar ' + asamplerate + 'k' +
              ' -b:a ' + abitrate + 'k' +
              ' -bufsize ' + abitrate + 'k' +
              ' -ac 1' +
              ' -payload_type 110'

          const ffmpegAudioStream = ' -ssrc ' + audioSsrc +
              ' -f rtp' +
              ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
              ' -srtp_out_params ' + audioKey.toString('base64') +
              ' srtp://' + targetAddress + ':' + targetAudioPort +
              '?rtcpport=' + targetAudioPort +
              '&localrtcpport=' + targetAudioPort +
              '&pkt_size=' + packetsize

          fcmd += ffmpegAudioArgs
          fcmd += ffmpegAudioStream
        }

        if (this.debug) {
          fcmd += ' -loglevel debug'
        }

        // start the process
        const ffmpeg = spawn(this.videoProcessor, fcmd.split(' '), { env: process.env })
        this.log('Start streaming video from ' + this.name + ' with ' + width + 'x' + height + '@' + vbitrate + 'kBit')
        if (this.debug) {
          console.log('ffmpeg ' + fcmd)
        }

        // Always setup hook on stderr.
        // Without this streaming stops within one to two minutes.
        ffmpeg.stderr.on('data', function (data) {
          // Do not log to the console if debugging is turned off
          if (this.debug) {
            console.log(data.toString())
          }
        }.bind(this))
        const self = this
        ffmpeg.on('error', function (error) {
          self.log('An error occurs while making stream request', error)
        })
        ffmpeg.on('close', (code) => {
          if (code == null || code === 0 || code === 255) {
            self.log('Stopped streaming')
          } else {
            self.log('ERROR: FFmpeg exited with code ' + code)
            for (var i = 0; i < self.streamControllers.length; i++) {
              var controller = self.streamControllers[i]
              if (controller.sessionIdentifier === sessionID) {
                controller.forceStop()
              }
            }
          }
        })
        this.ongoingSessions[sessionIdentifier] = ffmpeg
      }

      delete this.pendingSessions[sessionIdentifier]
    } else if (requestType === 'stop') {
      var ffmpegProcess = this.ongoingSessions[sessionIdentifier]
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM')
      }
      delete this.ongoingSessions[sessionIdentifier]
    }
  }
}

FFMPEG.prototype.createCameraControlService = function () {
  var controlService = new Service.CameraControl()

  this.services.push(controlService)

  if (this.audio) {
    var microphoneService = new Service.Microphone()
    this.services.push(microphoneService)
  }
}

// Private

FFMPEG.prototype._createStreamControllers = function (maxStreams, options) {
  const self = this

  for (var i = 0; i < maxStreams; i++) {
    var streamController = new StreamController(i, options, self)

    self.services.push(streamController.service)
    self.streamControllers.push(streamController)
  }
}
