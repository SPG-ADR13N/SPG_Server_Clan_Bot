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
      if (message.author.bot || !message.guild) return;

      await handleLeveling(message, client);
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  }
};

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
