import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

// Global rapid-spam safety gate to protect your bot from crashing under API flood pressure
const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 20;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    try {
      // Skip bots and non-guild messages completely
      if (message.author.bot || !message.guild) return;

      // 1. Process the Announcement Slot Counter logic
      await handleAnnouncementSlot(message, client);

      // 2. Process your existing leveling system logic
      await handleLeveling(message, client);
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  }
};

async function handleAnnouncementSlot(message, client) {
  const dbKey = `announcement-slot:${message.guild.id}:${message.channel.id}:${message.author.id}`;
  
  try {
    // Check ledger database for an active temporary slot configuration
    const slotData = await client.db.get(dbKey);
    if (!slotData) return; // User does not have a dynamic override set here, skip

    // Safety expiration check (in case the timer didn't catch it during downtime)
    if (Date.now() > slotData.expiresAt) {
      await message.channel.permissionOverwrites.delete(message.author.id, 'Slot cleanup fallback expired.').catch(() => null);
      await client.db.delete(dbKey);
      return;
    }

    // Increment processed usage count
    slotData.currentCount += 1;

    if (slotData.currentCount >= slotData.maxMessages) {
      // Limit hit! Instantly revoke overrides immediately
      await message.channel.permissionOverwrites.delete(message.author.id, 'Announcement slot limit reached. Permissions revoked.').catch(() => null);
      await client.db.delete(dbKey);
      logger.info(`User ${message.author.id} reached message limit (${slotData.maxMessages}) in channel ${message.channel.id}. Revoked permissions.`);
      
      // Send a temporary clean confirmation notice
      await message.reply({ content: '🔒 **Slot limit reached.** Your temporary posting privileges have been securely closed.' }).then(msg => {
        setTimeout(() => msg.delete().catch(() => null), 60000);
      }).catch(() => null);
    } else {
      // Update data counter in the database
      await client.db.set(dbKey, slotData);
      logger.info(`User ${message.author.id} posted message ${slotData.currentCount}/${slotData.maxMessages} in announcement slot.`);
    }
  } catch (error) {
    logger.error('Error handling announcement slot verification tracking:', error);
  }
}

async function handleLeveling(message, client) {
  try {
    // Basic structural rate limiter to protect database operations
    const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;
    const canProcess = await checkRateLimit(rateLimitKey, MESSAGE_XP_RATE_LIMIT_ATTEMPTS, MESSAGE_XP_RATE_LIMIT_WINDOW_MS);
    if (!canProcess) return;

    const levelingConfig = await getLevelingConfig(client, message.guild.id);
    if (!levelingConfig?.enabled) return;

    // Filter out restricted environments
    if (levelingConfig.ignoredChannels?.includes(message.channel.id)) return;

    // Filter out restricted administrative roles
    if (levelingConfig.ignoredRoles?.length > 0) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member && member.roles.cache.some(role => levelingConfig.ignoredRoles.includes(role.id))) {
        return;
      }
    }

    // Filter out banned actors
    if (levelingConfig.blacklistedUsers?.includes(message.author.id)) return;

    // Avoid empty content triggers (like embed-only systems, images, attachments)
    if (!message.content || message.content.trim().length === 0) return;

    const userData = await getUserLevelData(client, message.guild.id, message.author.id);
    
    // FIX 1: Safely accept '0' as a valid configuration value without falling back to 60 seconds
    const cooldownTime = levelingConfig.xpCooldown !== undefined ? levelingConfig.xpCooldown : 0;
    const now = Date.now();
    const timeSinceLastMessage = now - (userData.lastMessage || 0);
    
    if (timeSinceLastMessage < cooldownTime * 1000) {
      return;
    }

    // FIX 2: Strict 1:1 payout alignment. 
    // Every single valid message processes exactly 1 XP block (= 1 Level)
    const finalXP = 1;

    const result = await addXp(client, message.guild, message.member, finalXP);
    
    if (result.success && result.leveledUp) {
      logger.info(
        `${message.author.tag} progressed to message milestone level ${result.level} in ${message.guild.name}`
      );
    }
  } catch (error) {
    logger.error('Error handling leveling for message:', error);
  }
}
