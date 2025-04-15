const express = require('express');
const router = express.Router();
const { wraparoundHelpChatHandler } = require('../controllers/wraparoundController');

router.post('/', wraparoundHelpChatHandler);

module.exports = router;
