// Set up the signaling channel (`sc`)
var sc = io.connect('/' + NAMESPACE);

sc.on('message', function(data) {
  console.log('Message received: ' + data);
});

// Initial client states
var clientIs = {
  makingOffer: false,
  ignoringOffer: false,
  polite: false
};

// RTC Configuration and setup
// eventually set ICE servers here instead of `null`:
//   var config = {
//    iceServers: [{urls: "stun:stun.example.com"}]
//   };
var rtc_config = null;
// Set up the RTCPeerConnection...it won't get used until a call is started
var pc = new RTCPeerConnection(rtc_config);

// RTC Data Channel events
// Data Channel placeholder
var dc = null;
// Function to register event listeners
function addDataChannelEventListeners(datachannel) {
  datachannel.onmessage = function(e) {
    console.log('recieved: ' + e.data);
  };
  datachannel.onopen = function() {
    console.log("Data channel 'text chat' open");
  };
  datachannel.onclose = function() {
    console.log("Data channel 'text chat' closed");
  };
}
// Polite peer will create the data channel...
pc.onconnectionstatechange = function(e) {
  if (pc.connectionState == 'connected') {
    console.log('*** The RTCPeerConnection has been established ***');
    // Let the polite client open the data channel
    if (clientIs.polite) {
      dc = pc.createDataChannel('text chat');
      addDataChannelEventListeners(dc);
    }
  }
}
// ...other peer will listen for the channel to open.
// Note that the `datachannel` event is NOT dispatched
// on the peer that is opening it, otherwise this would
// cause bad things to happen
// See https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/datachannel_event
pc.ondatachannel = function(e) {
  console.log('Heard data channel open');
  dc = e.channel;
  addDataChannelEventListeners(dc);
};

// Media objects and constrants
// audio disabled to avoid classroom demo feedback
var constraints = { audio: false, video: true };
var selfVideo = document.querySelector('#self-video');
var selfStream = new MediaStream();
selfVideo.srcObject = selfStream;
var peerVideo = document.querySelector('#peer-video');
var peerStream = new MediaStream();
peerVideo.srcObject = peerStream;

// Function to start streaming
async function startStream() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia(constraints);
    for (var track of stream.getTracks()) {
      // add the tracks to the peer connection
      pc.addTrack(track);
    }
    selfVideo.srcObject = stream;
  } catch(error) {
    // Log errors to the console
    console.error(error);
  }
}

// Handler for tracks received from peer
pc.ontrack = function(track) {
  peerStream.addTrack(track.track);
}

// Call/answer button
var callButton = document.querySelector('#call-button');
callButton.addEventListener('click',startCall);

function startCall() {
  console.log('This is the calling side...')
  callButton.hidden = true;
  clientIs.polite = true;
  sc.emit('calling');
  startStream();
  negotiateConnection();
}

// Handle calling event on answering peer
sc.on('calling', function() {
  console.log('This is the answering side...')
  callButton.innerText = "Answer";
  callButton.id = "answer";
  callButton.removeEventListener('click',startCall);
  callButton.addEventListener('click', function() {
    callButton.hidden = true;
    startStream();
  });
  negotiateConnection();
});

/*

  THE MAIN MONKEY BUSINESS
  What follows is all of the negotiation logic, as described at
  https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation

*/

// First, we handle the sending-side of the RTCPeerConnection
// Everything here is emit-based

// Handle the initation end of the connection...
// Need logic here to handle polite/impolite :: initiator/receiver
// Otherwise, as written, both sides just start going to town, because
// both sides will fire the `onnegotiationneeded event`
async function negotiateConnection() {
  pc.onnegotiationneeded = async function() {
    try {
      console.log('Making an offer...');
      clientIs.makingOffer = true;
      // without arguments, setLocalDescription() sets the appropriate description
      // based on the current `signalingState`: either an offer or an answer, as
      // appropriate. Note that this is currently not supported in iOS or macOS Safari,
      // but it IS supported in the Safari Technology Preview 115, at least.
      // For greater interoperability, it would be good to have a fallback for the
      // RTCSessionDescription object that is otherwise required.
      //
      // try {
      //   ...set local description without args
      // } catch(e) {
      //   ...set local description with RTCSessionDescription
      // }
      await pc.setLocalDescription();
      sc.emit('signal', { description: pc.localDescription});
    } catch(error) {
      console.error(error);
    } finally {
      // after the offer (or answer) has been set, or should an error
      // occur, set makingOffer back to false
      clientIs.makingOffer = false;
    }
  }
};

// find and emit a local candidate over the signalling channel to the peer...
pc.onicecandidate = function({candidate}) {
  sc.emit('signal', { candidate: candidate });
}

// Now we listen for 'signal' events on the signalling channel
sc.on('signal', async function({ description, candidate }) {
  try {
    // If we're dealing with a description, let's handle that...
    if (description) {
      console.log('Received a description...')
      // detect an offer collision
      var offerCollision = (description.type == "offer") &&
                           (clientIs.makingOffer || pc.signalingState != "stable");
      clientIs.ignoringOffer = !clientIs.polite && offerCollision;

      if (clientIs.ignoringOffer) {
        return; // skip out if we're ignoring offers
      }

      // Otherwise, set the remote description...
      await pc.setRemoteDescription(description);

      // ...and if it's an offer, we need to answer it, too:
      if (description.type == "offer") {
        console.log('Specifically, an "offer description..."')
        // Safari won't like this
        await pc.setLocalDescription();
        sc.emit('signal', { description: pc.localDescription});
      }
    // Otherwise, we need to work with an ICE candidate
    } else if (candidate) {
      try {
        console.log('Received a candidate:')
        console.log(candidate);
        // Safari freaks out about empty candidate: values,
        // so let's just handle those
        if (candidate.candidate.length > 1) {
          console.log('Received a candidate with a value...')
          await pc.addIceCandidate(candidate);
        }
      } catch(error) {
        if (!clientIs.ignoringOffer) {
          throw error;
        }
      }
    }
  // Log any errors thrown by handling descriptions or candidates
  } catch(error) {
    console.error(error);
  }
});
