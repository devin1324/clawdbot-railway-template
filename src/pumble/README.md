# Pumble Channel for OpenClaw

This directory contains the Pumble communication channel integration for OpenClaw. It enables OpenClaw to receive and send messages through Pumble workspaces with webhook-based real-time delivery and secure DM pairing.

## Features

- **Real-time message delivery** via webhooks (no polling delay)
- **Secure DM pairing** with 1-hour expiry codes
- **Group allowlist** for channel-based access control
- **Mention detection** (`requireMention` for channels)
- **Rate limiting** (1 req/sec for outbound messages)
- **Message deduplication** (prevents duplicate processing)
- **Secret redaction** in logs

## Architecture

```
Pumble Webhook → Railway App → webhook-handler.js
                                    ↓
                              Access Control Check
                                    ↓
                              OpenClaw Gateway
                                    ↓
                              AI Agent Processing
                                    ↓
                              Pumble REST API
                                    ↓
                              Message Delivered
```

## Setup Instructions

### 1. Generate Pumble API Key

1. Open Pumble workspace
2. Run command: `/api-keys generate`
3. Copy the API key from the ephemeral message
4. Save it securely (you'll need it for Railway)

### 2. Create Incoming Webhook (Optional, for sending)

1. Go to Pumble Workspace Settings
2. Navigate to "Incoming Webhooks"
3. Click "Create new webhook"
4. Select target channel
5. Copy the webhook URL

### 3. Deploy to Railway

1. Deploy this template to Railway
2. Set environment variables:
   - `PUMBLE_API_KEY` - Your Pumble API key
   - `PUMBLE_WEBHOOK_URL` - (Optional) Incoming webhook URL
   - `SETUP_PASSWORD` - Password for /setup wizard

3. Visit `https://your-app.railway.app/setup`
4. Enter the Pumble API key and webhook URL
5. Note the webhook endpoint URL displayed: `https://your-app.railway.app/webhooks/pumble`

### 4. Configure Pumble Addon Webhook

You need to create a Pumble addon that forwards events to your Railway app.

**Option A: Use pumble-node-sdk**

1. Install Pumble CLI: `npm i -g pumble-cli`
2. Login: `pumble-cli login`
3. Create addon: `pumble-cli create`
4. In `src/main.ts`, add event handler:

```typescript
import { App } from 'pumble-sdk';

const app = new App({
  botTitle: 'OpenClaw Bot'
});

app.event('NEW_MESSAGE', async ({ event, say }) => {
  // Forward to Railway
  await fetch('https://your-app.railway.app/webhooks/pumble', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: 'NEW_MESSAGE',
      message: event.message
    })
  });
});

export default app;
```

5. Deploy: `npm run dev`

**Option B: Use Zapier/Integromat**

1. Create a Zap/Integration
2. Trigger: "New Message in Pumble"
3. Action: "Webhooks - POST"
4. URL: `https://your-app.railway.app/webhooks/pumble`
5. Payload: Map Pumble fields to webhook format

## Configuration

Configuration is stored in `~/.openclaw/openclaw.json`:

```json5
{
  "channels": {
    "pumble": {
      "enabled": true,
      "apiKey": "your-api-key-here",
      "webhookUrl": "https://webhook.pumble.com/...",
      "railwayWebhookUrl": "https://your-app.railway.app/webhooks/pumble",

      // Security settings
      "dmPolicy": "pairing",        // pairing | allowlist | open | disabled
      "groupPolicy": "allowlist",   // allowlist | open | disabled
      "requireMention": true,       // Only respond when @mentioned

      // Performance
      "streamMode": "final",        // final (no streaming)

      // Access control
      "allowedChannels": [
        "C123456",  // Specific channel IDs
        "C789012"
      ]
    }
  }
}
```

### DM Policies

- **`pairing`** (Recommended): Unknown users must be approved with 1-hour expiry codes
- **`allowlist`**: Only pre-configured users can message
- **`open`**: Anyone can message (not secure)
- **`disabled`**: Block all DMs

### Group Policies

- **`allowlist`** (Recommended): Only explicitly allowed channels
- **`open`**: All channels allowed (still requires mention if `requireMention: true`)
- **`disabled`**: Block all group messages

## Usage

### DM Pairing Flow

1. User sends DM to bot in Pumble
2. Bot responds with pairing code
3. Admin runs: `openclaw pairing approve pumble <code>`
4. User can now message the bot

### Channel Usage

1. Add channel ID to `allowedChannels` in config
2. User @mentions bot in channel: `@OpenClaw what is 2+2?`
3. Bot responds in thread or channel

## CLI Commands

```bash
# Approve a pairing code
openclaw pairing approve pumble <code>

# List pending pairings
openclaw pairing list pumble

# List approved users
openclaw pairing list-approved pumble

# Restart gateway to reload config
openclaw gateway restart
```

## File Structure

```
src/pumble/
├── README.md              # This file
├── plugin.js              # Main entry point
├── client.js              # Pumble REST API client
├── webhook-handler.js     # Webhook receiver & processor
├── pairing.js             # DM pairing manager
├── formatter.js           # Message format conversion
└── rate-limiter.js        # Queue-based rate limiter
```

## Security

### Access Control

- **DM pairing**: 1-hour expiry, max 3 pending codes
- **Group allowlist**: Explicit channel IDs required
- **Mention requirement**: Bot only responds when @mentioned

### Credential Storage

```
~/.openclaw/
├── openclaw.json (mode 0o600)
├── gateway.token (mode 0o600)
├── pumble-pairing.json (mode 0o600)
└── pumble-approved.json (mode 0o600)
```

### Secret Redaction

All logs automatically redact:
- API keys: `api-key="[REDACTED]"`
- Webhook URLs: `webhook.pumble.com/[REDACTED]"`
- Authorization headers: `Authorization: [REDACTED]`

## Troubleshooting

### Webhook not receiving messages

1. Check Pumble addon is running
2. Verify webhook URL is correct
3. Check Railway app logs: `railway logs`
4. Test webhook manually:

```bash
curl -X POST https://your-app.railway.app/webhooks/pumble \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "NEW_MESSAGE",
    "message": {
      "text": "test",
      "user_id": "U123",
      "channel_id": "C123",
      "timestamp": 1234567890
    }
  }'
```

### Messages not sending

1. Verify API key is correct
2. Check rate limiting (1 req/sec)
3. Verify webhook URL (if using incoming webhook)
4. Check OpenClaw logs for errors

### Pairing not working

1. Check DM policy: `openclaw config get channels.pumble.dmPolicy`
2. List pending pairings: Check pairing file at `~/.openclaw/pumble-pairing.json`
3. Verify user ID matches
4. Check code hasn't expired (1 hour)

### Channel messages ignored

1. Verify channel ID in `allowedChannels`
2. Check `requireMention: true` (must @mention bot)
3. Verify group policy is not `disabled`

## API Reference

### Webhook Payload Format

```json
{
  "event_type": "NEW_MESSAGE",
  "message": {
    "message_id": "msg_123",
    "text": "Hello bot!",
    "user_id": "U123456",
    "user_name": "Alice",
    "channel_id": "C123456",
    "channel_name": "general",
    "channel_type": "channel",
    "timestamp": 1234567890000,
    "workspace_id": "W123456"
  }
}
```

### Response Format

Success:
```json
{
  "ok": true,
  "message": "Message processed"
}
```

Error:
```json
{
  "ok": false,
  "error": "User not approved"
}
```

## Development

### Testing Locally

1. Use ngrok for webhook tunnel: `ngrok http 8080`
2. Update Pumble addon webhook URL to ngrok URL
3. Run Railway app locally: `npm start`
4. Send test message in Pumble
5. Check logs for webhook receipt

### Adding Features

1. **New event types**: Update `webhook-handler.js` switch statement
2. **Custom formatters**: Modify `formatter.js`
3. **Enhanced security**: Update `pairing.js` or access control logic

## Contributing

Please follow these guidelines:

1. **Security first**: Never log sensitive data unredacted
2. **Error handling**: Always catch and log errors gracefully
3. **Rate limiting**: Respect Pumble's 1 req/sec limit
4. **Testing**: Test DM pairing and channel allowlist
5. **Documentation**: Update this README for new features

## Sources & References

- [Pumble API Documentation](https://pumble.com/help/integrations/automation-workflow-integrations/api-keys-integration/)
- [Pumble Webhooks](https://pumble.com/help/integrations/add-pumble-apps/incoming-webhooks-for-pumble/)
- [Pumble Node SDK](https://github.com/CAKE-com/pumble-node-sdk)
- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [OpenClaw Channels](https://docs.openclaw.ai/channels)

## License

Same as parent project (clawdbot-railway-template).
