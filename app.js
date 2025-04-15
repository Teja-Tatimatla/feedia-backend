const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const geolib = require('geolib');
const OpenAI = require('openai');
require('dotenv').config();

const mainChatLog = './logs/main_chat_log.ndjson';
const therapyChatLog = './logs/therapy_chat_log.ndjson';
const wraparoundChatLog = './logs/warparound_chat_log.ndjson';

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function findClosestOpenPantries(lat, lon, day, time, travelMode, jsonFilePath, kitchenAvailable = true, canTravel = true, foodPreferences = []) {
  console.log(day)
  const pantriesData = JSON.parse(fs.readFileSync(path.resolve(jsonFilePath), 'utf8'));

  const openPantries = pantriesData.filter(pantry => {
    const isOpen = pantry.hours?.some(hour => {
      return hour.day?.toLowerCase() === day.toLowerCase() && hour.open <= time && time <= hour.close;
    });

    if (!isOpen) return false;

    if (!kitchenAvailable) {
      const format = pantry.foodFormat?.join(' ').toLowerCase() || '';
      if (!format.includes('prepared') && !format.includes('hot') && !format.includes('meal')) return false;
    }

    if (!canTravel) {
      const dist = (pantry.distributionModels || []).join(', ').toLowerCase();
      if (!dist.includes('home delivery')) return false;
    }

    if (foodPreferences.length > 0) {
      const availableRestrictions = (pantry.dietaryRestrictions || []).map(d => d.toLowerCase());
      const hasAll = foodPreferences.every(pref => availableRestrictions.includes(pref.toLowerCase()));
      if (!hasAll) return false;
    }

    return true;
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

mainChatSysyemPrompt = `You are a cheerful and warm assistant helping a food-insecure individual. 
Do not ask the user for their location. Their latitude and longitude will be provided in a function message named "system-injected-location".
Ask the user one question at a time. Start by asking when they plan to get food.
Then ask about kitchen access, then travel ability- First ask them if they can travel on their own to the food-pantry.
If yes, ask them if they intend to travel via public transport or a private vehicle.
If no, ask them if one of their relatives or friends can pick up food for them.
If they have no one to pick up tell them that you\'ll look for food pantries with delivery service.
And finally dietary restrictions and preferences (if they are Diabetic, Hypertension, Low Sodium, Low Sugar, Fresh Produce, Halal).
Use this information to infer travel mode, kitchen availability, and dietary needs.
Once enough details are available, call the findClosestOpenPantries function including the kitchenAvailable, canTravel, foodPreferences values, and user\'s latitude and longitude from the request body and the inferred information. Make sure you derive and send send only the weekday names (time zone EST) to the function if natural date expressions are used.`;

app.post('/chat-meal', async (req, res) => {
  const { messages, location } = req.body;
  const jsonFilePath = './pantry_data.json';

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.json({
      conversation: [
        {
          role: 'assistant',
          content: 'Hi there! 👋 I’m here to help you find nearby food pantries that match your needs. Let’s get started — when are you planning to get food? Just let me know the day and time!'
        }
      ]
    });
  }

  if (!location || !location.latitude || !location.longitude) {
    return res.status(400).json({ error: 'User location is required in request body' });
  }

  try {
    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
      
      {
        role: 'function',
        name: 'system-injected-location',
        content: JSON.stringify({ latitude: location.latitude, longitude: location.longitude })
      },
        { role: 'system', content:  mainChatSysyemPrompt},
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
        }
      ],
      tool_choice: 'auto',
      temperature: 0.2
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

      const kitchenAvailable = args.kitchenAvailable ?? true;
      const canTravel = args.canTravel ?? true;
      const foodPreferences = args.foodPreferences ?? [];

      const closestPantries = findClosestOpenPantries(latitude, longitude, day, time, travelMode, jsonFilePath, kitchenAvailable, canTravel, foodPreferences);

      if (closestPantries.length > 0) {
        finalMessage = closestPantries.map(p => {
          return `Pantry: ${p.name}\n📍 Address: ${p.address}\n⏰ Open Hours: ${day} from ${p.hours.find(h => h.day.toLowerCase() === day.toLowerCase())?.open} to ${p.hours.find(h => h.day.toLowerCase() === day.toLowerCase())?.close}\n🍽️ Food Provided: ${p.foodFormat?.join(', ') || 'N/A'}\n🍱 Dietary Options: ${p.dietaryRestrictions?.join(', ') || 'N/A'}\n📆 Appointment Required: ${p.byAppointmentOnly?.join(', ') || 'No'}\n✅ Pantry Requirements: ${p.foodPantryRequirements?.join(', ') || 'None'}\n🗺️ Directions: ${p.mapsLink}\n`;
        }).join('\n---\n');
      } else {
        finalMessage = 'Sorry, there are no open pantries nearby that match your time and location.';
      }
    }

    if(finalMessage != '') {
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
  } catch (error) {
    res.status(500).json({ error: 'Error processing pantry data' });
  }
});


// System instruction for therapy tone
const systemPromptTherapy = {
  role: "system",
  content: `
You are a compassionate mental health assistant trained to support individuals facing food insecurity. 
Always let the user know this is a safe, non-judgmental space. Invite them to share how they’re feeling.

Your role is to listen, validate, and gently engage. Never pressure the user. Never give medical advice. 
Avoid cheerfulness — be kind, soft, and respectful. Prioritize making the user feel emotionally safe.`
};

