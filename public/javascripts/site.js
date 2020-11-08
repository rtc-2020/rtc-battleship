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

// Trying Mozilla's public STUN server stun.services.mozilla.org
var rtc_config = {
  iceServers: [
    {
      urls: 'stun:stun.services.mozilla.org'
    }
  ]
};
var pc = new RTCPeerConnection(rtc_config);

// Set placeholder for the data channel...
var dc = null;

// Add DataChannel-backed DOM elements for chat
var chatLog = document.querySelector('#chat-log');
var chatForm = document.querySelector('#chat-form');
var chatInput = document.querySelector('#message');
var chatButton = document.querySelector('#send-button');

function appendMsgToChatLog(log,msg,who) {
  var li = document.createElement('li');
  var msg = document.createTextNode(msg);
  li.className = who;
  li.appendChild(msg);
  log.appendChild(li);
  if (chatLog.scrollTo) {
    chatLog.scrollTo({
      top: chatLog.scrollHeight,
      behavior: 'smooth'
    });
  } else {
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function addDataChannelEventListeners(datachannel) {
  datachannel.onmessage = function(e) {
    appendMsgToChatLog(chatLog,e.data,'peer');
  }
  datachannel.onopen = function() {
    chatButton.disabled = false; // enable the chat send button
    chatInput.disabled = false; // enable the chat input box
  }
  datachannel.onclose = function() {
    chatButton.disabled = true; // disable the chat send button
    chatInput.disabled = true; // disable the chat input box
  }
  chatForm.addEventListener('submit', function(e) {
    e.preventDefault();
    var msg = chatInput.value;
    appendMsgToChatLog(chatLog,msg,'self');
    datachannel.send(msg);
    chatInput.value = '';
  });
}

// Once the RTCPeerConnection has reached a 'connected'
// state, the polite peer will open the data channel:
pc.onconnectionstatechange = function(e) {
  console.log('Connection state:\n', pc.connectionState);
  // You ABSOLUTELY MUST have adapter.js wired up for this to work
  // at least on certain, non-compliant browsers. Have a look at
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState#Browser_compatibility
  if (pc.connectionState == 'connected') {
    if (clientIs.polite) {
      console.log('Creating a data channel on the initiating side...');
      dc = pc.createDataChannel('text chat');
      addDataChannelEventListeners(dc);
    }
  }
};
// ...this will ONLY fire on the receiving end of the
// data channel connection.
// See https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/datachannel_event
// Listen for the data channel on the peer connection
pc.ondatachannel = function(e) {
  console.log('Heard data channel open...');
  dc = e.channel;
  addDataChannelEventListeners(dc);
};

// Let's handle video streams...
// Set up simple media_constraints
// (disable audio for classroom demo purposes)
var media_constraints = { video: true, audio: true };
// Handle self video
var selfVideo = document.querySelector('#self-video');
var selfStream = new MediaStream();
selfVideo.srcObject = selfStream;
// Handle peer video
var peerVideo = document.querySelector('#peer-video');
var peerStream = new MediaStream();
peerVideo.srcObject = peerStream;

// Handle the start of media streaming
async function startStream() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia(media_constraints);
    for (var track of stream.getTracks()) {
      pc.addTrack(track);
      // Future improvement (I think)
      // selfStream.addTrack(track);
    }
    // TODO: Use the tracks here
    selfVideo.srcObject = stream;
  } catch(error) {
    console.error(error);
  }
}

// Listen for and attach any peer tracks
pc.ontrack = function(track) {
  peerStream.addTrack(track.track);
}

// Call/answer button
var callButton = document.querySelector('#call-button');
callButton.addEventListener('click', startCall);

function startCall() {
  console.log('This is the calling side of the connection...');
  callButton.hidden = true;
  clientIs.polite = true;
  sc.emit('calling');
  startStream();
  negotiateConnection();
}

// Handle the 'calling' event on the receiving peer (the callee)
sc.on('calling', function() {
  console.log('This is the receiving side of the connection...');
  negotiateConnection();

  callButton.innerText = "Answer Call";
  callButton.id = "answer-button";
  callButton.removeEventListener('click', startCall);
  callButton.addEventListener('click', function() {
    callButton.hidden = true;
    startStream();
  });
});

/*
  THE MAIN MONKEY BUSINESS:
  Setting up the peer connection.
*/

async function negotiateConnection() {
  pc.onnegotiationneeded = async function() {
    try {
      console.log('Making an offer...');
      clientIs.makingOffer = true;
      try {
        // Very latest browsers are totally cool with an
        // argument-less call to setLocalDescription:
        await pc.setLocalDescription();
      } catch(error) {
        // Older (and not even all that old) browsers
        // are NOT cool. So because we're making an
        // offer, we need to prepare an offer:
        console.log('Falling back to older setLocalDescription method when making an offer...');
        var offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
      } finally {
        console.log('Sending an offer:\n', pc.localDescription);
        sc.emit('signal', { description: pc.localDescription });
      }
    } catch(error) {
        console.error(error);
    } finally {
        clientIs.makingOffer = false;
    }
  }
}

sc.on('signal', async function({ candidate, description }) {
  try {
    if (description) {
      console.log('Received a decription:\n', description);
      var offerCollision  = (description.type == 'offer') &&
                            (clientIs.makingOffer || pc.signalingState != 'stable')
      clientIs.ignoringOffer = !clientIs.polite && offerCollision;

      if (clientIs.ignoringOffer) {
        return; // Just leave if we're ignoring offers
      }

      // Set the remote description...
      try {
        console.log('Trying to set a remote description:\n', description);
        await pc.setRemoteDescription(description);
      } catch(error) {
        console.error('Error from setting local description', error);
      }

      // ...if it's an offer, we need to answer it:
      if (description.type == 'offer') {
        console.log('Specifically, an offer description...');
          try {
            // Very latest browsers are totally cool with an
            // argument-less call to setLocalDescription:
            await pc.setLocalDescription();
          } catch(error) {
            // Older (and not even all that old) browsers
            // are NOT cool. So because we're handling an
            // offer, we need to prepare an answer:
            console.log('Falling back to older setLocalDescription method when receiving an offer...');
            if (pc.signalingState == 'have-remote-offer') {
              // create a answer, if that's what's needed...
              console.log('Trying to prepare an answer:');
              var offer = await pc.createAnswer();
            } else {
              // otherwise, create an offer
              console.log('Trying to prepare an offer:');
              var offer = await pc.createOffer();
            }
            await pc.setLocalDescription(offer);
          } finally {
            console.log('Sending a response:\n', pc.localDescription);
            sc.emit('signal', { description: pc.localDescription });
          }
      }

    } else if (candidate) {
        console.log('Received a candidate:');
        console.log(candidate);
        // Save Safari and other browsers that can't handle an
        // empty string for the `candidate.candidate` value:
        if (candidate.candidate.length > 1) {
          await pc.addIceCandidate(candidate);
        }
    }
  } catch(error) {
    console.error(error);
  }

});

// Logic to send candidate
pc.onicecandidate = function({candidate}) {
  console.log('Sending a candidate:\n', candidate);
  sc.emit('signal', { candidate: candidate });
}
