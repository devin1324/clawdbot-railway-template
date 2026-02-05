/**
 * Message Formatter
 *
 * Converts messages between Pumble format and OpenClaw internal format.
 */

class MessageFormatter {
  /**
   * Convert Pumble webhook message to OpenClaw format
   * @param {Object} pumbleMsg - Pumble message from webhook
   * @param {string} botUserId - Bot user ID for mention detection
   * @returns {Object} OpenClaw format message
   */
  toOpenClawFormat(pumbleMsg, botUserId) {
    const isDM = pumbleMsg.channel_type === 'dm' || pumbleMsg.is_dm || false;
    const channelId = pumbleMsg.channel_id || pumbleMsg.channel;
    const userId = pumbleMsg.user_id || pumbleMsg.user;

    // Check if bot is mentioned (format: <<@userId>>)
    const mentionRegex = new RegExp(`<<@${botUserId}>>`, 'i');
    const mentionsBotUser = pumbleMsg.text ? mentionRegex.test(pumbleMsg.text) : false;

    // Remove bot mention from text for cleaner processing
    let cleanedText = pumbleMsg.text || '';
    if (mentionsBotUser) {
      cleanedText = cleanedText.replace(mentionRegex, '').trim();
    }

    return {
      channelId: 'pumble',
      sessionKey: isDM
        ? `pumble:dm:${userId}`
        : `pumble:channel:${channelId}`,
      senderId: userId,
      senderName: pumbleMsg.user_name || pumbleMsg.username || userId,
      text: cleanedText,
      originalText: pumbleMsg.text,
      timestamp: pumbleMsg.timestamp || Date.now(),
      messageId: pumbleMsg.message_id || pumbleMsg.id,
      isDM,
      channelName: pumbleMsg.channel_name,
      workspaceId: pumbleMsg.workspace_id,
      mentionsBotUser,
      metadata: {
        channelType: pumbleMsg.channel_type,
        threadId: pumbleMsg.thread_id
      }
    };
  }

  /**
   * Convert OpenClaw response to Pumble format
   * @param {Object} openclawMsg - OpenClaw message
   * @param {string} channelId - Target Pumble channel
   * @param {string} userId - User to reply to (for mentions)
   * @returns {Object} Pumble format message
   */
  toPumbleFormat(openclawMsg, channelId, userId) {
    const message = {
      text: this.formatText(openclawMsg.text || openclawMsg.content || ''),
      channel: channelId
    };

    // Add mentions if replying to a specific user
    if (userId) {
      message.mentions = [userId];
      // Prepend mention to message
      message.text = `<<@${userId}>> ${message.text}`;
    }

    return message;
  }

  /**
   * Format text for Pumble (handle markdown, code blocks, etc.)
   * @param {string} text - Text to format
   * @returns {string} Formatted text
   */
  formatText(text) {
    if (!text) return '';

    // Ensure text doesn't exceed Pumble's 10,000 character limit
    const maxLength = 10000;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength - 50) + '\n\n... (message truncated)';
    }

    // Convert markdown code blocks to Pumble format if needed
    // Pumble supports markdown, so most formatting should work as-is

    return text;
  }

  /**
   * Extract user mentions from Pumble text
   * @param {string} text - Message text
   * @returns {Array<string>} Array of user IDs mentioned
   */
  extractMentions(text) {
    if (!text) return [];

    const mentionRegex = /<<@([^>]+)>>/g;
    const mentions = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  /**
   * Extract channel mentions from Pumble text
   * @param {string} text - Message text
   * @returns {Array<string>} Array of channel IDs mentioned
   */
  extractChannelMentions(text) {
    if (!text) return [];

    const channelRegex = /<<#([^>]+)>>/g;
    const channels = [];
    let match;

    while ((match = channelRegex.exec(text)) !== null) {
      channels.push(match[1]);
    }

    return channels;
  }

  /**
   * Check if message is a command
   * @param {string} text - Message text
   * @returns {boolean}
   */
  isCommand(text) {
    if (!text) return false;
    return text.trim().startsWith('/');
  }

  /**
   * Parse command from message
   * @param {string} text - Message text
   * @returns {Object} {command, args}
   */
  parseCommand(text) {
    if (!this.isCommand(text)) {
      return null;
    }

    const parts = text.trim().substring(1).split(/\s+/);
    return {
      command: parts[0],
      args: parts.slice(1)
    };
  }
}

module.exports = MessageFormatter;
