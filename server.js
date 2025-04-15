// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mealRoutes = require('./routes/meals');
const therapyRoutes = require('./routes/therapy');
const wraparoundRoutes = require('./routes/wraparound');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/chat-meal', mealRoutes);
app.use('/therapy', therapyRoutes);
app.use('/wraparound-help', wraparoundRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));