app.post('/therapy', async (req, res) => {
  const { messages } = req.body;

  // If conversation has not started, return a warm greeting
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.json({
      conversation: [
        {
          role: "assistant",
          content: "Hi there. I’m really glad you’re here. This is a safe and judgment-free space. You can talk to me about anything — I’m here to listen, whenever you're ready. 💙"
        }
      ]
    });
  }

  try {
    const fullConversation = [systemPromptTherapy, ...messages];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: fullConversation,
      temperature: 0.7
    });

    const gptReply = completion.choices[0].message;

    const updatedConversation = [...messages, gptReply];

    //const lines = messages.map(entry => JSON.stringify(entry)).join('\n') + '\n'; // Ideally, this is stored in DB. This is not very inefficient
    //fs.appendFile(therapyChatLog, lines, (err) => {});

    res.json({ conversation: updatedConversation });
  } catch (error) {
    console.error('GPT Error:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});


const systemPromptWrapAroundServices = {
  role: 'system',
  content: `
You are a caring assistant helping people who are food insecure find support services at local establishments.Ask the user one question at a time.
Do not ask the user for their location. Their latitude and longitude will be provided in a function message named "system-injected-location". 
Start by introducing the kinds of wraparound services available (e.g. housing, financial assistance, healthcare, etc). 
Then ask the user which type of help they are looking for. After that, gather the day and time they want to visit and their transportation mode.

You can help with the following services - Non-food items, Info on gov't benefits, Childcare, Housing, Healthcare, Financial assistance, Financial advising, Case management, Programming support for older adults, Housing, Legal services, Job training workforce development, Info on gov't benefits, Behavioral Healthcare, ESL.
Once you have the needed info, call the function to filter pantries that match their need.
Don't call the establishment food pantry.
Speak in clear, respectful language. Never offer medical or legal advice.`
};

const toolDefinition = {
  type: 'function',
  function: {
    name: 'findWraparoundServices',
    description: 'Filter pantries offering wraparound services based on user needs, availability, and other options.',
    parameters: {
      type: 'object',
      properties: {
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        day: { type: 'string' },
        time: { type: 'string' },
        travelMode: { type: 'string', enum: ['driving', 'transit'] },
        service: { type: 'string' }
      },
      required: ['latitude', 'longitude', 'day', 'time', 'travelMode', 'service']
    }
  }
};

function findWraparoundServices(lat, lon, day, time, travelMode, jsonFilePath) {
  const pantriesData = JSON.parse(fs.readFileSync(path.resolve(jsonFilePath), 'utf8'));

  const openPantries = pantriesData.filter(pantry => {
    return pantry.hours?.some(hour =>
      hour.day?.toLowerCase() === day.toLowerCase() &&
      hour.open <= time && time <= hour.close
    );
  });

  const sortedPantries = openPantries
    .map(pantry => {
      const distance = geolib.getDistance(
        { latitude: lat, longitude: lon },
        { latitude: pantry.latitude, longitude: pantry.longitude }
      );

      const mapsLink = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${pantry.latitude},${pantry.longitude}&travelmode=${travelMode}`;

      return {
        ...pantry,
        distance,
        mapsLink
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);

  return sortedPantries;
}

app.post('/wraparound-help', async (req, res) => {
  const { messages, location } = req.body;

  if (!location || !location.latitude || !location.longitude) {
    return res.status(400).json({ error: 'User location is required in request body' });
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.json({
      conversation: [{
        role: 'assistant',
        content: `Hello. I can assist you in finding local support services including housing, medical care, job programs, and legal assistance — all provided by community partners at no cost. What type of help are you looking for today?`
      }]
    });
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [systemPromptWrapAroundServices, ...messages],
      tools: [toolDefinition],
      tool_choice: 'auto'
    });

    const reply = response.choices[0].message;

    if (reply.tool_calls?.[0]) {
      const toolCall = reply.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);

      const results = findWraparoundServices(
        args.latitude || location.latitude,
        args.longitude || location.longitude,
        args.day,
        args.time,
        args.travelMode,
        './pantry_data.json'
      );

      let replyText = '';
      if (results.length > 0) {
        replyText = `Here are some locations offering ${args.service}:\n\n` + results.map(p =>
          `${p.name}
📍 ${p.address}
⏰ ${p.hours?.map(h => `${h.day}: ${h.open} - ${h.close}`).join(', ')}
📞 ${p.phone?.[0] || 'N/A'}
🛠 Services: ${p.wraparoundService?.join(', ') || 'N/A'}
🗺️ Directions: ${p.mapsLink}`
        ).join('\n\n');
      } else {
        replyText = `I couldn't find any pantries offering ${args.service} that are open at that time. Would you like to try a different time or service?`;
      }

      if(replyText != '') {
        const lines = [...messages, {"role":"user","content":replyText}].map(entry => JSON.stringify(entry)).join('\n') + '\n' + '\n'; // Ideally, this is stored in DB. This is not very inefficient
        fs.appendFile(wraparoundChatLog, lines, (err) => {});
      }

      return res.json({
        conversation: [
          ...messages,
          reply,
          {
            role: 'function',
            name: 'findWraparoundServices',
            content: JSON.stringify(results)
          },
          {
            role: 'assistant',
            content: replyText
          }
        ]
      });
    }

    res.json({ conversation: [...messages, reply] });
  } catch (error) {
    console.error('GPT error:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
