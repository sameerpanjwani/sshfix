const axios = require('axios');
const chatRepository = require('../repositories/chatRepository');
const { cleanAIResponse, extractImageUrlsFromMarkdown, fetchImagesAsBase64 } = require('../utils/ai');

class AIService {
  async getAvailableModels() {
    return {
      openai: !!process.env.OPENAI_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      claude: !!process.env.CLAUDE_API_KEY,
    };
  }

  async processAIRequest({
    prompt,
    model,
    serverId,
    chatSessionId,
    withTerminalContext,
    systemPrompt,
    imageUrls,
    messageId,
    edit,
    req
  }) {
    let aiResponse = '';
    let aiJson = null;

    // Compose messages for AI API
    const messages = [];
    const defaultSystemPrompt =
      'You are an expert server assistant operating in a terminal environment. You can suggest shell commands for the user to run, and you will see the output of those commands. Your job is to help the user diagnose, fix, and automate server issues using the terminal. Always be safe, never suggest anything that could cause harm, data loss, or security issues. Explain your reasoning, ask for confirmation before any risky action, and help the user get things done efficiently.';

    const jsonInstruction = `IMPORTANT: You MUST always respond in valid JSON format with exactly these fields:
1. "answer": A string containing your explanation, analysis, and advice
2. "commands": An array of shell command strings that the user can run (provide practical, relevant commands even if not explicitly requested)
3. "explanations": An array of strings, where each string explains the corresponding command in the commands array. Each explanation should describe:
   1. What the command does
   2. Why it's relevant to the user's request or current context
   3. What output to expect
   4. Any potential errors to watch out for and how to handle them`;

    messages.push({ role: 'system', content: (systemPrompt || defaultSystemPrompt) + '\n\n' + jsonInstruction });

    // Get chat history
    let chatHistory = await chatRepository.getChatHistory(serverId, chatSessionId);

    // Add terminal context if requested
    if (withTerminalContext && serverId && chatSessionId) {
      try {
        console.log('[AIService] Including terminal context for session', chatSessionId);
        const serverRepository = require('../repositories/serverRepository');
        
        // Get terminal history for this session
        const terminalHistory = await serverRepository.getSessionHistory(serverId, chatSessionId);
        
        if (terminalHistory && terminalHistory.length > 0) {
          console.log('[AIService] Found', terminalHistory.length, 'terminal history entries');
          
          // Add a system message with the terminal context
          let terminalContextMsg = 'Recent terminal commands and their outputs:\n\n';
          
          // Add the terminal history in chronological order (oldest to newest)
          [...terminalHistory].reverse().forEach((entry, i) => {
            if (entry.command && entry.command.trim()) {
              terminalContextMsg += `Command ${i+1}: ${entry.command.trim()}\n`;
              if (entry.output && entry.output.trim()) {
                // Truncate very long outputs
                const truncatedOutput = entry.output.length > 1000 
                  ? entry.output.slice(0, 1000) + '... [output truncated]' 
                  : entry.output;
                terminalContextMsg += `Output ${i+1}:\n${truncatedOutput}\n\n`;
              } else {
                terminalContextMsg += `Output ${i+1}: [No output available]\n\n`;
              }
            }
          });
          
          // Add this context as a system message
          messages.push({ 
            role: 'system', 
            content: terminalContextMsg + '\nPlease consider these terminal commands and their outputs when responding to the user.'
          });
          
          console.log('[AIService] Added terminal context to AI prompt');
        } else {
          console.log('[AIService] No terminal history found for session', chatSessionId);
        }
      } catch (error) {
        console.error('[AIService] Error adding terminal context:', error);
      }
    }

    // Process images
    let allPrevImageUrls = [];
    chatHistory.forEach(m => {
      if (m.role === 'user') {
        allPrevImageUrls.push(...extractImageUrlsFromMarkdown(m.message));
      }
    });
    allPrevImageUrls = [...new Set(allPrevImageUrls)];

    let chatHistoryForAI = chatHistory.map(m => ({ role: m.role, content: m.message }));
    let userMsg = prompt;
    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
      userMsg += '\n[The user attached images for analysis.]';
    }

    if (edit && messageId) {
      const idx = chatHistory.findIndex(m => m.id === messageId && m.role === 'user');
      if (idx !== -1) {
        chatHistoryForAI[idx] = { role: 'user', content: userMsg };
      }
    }

