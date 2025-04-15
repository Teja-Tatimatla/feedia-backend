const OpenAI = require('openai');
const { systemPromptTherapy } = require('../utils/prompts');
const { therapyChatLog } = require('../utils/constants');
const fs = require('fs');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function therapyChatHandler(req, res) {
  const { messages } = req.body;

  if (!messages?.length) {
    return res.json({
      conversation: [
        {
          role: 'assistant',
          content: 'Hi there. I’m really glad you’re here. This is a safe and judgment-free space. You can talk to me about anything — I’m here to listen, whenever you’re ready. 💙'
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
