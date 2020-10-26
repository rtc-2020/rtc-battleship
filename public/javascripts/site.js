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
