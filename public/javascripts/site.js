// Use `sc` for the signaling channel...
var sc = io.connect('/' + NAMESPACE);
sc.on('message', function(data) {
  console.log('Message received: ' + data);
});

// Track client states
var clientIs = {
  makingOffer: false,
  ignoringOffer: false,
  polite: false
}

// Eventually, we will set up STUN servers here
var rtc_config = null;
var pc = new RTCPeerConnection(rtc_config);

// Let's handle video streams...
// Set up simple media_constraints
// (disable audio for classroom demo purposes)
var media_constraints = { video: true, audio: false };
// Handle self video
var selfVideo = document.querySelector('#self-video');
var selfStream = new MediaStream();
selfVideo.srcObject = selfStream;
// Handle peer video
var peerVideo = document.querySelector('#peer-video');
var peerStream = new MediaStream();
peerVideo.srcObject = peerStream;
