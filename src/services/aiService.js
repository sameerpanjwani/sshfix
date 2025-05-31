const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AnthropicAPI } = require('@anthropic-ai/sdk');
const aiUtils = require('../utils/ai');

class AIService {
    constructor() {
        // Initialize AI clients with environment variables
        this.openai = process.env.OPENAI_API_KEY ? 
            new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
        
        this.gemini = process.env.GOOGLE_API_KEY ?
            new GoogleGenerativeAI(process.env.GOOGLE_API_KEY) : null;
        
        this.anthropic = process.env.ANTHROPIC_API_KEY ?
            new AnthropicAPI({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
    }

    /**
     * Process a chat message with OpenAI
     * @param {Array} messages Chat history
     * @param {Object} options Model options
     * @returns {Promise<string>} AI response
     */
    async processWithOpenAI(messages, options = {}) {
        if (!this.openai) {
            throw new Error('OpenAI API key not configured');
        }

        const completion = await this.openai.chat.completions.create({
            model: options.model || 'gpt-4-turbo-preview',
            messages: messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            temperature: options.temperature || 0.7,
            max_tokens: options.maxTokens || 2000
        });

        return aiUtils.cleanAIResponse(completion.choices[0].message.content);
    }

    /**
     * Process a chat message with Google's Gemini
     * @param {Array} messages Chat history
     * @param {Object} options Model options
     * @returns {Promise<string>} AI response
     */
    async processWithGemini(messages, options = {}) {
        if (!this.gemini) {
            throw new Error('Google API key not configured');
        }

        const model = this.gemini.getGenerativeModel({ 
            model: options.model || 'gemini-pro'
        });

        const chat = model.startChat({
            history: messages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }))
        });

        const result = await chat.sendMessage(
            messages[messages.length - 1].content
        );

        return aiUtils.cleanAIResponse(result.response.text());
    }

    /**
     * Process a chat message with Anthropic's Claude
     * @param {Array} messages Chat history
     * @param {Object} options Model options
     * @returns {Promise<string>} AI response
     */
    async processWithClaude(messages, options = {}) {
        if (!this.anthropic) {
            throw new Error('Anthropic API key not configured');
        }

        const completion = await this.anthropic.messages.create({
            model: options.model || 'claude-3-opus-20240229',
            messages: messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            max_tokens: options.maxTokens || 2000,
            temperature: options.temperature || 0.7
        });

        return aiUtils.cleanAIResponse(completion.content[0].text);
    }

    /**
     * Process an image with OpenAI's DALL-E
     * @param {string} prompt Image generation prompt
     * @param {Object} options Generation options
     * @returns {Promise<string>} Path to generated image
     */
    async generateImage(prompt, options = {}) {
        if (!this.openai) {
            throw new Error('OpenAI API key not configured');
        }

        const response = await this.openai.images.generate({
            model: options.model || 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: options.size || '1024x1024',
            quality: options.quality || 'standard',
            response_format: 'b64_json'
        });

        const imageData = response.data[0].b64_json;
        return aiUtils.processAIImage(imageData, 'png');
    }

    /**
     * Analyze an image with OpenAI's GPT-4 Vision
     * @param {string} imagePath Path to image file
     * @param {string} prompt Analysis prompt
     * @returns {Promise<string>} Analysis result
     */
    async analyzeImage(imagePath, prompt) {
        if (!this.openai) {
            throw new Error('OpenAI API key not configured');
        }

        const imageData = await fs.readFile(imagePath, { encoding: 'base64' });
        
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4-vision-preview',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${imageData}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 500
        });

        return aiUtils.cleanAIResponse(response.choices[0].message.content);
    }
}

module.exports = new AIService(); 