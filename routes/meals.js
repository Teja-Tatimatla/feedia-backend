const express = require('express');
const router = express.Router();
const { mealChatHandler } = require('../controllers/mealController');

router.post('/', mealChatHandler);

module.exports = router;
