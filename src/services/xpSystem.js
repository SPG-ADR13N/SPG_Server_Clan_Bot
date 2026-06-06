import { logger } from '../utils/logger.js';
import { getLevelingConfig, getXpForLevel, getUserLevelData, saveUserLevelData } from './leveling.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { Mutex } from '../utils/mutex.js';

export async function addXp(client, guild, member, xpToAdd) {
  const lockKey = `leveling:${guild.id}:${member.user.id}`;
  return await Mutex.runExclusive(lockKey, async () => {
    try {
      if (!xpToAdd || xpToAdd <= 0) {
        return { success: false, reason: 'Invalid XP amount' };
      }

      const config = await getLevelingConfig(client, guild.id);
      
      if (!config.enabled) {
        return { success: false, reason: 'Leveling is disabled in this server' };
      }
      
      const levelData = await getUserLevelData(client, guild.id, member.user.id);
      const initialLevel = levelData.level;
      
      // Strict 1:1 Conversion: Add 1 message to both the XP tracker and the level indicator
      levelData.xp += xpToAdd;
      levelData.totalXp += xpToAdd;
      levelData.level = levelData.totalXp; // Level ALWAYS equals absolute total messages sent
      levelData.lastMessage = Date.now();
      
      const didLevelUp = levelData.level > initialLevel;

      if (didLevelUp) {
        logger.info(`🎉 ${member.user.tag} reached level ${levelData.level} (Total Messages: ${levelData.totalXp}) in ${guild.name}`);

        // Check if there's a dynamic dashboard role configured for this specific milestone level
        if (config.roleRewards && config.roleRewards[levelData.level]) {
          await awardRoleReward(guild, member, config.roleRewards[levelData.level], levelData.level);
        }

        // Send the level-up alert if configured
        if (config.announceLevelUp) {
          await sendLevelUpAnnouncement(guild, member, levelData, config);
        }

        // Push standard analytical track payload to logging service
        try {
          await logEvent({
            client,
            guildId: guild.id,
            eventType: EVENT_TYPES.LEVELING_LEVELUP,
            data: {
              description: `${member.user.tag} reached level ${levelData.level}`,
              userId: member.user.id,
              fields: [
                {
                  name: '👤 Member',
                  value: `${member.user.tag} (${member.user.id})`,
                  inline: true
                },
                {
                  name: '📊 New Level',
                  value: levelData.level.toString(),
                  inline: true
                },
                {
                  name: '📈 Levels Gained',
                  value: (levelData.level - initialLevel).toString(),
                  inline: true
                },
                {
                  name: '✨ Total Messages',
                  value: levelData.totalXp.toString(),
                  inline: true
                }
              ]
            }
          });
        } catch (logError) {
          logger.debug('Failed to log leveling event:', logError.message);
        }
      }
      
      // This saves to the DB and triggers checkAndAwardActivityRoles() from leveling.js automatically
      await saveUserLevelData(client, guild.id, member.user.id, levelData);
      
      return {
        success: true,
        level: levelData.level,
        xp: levelData.xp,
        totalXp: levelData.totalXp,
        xpNeeded: 1, // Next level always requires exactly 1 message
        leveledUp: didLevelUp
      };
      
    } catch (error) {
      logger.error('Error adding XP:', error);
      return { success: false, error: error.message };
    }
  });
}

async function awardRoleReward(guild, member, roleId, level) {
  try {
    const role = guild.roles.cache.get(roleId);
    
    if (!role) {
      logger.warn(`Role ${roleId} not found for level ${level} reward in guild ${guild.id}`);
      return;
    }

    if (member.roles.cache.has(roleId)) {
      return;
    }

    await member.roles.add(role, `Level ${level} reward`);
    logger.info(`✅ Awarded role ${role.name} to ${member.user.tag} for reaching level ${level}`);
  } catch (error) {
    logger.error(`Failed to award role reward to ${member.user.id}:`, error);
  }
}

async function sendLevelUpAnnouncement(guild, member, levelData, config) {
  try {
    const levelUpChannel = config.levelUpChannel 
      ? guild.channels.cache.get(config.levelUpChannel) 
      : guild.systemChannel;
    
    if (!levelUpChannel || !levelUpChannel.isTextBased()) {
      return;
    }

    const permissions = levelUpChannel.permissionsFor(guild.members.me);
    if (!permissions || !permissions.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn(`Missing permissions to send levelup message in ${levelUpChannel.id}`);
      return;
    }

    const message = config.levelUpMessage
      .replace(/{user}/g, member.toString())
      .replace(/{level}/g, levelData.level)
      .replace(/{xp}/g, levelData.totalXp)
      .replace(/{xpNeeded}/g, '1');
    
    await levelUpChannel.send(message).catch(error => {
      logger.error(`Failed to send level up message in channel ${levelUpChannel.id}:`, error);
    });
  } catch (error) {
    logger.error('Error sending level up announcement:', error);
  }
}
