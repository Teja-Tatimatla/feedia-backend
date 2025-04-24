const OpenAI = require('openai');
const fs = require('fs');
const { systemPromptWrapAroundServices, wraparoundToolDefinition } = require('../utils/prompts');
const { findWraparoundServices } = require('../utils/wraparound');
const { wraparoundChatLog, pantryDataPath } = require('../utils/constants');
const constants = require('../utils/constants');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function wraparoundHelpChatHandler(req, res) {
  const { messages, location, language } = req.body;

  if (!location?.latitude || !location?.longitude) {
    return res.status(400).json({ error: 'User location is required in request body' });
  }

  switch (language) {
    case 'en':
      message = constants.greetings_wraparound_en;
      break;
    case 'es':
      message = constants.greetings_wraparound_es;
      break;
    case 'fr':
      message = constants.greetings_wraparound_fr;
      break;
    case 'te':
      message = constants.greetings_wraparound_te;
      break;
    case 'ja':
      message = constants.greetings_wraparound_ja;
      break;
    default:
      message = constants.greetings_wraparound_en;
  }

  if (!messages?.length) {
    return res.json({
      conversation: [
        {
          role: 'assistant',
          content: message,
        }
      ]
    });
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [systemPromptWrapAroundServices, ...messages],
      tools: [wraparoundToolDefinition],
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
        pantryDataPath
      );

      const replyText = results.length > 0
        ? `Here are some locations offering ${args.service}:\n\n` + results.map(p =>
          `${p.name}\n📍 ${p.address}\n⏰ ${p.hours?.map(h => `${h.day}: ${h.open} - ${h.close}`).join(', ')}\n📞 ${p.phone?.[0] || 'N/A'}\n🛠 Services: ${p.wraparoundService?.join(', ') || 'N/A'}\n🗺️ Directions: ${p.mapsLink}`
        ).join('\n\n')
        : `I couldn't find any pantries offering ${args.service} that are open at that time. Would you like to try a different time or service?`;

      if (replyText) {
        const lines = [...messages, { role: 'user', content: replyText }].map(e => JSON.stringify(e)).join('\n') + '\n\n';
        fs.appendFile(wraparoundChatLog, lines, () => {});
      }

      return res.json({
        conversation: [
          ...messages,
          reply,
          { role: 'function', name: 'findWraparoundServices', content: JSON.stringify(results) },
          { role: 'assistant', content: replyText }
        ]
      });
    }

    res.json({ conversation: [...messages, reply] });
  } catch (error) {
    console.error('GPT error:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

module.exports = { wraparoundHelpChatHandler };
