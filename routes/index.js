'use strict';

const express = require('express');
const router = express.Router();
const util = require('../lib/utilities.js');

/* GET random room. */
router.get('/', function(req, res, next) {
  // Generate and redirect to a random room path...
  // (Might want to check uniqueness before redirection...)
  res.redirect(`/${util.randomRoom(3,4,3)}`)
});

/* GET specific room */
// Pattern: https://example.com/aaa-bbbb-ccc
router.get('/:room([a-z]{3}-[a-z]{4}-[a-z]{3}$)', function(req, res, next) {
  // TODO: (Potentially)
  // - Handle user authentication
  // - Persist each room (e.g., write the room ID to a database)
  // - Confirm uniqueness/newness of each room
  res.render('index', { title: `Room ${req.params['room']}` });
});

module.exports = router;
