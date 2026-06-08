import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { successEmbed } from '../utils/embeds.js';
import { activeSlots } from '../commands/Moderation/announcementslot.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 20;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    try {
      if (message.author.bot || !message.guild) return;

      // 1. Live check and update announcement slot rules
      await handleAnnouncementSlot(message, client);

      // 2. Core leveling framework logic
      await handleLeveling(message, client);
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  }
};

async function handleAnnouncementSlot(message, client) {
  const mapKey = `${message.guild.id}-${message.channel.id}-${message.author.id}`;
  
  try {
    // Check our central fast memory store directly
    if (!activeSlots || !activeSlots.has(mapKey)) return;
    const slotData = activeSlots.get(mapKey);

    // Dynamic fallback checks
    if (Date.now() > slotData.expiresAt) {
      clearTimeout(slotData.timeoutId);
      activeSlots.delete(mapKey);
      await message.channel.permissionOverwrites.delete(message.author.id, 'Fallback timer sweep.').catch(() => null);
      return;
    }

    slotData.currentCount += 1;

    if (slotData.currentCount >= slotData.maxMessages) {
      // Limit hit! Erase the timer tracker and wipe permissions instantly
      clearTimeout(slotData.timeoutId);
      activeSlots.delete(mapKey);

      await message.channel.permissionOverwrites.delete(message.author.id, 'Slot channel text limits completed.').catch(() => null);

      const finalEmbed = successEmbed(
        `👤 **User:** <@${slotData.userId}>\n` +
        `📺 **Channel:** <#${slotData.channelId}>\n` +
        `💬 **Limit:** ${slotData.maxMessages} message${slotData.maxMessages !== 1 ? 's' : ''}\n` +
        `⏳ **Time Limit:** Out of execution window\n` +
        `🔑 **Permissions:** \`${slotData.permType}\`\n\n` +
        `**Status:** 🔴 Closed | Reason: Slot message limit reached`,
        'Slot Closed 🔒'
      ).setColor('#DD2E44');

      // Edit the original interaction message directly in place 
      if (slotData.replyMessage) {
        await slotData.replyMessage.edit({ embeds: [finalEmbed], components: [] }).catch(() => null);
      }
      
      logger.info(`Slot successfully completed and closed for user ${message.author.id}.`);
    } else {
      // Save data increment state back into our map
      activeSlots.set(mapKey, slotData);
    }
  } catch (error) {
    logger.error('Error checking active announcement slot updates:', error);
  }
}

async function handleLeveling(message, client) {
  try {
    const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;
    const canProcess = await checkRateLimit(rateLimitKey, MESSAGE_XP_RATE_LIMIT_ATTEMPTS, MESSAGE_XP_RATE_LIMIT_WINDOW_MS);
    if (!canProcess) return;

    const levelingConfig = await getLevelingConfig(client, message.guild.id);
    if (!levelingConfig?.enabled) return;

    if (levelingConfig.ignoredChannels?.includes(message.channel.id)) return;

    if (levelingConfig.ignoredRoles?.length > 0) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member && member.roles.cache.some(role => levelingConfig.ignoredRoles.includes(role.id))) {
        return;
      }
    }

    if (levelingConfig.blacklistedUsers?.includes(message.author.id)) return;
    if (!message.content || message.content.trim().length === 0) return;

    const userData = await getUserLevelData(client, message.guild.id, message.author.id);
    const cooldownTime = levelingConfig.xpCooldown !== undefined ? levelingConfig.xpCooldown : 0;
    const now = Date.now();
    const timeSinceLastMessage = now - (userData.lastMessage || 0);
    
    if (timeSinceLastMessage < cooldownTime * 1000) {
      return;
    }

    const finalXP = 1;
    const result = await addXp(client, message.guild, message.member, finalXP);
    
    if (result.success && result.leveledUp) {
      logger.info(`${message.author.tag} progressed to message milestone level ${result.level}`);
    }
  } catch (error) {
    logger.error('Error handling leveling for message:', error);
  }
}