    messages.push(...chatHistoryForAI);
    if (!edit) {
      messages.push({ role: 'user', content: userMsg });
    }

    try {
      switch (model) {
        case 'openai':
          const result = await this.callOpenAI(messages, imageUrls, req);
          aiResponse = result.response;
          aiJson = result.json;
          break;

        case 'gemini':
        case 'gemini-pro':
          const geminiResult = await this.callGemini(messages, imageUrls, model, req);
          aiResponse = geminiResult.response;
          aiJson = geminiResult.json;
          break;

        case 'claude':
          const claudeResult = await this.callClaude(messages, imageUrls, req);
          aiResponse = claudeResult.response;
          aiJson = claudeResult.json;
          break;

        default:
          throw new Error('Invalid model');
      }

      // Store or update messages in chat history
      if (serverId) {
        let fullUserMsg = prompt;
        if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
          fullUserMsg += '\n' + imageUrls.map(url => {
            const finalUrl = url.startsWith('/uploads/') ? url : `/uploads/${url.replace(/^.*[\\/]/, '')}`;
            return `![image](${finalUrl})`;
          }).join(' ');
        }

        const aiRequestContextString = JSON.stringify(messages);

        if (edit && messageId) {
          await chatRepository.updateUserMessage(messageId, serverId, fullUserMsg, chatSessionId);
          const aiMsgToUpdate = await chatRepository.getNextAIMessage(messageId, serverId, chatSessionId);

          if (aiMsgToUpdate) {
            await chatRepository.updateAIMessage(aiMsgToUpdate.id, serverId, aiResponse, chatSessionId, aiRequestContextString);
          } else {
            await chatRepository.addAIMessage(serverId, aiResponse, chatSessionId, aiRequestContextString);
          }
        } else {
          await chatRepository.addUserMessage(serverId, fullUserMsg, chatSessionId);
          await chatRepository.addAIMessage(serverId, aiResponse, chatSessionId, aiRequestContextString);
        }
      }

