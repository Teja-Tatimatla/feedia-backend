const express = require('express');
const router = express.Router();
const { therapyChatHandler } = require('../controllers/therapyController');

router.post('/', therapyChatHandler);

module.exports = router;
