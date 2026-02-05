/**
 * Pumble API Client
 *
 * Handles communication with Pumble's REST API for sending messages.
 * Supports both API key authentication and incoming webhook URLs.
 */

const RateLimiter = require('./rate-limiter');

class PumbleClient {
  constructor(apiKey, webhookUrl) {
    this.apiKey = apiKey;
    this.webhookUrl = webhookUrl;
    this.baseUrl = 'https://pumble-api-keys.addons.marketplace.cake.com';
    this.rateLimiter = new RateLimiter(1000); // 1 req/sec
    this.botUserId = null;
  }

  /**
   * Get bot user information
   * @returns {Promise<Object>} Bot user info
   */
  async getBotUser() {
    if (this.botUserId) {
      return { user_id: this.botUserId };
    }

    try {
      const resp = await this.apiCall('/auth/test');
      this.botUserId = resp.user_id;
      return resp;
    } catch (err) {
      console.error('[pumble-client] Failed to get bot user:', err.message);
      throw err;
    }
  }

  /**
   * Send a message to Pumble
   * @param {Object} message - Message object {text, channel, mentions}
   * @returns {Promise<Object>} Response from Pumble
   */
  async sendMessage(message) {
    return this.rateLimiter.enqueue(async () => {
      if (this.webhookUrl) {
        return this.sendViaWebhook(message);
      } else {
        return this.sendViaAPI(message);
      }
    });
  }

  /**
   * Send message via Pumble incoming webhook
   * @param {Object} message - Message object
   * @returns {Promise<Object>}
   */
  async sendViaWebhook(message) {
    try {
      const payload = {
        text: message.text
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook error ${response.status}: ${errorText}`);
      }

      return await response.json().catch(() => ({ ok: true }));
    } catch (err) {
      console.error('[pumble-client] Webhook send error:', err.message);
      throw err;
    }
  }

  /**
   * Send message via Pumble REST API
   * @param {Object} message - Message object {text, channel, mentions}
   * @returns {Promise<Object>}
   */
  async sendViaAPI(message) {
    const payload = {
      text: message.text,
      channel: message.channel
    };

    if (message.mentions && message.mentions.length > 0) {
      payload.mentions = message.mentions;
    }

    return this.apiCall('/messages', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /**
   * Fetch messages from a channel (for debugging/testing)
   * @param {string} channelId - Channel ID
   * @param {number} after - Timestamp after which to fetch
   * @returns {Promise<Object>}
   */
  async fetchMessages(channelId, after) {
    const params = new URLSearchParams({
      channel: channelId,
      limit: '50'
    });

    if (after) {
      params.set('after', after.toString());
    }

    return this.apiCall(`/messages?${params}`);
  }

  /**
   * Get list of channels
   * @returns {Promise<Object>}
   */
  async getChannels() {
    return this.apiCall('/channels');
  }

  /**
   * Make an API call to Pumble
   * @param {string} path - API path
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>}
   */
  async apiCall(path, options = {}) {
    if (!this.apiKey) {
      throw new Error('Pumble API key is required for API calls');
    }

    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Api-Key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Pumble API error ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (err) {
      console.error(`[pumble-client] API call failed (${path}):`, err.message);
      throw err;
    }
  }

  /**
   * Redact secrets from text for logging
   * @param {string} text - Text to redact
   * @returns {string}
   */
  static redactSecrets(text) {
    if (!text) return text;

    return String(text)
      .replace(/api-key["\s:=]+[A-Za-z0-9_-]{20,}/gi, 'api-key="[REDACTED]"')
      .replace(/webhook\.pumble\.com\/[A-Za-z0-9_-]{20,}/gi, 'webhook.pumble.com/[REDACTED]')
      .replace(/(Authorization|Api-Key):\s*[^\s\n]+/gi, '$1: [REDACTED]');
  }
}

module.exports = PumbleClient;
