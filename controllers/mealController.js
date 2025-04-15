const OpenAI = require('openai');
const fs = require('fs');
const { findClosestOpenPantries } = require('../utils/pantry');
const { mainChatLog, pantryDataPath } = require('../utils/constants');
const { mainChatSystemPrompt, chatMealToolDefinition } = require('../utils/prompts');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function mealChatHandler(req, res) {
  const { messages, location } = req.body;

  if (!messages?.length) {
    return res.json({
      conversation: [
        {
          role: 'assistant',
          content: 'Hi there! 👋 I\'m here to help you find nearby food pantries that match your needs. Let\'s get started — when are you planning to get food? Just let me know the day and time!'
        }
      ]
    });
  }

  if (!location?.latitude || !location?.longitude) {
    return res.status(400).json({ error: 'User location is required in request body' });
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'function', name: 'system-injected-location', content: JSON.stringify({ latitude: location.latitude, longitude: location.longitude }) },
        { role: 'system', content: mainChatSystemPrompt },
        ...messages
      ],
      tools: [ {
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
                  travelMode: { type: 'string', enum: ['driving', 'transit'] },
                  kitchenAvailable: { type: 'boolean' },
                  canTravel: { type: 'boolean' },
                  foodPreferences: {
                    type: 'array',
                    items: { type: 'string' }
                  }
                },
                required: ['latitude', 'longitude', 'day', 'time', 'travelMode']
            }
          }
        }],
      tool_choice: 'auto',
      temperature: 0.2
    });

    let finalMessage = '';
    const gptReply = response.choices[0].message?.content || '';
    
    const toolCall = response.choices[0].message.tool_calls?.[0];

    if (toolCall?.function.name === 'findClosestOpenPantries') {
      const args = JSON.parse(toolCall.function.arguments);
        
      const day = args.day;
      const pantries = findClosestOpenPantries(
        args.latitude || location.latitude,
        args.longitude || location.longitude,
        args.day,
        args.time,
        args.travelMode,
        pantryDataPath,
        args.kitchenAvailable ?? true,
        args.canTravel ?? true,
        args.foodPreferences ?? []
      );

      if (pantries.length > 0) {
        finalMessage = pantries.map(p => {
          return `Pantry: ${p.name}\n📍 Address: ${p.address}\n⏰ Open Hours: ${day} from ${p.hours.find(h => h.day.toLowerCase() === day.toLowerCase())?.open} to ${p.hours.find(h => h.day.toLowerCase() === day.toLowerCase())?.close}\n🍽️ Food Provided: ${p.foodFormat?.join(', ') || 'N/A'}\n🍱 Dietary Options: ${p.dietaryRestrictions?.join(', ') || 'N/A'}\n📆 Appointment Required: ${p.byAppointmentOnly?.join(', ') || 'No'}\n✅ Pantry Requirements: ${p.foodPantryRequirements?.join(', ') || 'None'}\n🗺️ Directions: ${p.mapsLink}\n`;
        }).join('\n---\n');
      } else {
        finalMessage = 'Sorry, there are no open pantries nearby that match your time and location.';
      }

    }

    if (finalMessage != '') {
        const lines = [...messages, {"role":"user","content":finalMessage}].map(entry => JSON.stringify(entry)).join('\n') + '\n' + '\n'; // Ideally, this is stored in DB. This is not very inefficient
        fs.appendFile(mainChatLog, lines, (err) => {});
    }

    res.json({
      conversation: [
        ...messages,
        { role: 'assistant', content: gptReply },
        { role: 'function', content: finalMessage }
      ]
    });
  } catch {
    res.status(500).json({ error: 'Error processing pantry data' });
  }
}

module.exports = { mealChatHandler };