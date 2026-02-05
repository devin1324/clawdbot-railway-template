/**
 * Webhook Handler for Pumble
 *
 * Receives webhooks from Pumble and processes incoming messages.
 * Handles access control, message deduplication, and forwarding to OpenClaw Gateway.
 */

const PumbleClient = require('./client');
const MessageFormatter = require('./formatter');
const PairingManager = require('./pairing');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class WebhookHandler {
  constructor() {
    this.formatter = new MessageFormatter();
    this.pairingManager = null;
    this.client = null;
    this.botUserId = null;
    this.config = null;

    // Message deduplication
    this.seenMessages = new Set();
    this.maxSeenMessages = 1000;

    // Load config
    this.loadConfig();
  }

  /**
   * Load Pumble configuration from OpenClaw config
   */
  loadConfig() {
    try {
      const configPath = path.join(
        process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'),
        'openclaw.json'
      );

      if (fs.existsSync(configPath)) {
        const fullConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.config = fullConfig.channels?.pumble || {};

        if (this.config.enabled) {
          // Initialize client
          this.client = new PumbleClient(
            this.config.apiKey || process.env.PUMBLE_API_KEY,
            this.config.webhookUrl || process.env.PUMBLE_WEBHOOK_URL
          );

          // Initialize pairing manager
          const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw');
          this.pairingManager = new PairingManager(stateDir);

          console.log('[pumble-webhook] Configuration loaded successfully');
        }
      }
    } catch (err) {
      console.error('[pumble-webhook] Failed to load config:', err.message);
    }
  }

  /**
   * Handle incoming webhook from Pumble
   * @param {Object} payload - Webhook payload from Pumble
   * @param {string} gatewayToken - OpenClaw gateway token
   * @returns {Promise<Object>}
   */
  async handleWebhook(payload, gatewayToken) {
    try {
      // Reload config if needed
      if (!this.config || !this.config.enabled) {
        this.loadConfig();
      }

      if (!this.config || !this.config.enabled) {
        return { ok: false, error: 'Pumble channel not enabled' };
      }

      // Verify webhook signature if configured
      if (this.config.webhookSecret && payload.signature) {
        if (!this.verifySignature(payload, this.config.webhookSecret)) {
          console.error('[pumble-webhook] Invalid webhook signature');
          return { ok: false, error: 'Invalid signature' };
        }
      }

      // Get bot user ID
      if (!this.botUserId) {
        try {
          const botInfo = await this.client.getBotUser();
          this.botUserId = botInfo.user_id;
        } catch (err) {
          console.error('[pumble-webhook] Failed to get bot user ID:', err.message);
        }
      }

      // Handle different event types
      const eventType = payload.event_type || payload.type;

      switch (eventType) {
        case 'NEW_MESSAGE':
        case 'message':
          return await this.handleNewMessage(payload, gatewayToken);

        case 'REACTION_ADDED':
          // Could handle reactions in the future
          return { ok: true, message: 'Reaction events not yet supported' };

        default:
          console.log(`[pumble-webhook] Unhandled event type: ${eventType}`);
          return { ok: true, message: `Event type ${eventType} not handled` };
      }
    } catch (err) {
      console.error('[pumble-webhook] Error handling webhook:', err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Handle new message event
   * @param {Object} payload - Message payload
   * @param {string} gatewayToken - Gateway token
   * @returns {Promise<Object>}
   */
  async handleNewMessage(payload, gatewayToken) {
    const messageData = payload.message || payload;

    // Message deduplication
    const messageId = messageData.message_id || messageData.id;
    if (messageId && this.seenMessages.has(messageId)) {
      return { ok: true, message: 'Duplicate message ignored' };
    }

    // Add to seen messages
    if (messageId) {
      this.seenMessages.add(messageId);

      // LRU eviction
      if (this.seenMessages.size > this.maxSeenMessages) {
        const firstItem = this.seenMessages.values().next().value;
        this.seenMessages.delete(firstItem);
      }
    }

    // Convert to OpenClaw format
    const openclawMsg = this.formatter.toOpenClawFormat(messageData, this.botUserId);

    // Ignore bot's own messages
    if (openclawMsg.senderId === this.botUserId) {
      return { ok: true, message: 'Ignored bot own message' };
    }

    // Access control checks
    const accessCheck = this.checkAccessControl(openclawMsg);
    if (!accessCheck.allowed) {
      console.log(`[pumble-webhook] Access denied: ${accessCheck.reason}`);

      // If pairing needed, send pairing code
      if (accessCheck.pairingNeeded) {
        await this.sendPairingCode(openclawMsg);
      }

      return { ok: true, message: accessCheck.reason };
    }

    // Forward to OpenClaw Gateway
    try {
      await this.forwardToGateway(openclawMsg, gatewayToken);
      return { ok: true, message: 'Message processed' };
    } catch (err) {
      console.error('[pumble-webhook] Failed to forward to gateway:', err.message);
      return { ok: false, error: 'Failed to forward message' };
    }
  }

  /**
   * Check access control for a message
   * @param {Object} msg - Message object
   * @returns {Object} {allowed, reason, pairingNeeded}
   */
  checkAccessControl(msg) {
    // DM policy check
    if (msg.isDM) {
      const dmPolicy = this.config.dmPolicy || 'pairing';

      if (dmPolicy === 'disabled') {
        return { allowed: false, reason: 'DMs are disabled' };
      }

      if (dmPolicy === 'pairing') {
        if (!this.pairingManager.isUserApproved(msg.senderId)) {
          return { allowed: false, reason: 'User not approved', pairingNeeded: true };
        }
      }

      if (dmPolicy === 'allowlist') {
        const allowedUsers = this.config.allowedUsers || [];
        if (!allowedUsers.includes(msg.senderId)) {
          return { allowed: false, reason: 'User not in allowlist' };
        }
      }

      // dmPolicy === 'open' allows all
    }

    // Group/channel policy check
    if (!msg.isDM) {
      const groupPolicy = this.config.groupPolicy || 'allowlist';

      if (groupPolicy === 'disabled') {
        return { allowed: false, reason: 'Group messages are disabled' };
      }

      if (groupPolicy === 'allowlist') {
        const allowedChannels = this.config.allowedChannels || [];
        const channelId = msg.sessionKey.split(':')[2]; // Extract channel ID

        if (!allowedChannels.includes(channelId)) {
          return { allowed: false, reason: 'Channel not in allowlist' };
        }
      }

      // Check mention requirement
      if (this.config.requireMention) {
        if (!msg.mentionsBotUser) {
          return { allowed: false, reason: 'Bot not mentioned' };
        }
      }

      // groupPolicy === 'open' allows all
    }

    return { allowed: true };
  }

  /**
   * Send pairing code to user
   * @param {Object} msg - Message object
   */
  async sendPairingCode(msg) {
    try {
      const result = this.pairingManager.requestPairing(msg.senderId, msg.senderName);

      if (result.error && !result.alreadyApproved) {
        await this.client.sendMessage({
          text: `⚠️ ${result.error}`,
          channel: msg.sessionKey.split(':')[2], // Channel ID from session key
          mentions: [msg.senderId]
        });
      } else if (result.code) {
        const expiryMinutes = Math.floor((result.expiresAt - Date.now()) / 60000);
        await this.client.sendMessage({
          text: `🔐 Pairing Required\n\nYour pairing code is: \`${result.code}\`\n\nThe admin needs to approve this request with:\n\`openclaw pairing approve pumble ${result.code}\`\n\nThis code expires in ${expiryMinutes} minutes.`,
          channel: msg.sessionKey.split(':')[2],
          mentions: [msg.senderId]
        });
        console.log(`[pumble-webhook] Sent pairing code to ${msg.senderName}`);
      }
    } catch (err) {
      console.error('[pumble-webhook] Failed to send pairing code:', err.message);
    }
  }

  /**
   * Forward message to OpenClaw Gateway
   * @param {Object} msg - Message object
   * @param {string} gatewayToken - Gateway token
   */
  async forwardToGateway(msg, gatewayToken) {
    // This is a placeholder - in reality, we'd need to communicate with the Gateway via WebSocket
    // For now, we'll log that the message would be forwarded
    console.log('[pumble-webhook] Message would be forwarded to gateway:', {
      sessionKey: msg.sessionKey,
      text: msg.text,
      senderId: msg.senderId
    });

    // TODO: Implement actual Gateway WebSocket communication
    // This would require establishing a WebSocket connection to ws://127.0.0.1:18789
    // and sending the message through the Gateway's routing system
  }

  /**
   * Verify webhook signature
   * @param {Object} payload - Webhook payload
   * @param {string} secret - Webhook secret
   * @returns {boolean}
   */
  verifySignature(payload, secret) {
    if (!payload.signature) return false;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload.message || payload))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(payload.signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Cleanup on shutdown
   */
  shutdown() {
    if (this.pairingManager) {
      this.pairingManager.shutdown();
    }
  }
}

// Singleton instance
let handlerInstance = null;

/**
 * Get webhook handler instance
 * @returns {WebhookHandler}
 */
function getHandler() {
  if (!handlerInstance) {
    handlerInstance = new WebhookHandler();
  }
  return handlerInstance;
}

/**
 * Handle webhook (exported function)
 * @param {Object} payload - Webhook payload
 * @param {string} gatewayToken - Gateway token
 * @returns {Promise<Object>}
 */
async function handleWebhook(payload, gatewayToken) {
  const handler = getHandler();
  return handler.handleWebhook(payload, gatewayToken);
}

module.exports = {
  WebhookHandler,
  handleWebhook,
  getHandler
};