      return { response: aiResponse, json: aiJson };

    } catch (error) {
      console.error('AI processing error:', error);
      throw error;
    }
  }

  async callOpenAI(messages, imageUrls, req) {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    let openaiMessages = messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }));

    // Process existing images in messages
    for (let i = 0; i < openaiMessages.length; i++) {
      if (openaiMessages[i].role === 'user') {
        const msg = openaiMessages[i];
        const urls = extractImageUrlsFromMarkdown(msg.content);
        if (urls.length > 0) {
          const images = await fetchImagesAsBase64(urls, req);
          const contentArr = [{ type: 'text', text: msg.content.replace(/!\[image\]\(([^)]+)\)/g, '').trim() }];
          for (const img of images) {
            contentArr.push({ type: 'image_url', image_url: { url: `data:${img.contentType};base64,${img.base64}` } });
          }
          openaiMessages[i] = { role: 'user', content: contentArr };
        }
      }
    }

    // Process new images
    if (imageUrls && imageUrls.length > 0) {
      const images = await fetchImagesAsBase64(imageUrls, req);
      const contentArr = [{ type: 'text', text: openaiMessages[openaiMessages.length - 1].content }];
      for (const img of images) {
        contentArr.push({ type: 'image_url', image_url: { url: `data:${img.contentType};base64,${img.base64}` } });
      }
      openaiMessages[openaiMessages.length - 1] = { role: 'user', content: contentArr };
    }

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: openaiMessages,
      response_format: { type: 'json_object' },
    }, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const aiResponse = response.data.choices[0].message.content;
    let aiJson = null;
    try {
      aiJson = JSON.parse(cleanAIResponse(aiResponse));
    } catch (e) {
      aiJson = null;
    }

    return { response: aiResponse, json: aiJson };
  }

  async callGemini(messages, imageUrls, model, req) {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = (model === 'gemini-pro' || model.toLowerCase().includes('pro'))
      ? 'gemini-2.5-pro-preview-05-06'
      : 'gemini-2.5-flash-preview-04-17';

    let geminiMessages = messages
      .filter(m => m.role === 'user' || m.role === 'ai')
      .map(m => ({
        role: m.role === 'ai' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    // Process existing images
    for (let i = 0; i < geminiMessages.length; i++) {
      if (geminiMessages[i].role === 'user') {
        const msg = geminiMessages[i];
        const urls = extractImageUrlsFromMarkdown(msg.parts[0].text);
        if (urls.length > 0) {
          const images = await fetchImagesAsBase64(urls, req);
          geminiMessages[i].parts = [
            { text: msg.parts[0].text.replace(/!\[image\]\(([^)]+)\)/g, '').trim() },
            ...images.map(img => ({ inline_data: { mime_type: img.contentType, data: img.base64 } }))
          ];
        }
      }
    }

    // Process new images
    if (imageUrls && imageUrls.length > 0) {
      const images = await fetchImagesAsBase64(imageUrls, req);
      geminiMessages[geminiMessages.length - 1].parts = [
        { text: geminiMessages[geminiMessages.length - 1].parts[0].text },
        ...images.map(img => ({ inline_data: { mime_type: img.contentType, data: img.base64 } }))
      ];
    }

    const geminiPayload = {
      contents: geminiMessages,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
        stopSequences: []
      }
    };

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=` + geminiApiKey,
        geminiPayload
      );

      const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let aiJson = null;
      try {
        aiJson = JSON.parse(cleanAIResponse(aiResponse));
      } catch (e) {
        aiJson = null;
      }

      return { response: aiResponse, json: aiJson };
    } catch (error) {
      console.error('Gemini API error:', error);
      throw error;
    }
  }

  async callClaude(messages, imageUrls, req) {
    const claudeApiKey = process.env.CLAUDE_API_KEY;
    let claudeMessages = messages
      .filter(m => m.role === 'user' || m.role === 'ai')
      .map(m => {
        if (m.role === 'ai') {
          return { role: 'assistant', content: m.content.replace(/!\[.*?\]\(.*?\)/g, '') };
        } else {
          const urls = extractImageUrlsFromMarkdown(m.content);
          if (urls.length > 0) {
            const text = m.content.replace(/!\[.*?\]\(.*?\)/g, '').trim();
            return { role: 'user', content: [{ type: 'text', text }, ...urls.map(url => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }))] };
          } else {
            return { role: 'user', content: m.content };
          }
        }
      });

    // Process images in messages
    let userMsgIdx = 0;
    for (let i = 0; i < claudeMessages.length; i++) {
      const msg = claudeMessages[i];
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const origUserMessages = messages.filter(m => m.role === 'user');
        const origMsg = origUserMessages[userMsgIdx];
        userMsgIdx++;
        if (!origMsg) continue;

        let imageIdx = 0;
        for (let j = 0; j < msg.content.length; j++) {
          if (msg.content[j].type === 'image') {
            const urls = extractImageUrlsFromMarkdown(origMsg.content);
            if (urls[imageIdx]) {
              try {
                const images = await fetchImagesAsBase64([urls[imageIdx]], req);
                if (images[0]) {
                  msg.content[j].source.media_type = images[0].contentType;
                  msg.content[j].source.data = images[0].base64;
                }
              } catch (e) {
                msg.content.splice(j, 1);
                j--;
              }
            }
            imageIdx++;
          }
        }
      }
    }

    // Process new images
    if (imageUrls && imageUrls.length > 0) {
      const images = await fetchImagesAsBase64(imageUrls, req);
      const lastUserIdx = claudeMessages.map(m => m.role).lastIndexOf('user');
      if (lastUserIdx !== -1) {
        if (!Array.isArray(claudeMessages[lastUserIdx].content)) {
          claudeMessages[lastUserIdx].content = [{ type: 'text', text: claudeMessages[lastUserIdx].content }];
        }
        for (const img of images) {
          claudeMessages[lastUserIdx].content.push({
            type: 'image',
            source: { type: 'base64', media_type: img.contentType, data: img.base64 }
          });
        }
      }
    }

    // Force JSON output
    claudeMessages.push({ role: 'assistant', content: '{' });

    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: claudeMessages,
      system: messages[0].content,
    };

    try {
      const response = await axios.post('https://api.anthropic.com/v1/messages', payload, {
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'X-Cache-Write': 'true',
        },
      });

      let text = '';
      if (response.data.content && Array.isArray(response.data.content)) {
        text = response.data.content.map(c => c.text).join('');
      } else if (response.data.content && response.data.content.text) {
        text = response.data.content.text;
      }

      const aiResponse = '{' + text;
      let aiJson = null;
      try {
        aiJson = JSON.parse(cleanAIResponse(aiResponse));
      } catch (e) {
        aiJson = null;
      }

      return { response: aiResponse, json: aiJson };
    } catch (error) {
      console.error('Claude API error:', error);
      throw error;
    }
  }
}

module.exports = new AIService(); 