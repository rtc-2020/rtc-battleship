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
  // Data channels can be distinguished by e.channel.label
  // which would be `text chat` in this case. Use that to
  // decide what to do with the channel that has opened
  dc = e.channel;
  addDataChannelEventListeners(dc);
};

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

/* Battleship Game JS */

function Battleship(ocean,targeting) {

  // Set up our basic grids
  var ocean = document.querySelector(ocean);
  var targeting = document.querySelector(targeting);

  // Set up a record of each ship and its position coordinates, a-i on the x; 0-9 on the y
  // Using the 1990 MB ship namees and sizes
  //   (https://www.hasbro.com/common/instruct/battleship.pdf)
  var ships = {
    carrier: {
      length: 5,
      position: [],
      horizontal: false,
      damage: []
    },
    battleship: {
      length: 4,
      position: [],
      horizontal: false,
      damage: []
    },
    cruiser: {
      length: 3,
      position: [],
      horizontal: false,
      damage: []
    },
    submarine: {
      length: 3,
      position: [],
      horizontal: false,
      damage: []
    },
    destroyer: {
      length: 2,
      position: [],
      horizontal: false,
      damage: [],
    }
  };

  // Array to hold all coordinates occupied by ships
  var targets = [];
  // Array to hold all targeted coordinates, whether hit or miss
  var targeted = [];

  // Utility function to generate a random [x,y] origin array
  function random_origin() {
    var origin = [Math.floor(Math.random() * 10), Math.floor(Math.random() * 10)];
    console.log("Random origin:", origin);
    return origin;
  }
  // Utility function to set orientation (horizontal/true; vertical/false)
  function random_orientation() {
    var orientation = false;
    if (Math.round(Math.random() * 10) % 2 === 0) {
      orientation = true;
    };
    return orientation;
  }
  // Function to set the position property (an array of coordinates) for a ship
  function set_position_coordinates(origin,ship) {
    var axis = (ship.horizontal) ? 0 : 1;
    console.log('Axis value:', axis);
    var x_coordinates = 'abcdefghij'.split('');
    for (var i = 0; i < ship.length; i++) {
      console.log('Coordinates:',x_coordinates[origin[0]], origin[1]);
      ship.position.push(x_coordinates[origin[0]] + origin[1]);
      origin[axis]++;
    }
  }
  // Function to place each individual ship
  function place_ship(ship) {
    // Strikes (collisions with other ships)
    var strikes = 0;
    // Set and track a random origin for the ship
    var origin = random_origin();
    // Reset the position to an empty array, in case the function is called recursively
    ship.position = [];
    // Determine orientation;
    ship.horizontal = random_orientation();

    // Test origin with length; does it fit the board?
    // TODO: Make this some kind of simpler utilty function? or at least DRY the logic
    if (ship.horizontal) {
      if (origin[0] + ship.length > 9) {
        // It won't fit on the board; set x coordinate minus the ship length
        origin[0] = origin[0] - ship.length;
      }
    } else {
      if (origin[1] + ship.length > 9) {
        // It won't fit on the board; set y coordinate minus the ship length
        origin[1] = origin[1] - ship.length;
      }
    }
    // Now that we now the origin + length fit the board,
    // set up the array of game coordinates on ship.position
    set_position_coordinates(origin,ship);

    // Next, test whether they collide with any other ships that have already been positioned
    for (var coordinate of ship.position) {
      if (targets.indexOf(coordinate) > -1) {
        strikes++;
      }
    }
    if (strikes > 0) {
      // If there are any collisions (strikes), recursively call place_ship
      console.log('There was a collision');
      place_ship(ship);
    } else {
      // Append the new coordinates to the targets array
      targets.push(ship.position);
      // Flatten the array of targets
      targets = targets.flat();
      // Finally, sort the array of targets
      targets = targets.sort();
    }
  }

  // Track damage to ships
  function track_damage(ships,coordinates) {
    var message = 'Ship struck.';
    for (var ship in ships) {
      if (ships[ship].position.indexOf(coordinates) !== -1) {
        // Add the damage of coordinate
        ships[ship].damage.push(coordinates);
        ships[ship].damage.sort();

        if (ships[ship].position.length === ships[ship].damage.length) {
          var message = 'You have sunk the ' + ship + '.';
        }
        console.log(ships[ship]);

        // TODO: handle a ship being sunk (damage and position coordinates match)
        // Could possibly even leverage the return statement to return a sunk message
        // to add to the 'report' payload.

        // Get out as soon as there's a match
        return message;
      }
    }
  }

  // Wrapper function to place all of the ships in the ships object
  function place_ships(ships) {
    for (var ship in ships) {
      place_ship(ships[ship]);
    }
  }

  // DOM function to append each ship as a list item to the .ocean grid
  function display_ships(ocean,ships) {
    for (var ship in ships) {
      var orientation = (ships[ship].horizontal) ? 'h' : 'v';
      var li = document.createElement('li');
      li.className = 'ship-' + ship + ' ' + orientation;
      li.dataset.coordinates = ships[ship].position[0];
      // li.innerText = ship;
      console.log('Attempting to append a child');
      ocean.appendChild(li);
      // With the child appended, we can now figure out where to end it
      if (ships[ship].horizontal) {
        var start = window.getComputedStyle(ocean.querySelector('.ship-' + ship)).gridRowStart;
        li.style.gridRowEnd = parseInt(start) + parseInt(ships[ship].length);
      } else {
        var start = window.getComputedStyle(ocean.querySelector('.ship-' + ship)).gridColumnStart;
        li.style.gridColumnEnd = parseInt(start) + parseInt(ships[ship].length);
      }
    }
  }

  // Go ahead and place the shapes
  place_ships(ships);
  console.log('Targets:', targets);
  console.log('Ships:', ships);
  // And display them on the ocean grid
  display_ships(ocean, ships);

  // Events and event listeners
  // Clicking on the targeting grid triggers a fire event
  targeting.addEventListener('click', function(e) {
    var coordinates = e.target.dataset.coordinates;
    // Don't do anything if the coordinates have already been targeted, or if the gap was clicked on
    if (targeted.indexOf(coordinates) !== -1 || coordinates === undefined) {
      return;
    }
    targeted.push(coordinates);
    targeted.sort();
    var event = new CustomEvent('fire', { detail: { action: 'fire', coordinates: coordinates } });
    console.log("Clicked on coordinates", );
    ocean.dispatchEvent(event);
  });
  // Ocean listens for 'fire' events
  ocean.addEventListener('fire', function(e) {
    var coordinates = e.detail.coordinates;
    var result = 'miss';
    var message = 'Miss.'
    console.log('Heard a fire event at coordinates', coordinates);
    // Display the hit or miss on the ocean
    var li = document.createElement('li');
    if (targets.indexOf(coordinates) !== -1) {
      result = 'hit';
      // If there's a hit, we need to track the damage and get the damage message
      message = track_damage(ships,coordinates);
    }
    li.className = result;
    li.dataset.coordinates = coordinates;
    ocean.appendChild(li);
    var event = new CustomEvent('report', { detail: { action: result, coordinates: coordinates, message: message } });
    targeting.dispatchEvent(event);
  });
  // Targeting grid listens for 'report' events
  targeting.addEventListener('report', function(e) {
    var result = e.detail.action;
    var coordinates = e.detail.coordinates;
    var message = e.detail.message;
    var li = document.createElement('li');
    li.className = result;
    li.dataset.coordinates = coordinates;
    targeting.appendChild(li);
    // TODO: Add some kind of message console to the game board.
    document.querySelector('#targeting-console').innerText = message;
  });

};

var g = new Battleship('.ocean','.targeting');
