'use strict';

const express = require('express');
const router = express.Router();
const utils = require('../lib/utilities.js')

/* GET home page. */
router.get('/', function(req, res, next) {
  const random_game_path = `/${utils.randomRoom(3,4,3)}`
  res.redirect(random_game_path);
});

router.get('/:game([a-z]{3}-[a-z]{4}-[a-z]{3})', function(req, res, next) {
  // Potential TODO:
  // Server-based logic could be called here, such as for:
  //  - checking the existence of the room
  //  - persisting the room's existence, once created
  //  - handling user authorization
  const namespace = req.params["game"];
  res.render('index', { title: `Game Room ${namespace}`, namespace: namespace });
});

module.exports = router;
