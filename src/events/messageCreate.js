import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { successEmbed } from '../utils/embeds.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 20;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (message.author.bot || !message.guild) return;

      // 1. Process active slot configurations
      await handleAnnouncementSlot(message);

      // 2. Process leveling tracking milestones
      await handleLeveling(message);
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  }
};

async function handleAnnouncementSlot(message) {
  // Pull memory slots map directly using native message context properties
  const globalSlots = message.client.announcementSlots;
  if (!globalSlots) return;

  const mapKey = `${message.guild.id}-${message.channel.id}-${message.author.id}`;
  
  try {
    if (!globalSlots.has(mapKey)) return;
    const slotData = globalSlots.get(mapKey);

    if (Date.now() > slotData.expiresAt) {
      clearTimeout(slotData.timeoutId);
      globalSlots.delete(mapKey);
      await message.channel.permissionOverwrites.delete(message.author.id, 'Sweep expiration override.').catch(() => null);
      return;
    }

    slotData.currentCount += 1;

    if (slotData.currentCount >= slotData.maxMessages) {
      clearTimeout(slotData.timeoutId);
      globalSlots.delete(mapKey);

      await message.channel.permissionOverwrites.delete(message.author.id, 'Slot target message volume reached.').catch(() => null);

      const finalEmbed = successEmbed(
        `👤 **User:** <@${slotData.userId}>\n` +
        `📺 **Channel:** <#${slotData.channelId}>\n` +
        `💬 **Limit:** ${slotData.maxMessages} message${slotData.maxMessages !== 1 ? 's' : ''}\n` +
        `⏳ **Time Limit:** Out of execution window\n` +
        `🔑 **Permissions:** \`${slotData.permType}\`\n\n` +
        `**Status:** 🔴 Closed | Reason: Slot message limit reached`,
        'Slot Closed 🔒'
      );
      
      if (finalEmbed.setColor) finalEmbed.setColor('#DD2E44');
      else finalEmbed.color = 14495300;

      if (slotData.interactionMessageId) {
        const commandChannel = await message.client.channels.fetch(slotData.commandChannelId).catch(() => null);
        if (commandChannel) {
          const targetInteractionMessage = await commandChannel.messages.fetch(slotData.interactionMessageId).catch(() => null);
          if (targetInteractionMessage) {
            await targetInteractionMessage.edit({ embeds: [finalEmbed], components: [] }).catch(() => null);
          }
        }
      }
      
      logger.info(`Slot successfully fulfilled for user ${message.author.id}. Status tracker updated to closed.`);
    } else {
      globalSlots.set(mapKey, slotData);
    }
  } catch (error) {
    logger.error('Error executing automated message tracking update state sequence:', error);
  }
}

// ─── TEMPORARY WIPE CODE ─────────────────────────────────────────────────────
try {
    const cfg = await getLevelingConfig(message.client, '1362454274499547187');
    if (cfg && cfg.ignoredChannels?.length > 0) {
        cfg.ignoredChannels = []; 
        await saveLevelingConfig(message.client, '1362454274499547187', cfg);
        logger.info("=== SUCCESS: Dashboard channel list has been completely reset to empty! ===");
    }
} catch (err) {
    logger.error("Failed to run temporary reset script:", err);
}
// ─────────────────────────────────────────────────────────────────────────────

async function handleLeveling(message) {
  try {
    const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;
    const canProcess = await checkRateLimit(rateLimitKey, MESSAGE_XP_RATE_LIMIT_ATTEMPTS, MESSAGE_XP_RATE_LIMIT_WINDOW_MS);
    if (!canProcess) return;

    const levelingConfig = await getLevelingConfig(message.client, message.guild.id);
    if (!levelingConfig?.enabled) return;

    if (levelingConfig.ignoredChannels?.length > 0 && !levelingConfig.ignoredChannels.includes(message.channel.id)) return;

    if (levelingConfig.ignoredRoles?.length > 0) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member && member.roles.cache.some(role => levelingConfig.ignoredRoles.includes(role.id))) {
        return;
      }
    }

    if (levelingConfig.blacklistedUsers?.includes(message.author.id)) return;
    if (!message.content || message.content.trim().length === 0) return;

    const userData = await getUserLevelData(message.client, message.guild.id, message.author.id);
    const cooldownTime = levelingConfig.xpCooldown !== undefined ? levelingConfig.xpCooldown : 0;
    const now = Date.now();
    const timeSinceLastMessage = now - (userData.lastMessage || 0);
    
    if (timeSinceLastMessage < cooldownTime * 1000) {
      return;
    }

    const finalXP = 1;
    const result = await addXp(message.client, message.guild, message.member, finalXP);
    
    if (result.success && result.leveledUp) {
      logger.info(`${message.author.tag} progressed to message milestone level ${result.level}`);
    }
  } catch (error) {
    logger.error('Error handling leveling for message:', error);
  }
}
