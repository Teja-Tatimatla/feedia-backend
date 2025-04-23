const OpenAI = require('openai');
const { systemPromptTherapy } = require('../utils/prompts');
const { therapyChatLog } = require('../utils/constants');
const fs = require('fs');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function therapyChatHandler(req, res) {
  const { messages, language } = req.body;

    switch (language) {
      case 'en':
        message = constants.greetings_therapy_en;
        break;
      case 'es':
        message = constants.greetings_therapy_es;
        break;
      case 'fr':
        message = constants.greetings_therapy_fr;
        break;
      case 'te':
        message = constants.greetings_therapy_te;
        break;
      case 'ja':
        message = constants.greetings_therapy_ja;
        break;
      default:
        message = constants.greetings_therapy_en;
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
    const fullConversation = [systemPromptTherapy, ...messages];
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: fullConversation,
      temperature: 0.7
    });

    const gptReply = completion.choices[0].message;
    const updatedConversation = [...messages, gptReply];

    // Optional logging (disabled for now)
    // const lines = updatedConversation.map(e => JSON.stringify(e)).join('\n') + '\n\n';
    // fs.appendFile(therapyChatLog, lines, () => {});

    res.json({ conversation: updatedConversation });
  } catch (error) {
    console.error('GPT Error:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

module.exports = { therapyChatHandler };
