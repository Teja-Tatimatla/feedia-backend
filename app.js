const express = require('express');
const fs = require('fs');
const path = require('path');
const geolib = require('geolib');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function findClosestOpenPantries(lat, lon, day, time, travelMode, jsonFilePath) {
  const pantriesData = JSON.parse(fs.readFileSync(path.resolve(jsonFilePath), 'utf8'));

  const openPantries = pantriesData.filter(pantry => {
    return pantry.hours.some(hour => {
      if (hour.day.toLowerCase() === day.toLowerCase()) {
        const pantryOpen = hour.open;
        const pantryClose = hour.close;
        return pantryOpen <= time && time <= pantryClose;
      }
      return false;
    });
  });

  const sortedPantries = openPantries
    .map(pantry => ({
      ...pantry,
      distance: geolib.getDistance(
        { latitude: lat, longitude: lon },
        { latitude: pantry.latitude, longitude: pantry.longitude }
      ),
      mapsLink: `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${pantry.latitude},${pantry.longitude}&travelmode=${travelMode}`
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);

  return sortedPantries;
}

app.post('/chat-meal', async (req, res) => {
  const { messages, location } = req.body;
  const jsonFilePath = './pantry_data.json';

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (!location || !location.latitude || !location.longitude) {
    return res.status(400).json({ error: 'User location is required in request body' });
  }

  try {
    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a cheerful and warm assistant helping a food-insecure individual. Do not ask the user for their location. Their latitude and longitude will be provided in a function message named \"system-injected-location\". Infer travel mode (driving or public transit) from the conversation.\' Once enough details are available, call the findClosestOpenPantries function using the user\'s latitude and longitude from the request body and the inferred travel mode.'},
        ...messages
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'findClosestOpenPantries',
            description: 'Find the closest open pantries based on latitude, longitude, day, and time',
            parameters: {
              type: 'object',
              properties: {
                latitude: { type: 'number' },
                longitude: { type: 'number' },
                day: { type: 'string' },
                time: { type: 'string' },
                travelMode: { type: 'string', enum: ['driving', 'transit'] }
              },
              required: ['latitude', 'longitude', 'day', 'time', 'travelMode']
            }
          }
        }
      ],
      tool_choice: 'auto'
    });

    let finalMessage = '';
    let gptReply = aiResponse.choices[0].message?.content || '';

    const toolCall = aiResponse.choices[0].message.tool_calls?.[0];

    if (toolCall && toolCall.function.name === 'findClosestOpenPantries') {
      const args = JSON.parse(toolCall.function.arguments);

      // Inject client-supplied location if GPT didn't include it
      const latitude = args.latitude || location.latitude;
      const longitude = args.longitude || location.longitude;
      const day = args.day;
      const time = args.time;
      const travelMode = args.travelMode;

      const closestPantries = findClosestOpenPantries(latitude, longitude, day, time, travelMode, jsonFilePath);

      if (closestPantries.length > 0) {
        finalMessage = closestPantries.map(p => {
          return `Pantry: ${p.name}\nAddress: ${p.address}\nOpen Hours: ${day} from ${p.hours.find(h => h.day.toLowerCase() === day.toLowerCase())?.open} to ${p.hours.find(h => h.day.toLowerCase() === day.toLowerCase())?.close}\nFood Provided: ${p.foodFormat?.join(', ') || 'N/A'}\nDietary Options: ${p.dietaryRestrictions?.join(', ') || 'N/A'}\nAppointment Required: ${p.byAppointmentOnly?.join(', ') || 'No'}\nDirections: ${p.mapsLink}\n`;
        }).join('\n---\n');
      } else {
        finalMessage = 'Sorry, there are no open pantries nearby that match your time and location.';
      }
    }

    res.json({
      conversation: [
        ...messages,
        { role: 'assistant', content: gptReply },
        { role: 'function', content: finalMessage }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: 'Error processing pantry data' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
