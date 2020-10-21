'use strict';

const express = require('express');
const router = express.Router();
const utils = require('../lib/utilities.js')

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

module.exports = router;
