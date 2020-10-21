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
  res.render('index', { title: `Game Room ${req.params["game"]}` });
});

module.exports = router;
