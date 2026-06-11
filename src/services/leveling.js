import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig, setGuildConfig } from '../services/guildConfig.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';

const BASE_XP = 1;
const MAX_LEVEL = 100000; // Increased to support your high 10,000+ message tiers safely
const MIN_LEVEL = 0;

/**
 * Calculates XP required to advance *one more level* from the target level.
 * New System: Every single level transition costs exactly 1 XP.
 */
export function getXpForLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    throw new TitanBotError(
      `Invalid level: ${level}. Must be between ${MIN_LEVEL} and ${MAX_LEVEL}`,
      ErrorTypes.VALIDATION,
      'The level must be a valid number.'
    );
  }
  return 1; 
}

/**
 * Derives current structural stats from raw absolute XP
 * New System: 1 XP = 1 Level. Progress to the next milestone is consistently 1 XP.
 */
export function getLevelFromXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new TitanBotError(
      `Invalid XP: ${xp}`,
      ErrorTypes.VALIDATION,
      'XP must be a non-negative number.'
    );
  }

  const targetLevel = Math.min(xp, MAX_LEVEL);

  return {
    level: targetLevel,
    currentXp: 0, // In a true 1:1 setup, fractional XP between levels does not exist
    xpNeeded: 1
  };
}

/**
 * Calculate the total absolute XP required for a specific level and current XP
 * New System: Total cumulative XP is simply equivalent to the target level itself.
 */
export function calculateTotalXp(level, currentXp = 0) {
  return Math.max(0, level) + Math.max(0, currentXp);
}

/**
 * Automatically evaluates and assigns or updates milestone-based activity roles 
 * configured within your live Discord dashboard settings.
 */
export async function checkAndAwardActivityRoles(client, guildId, userId, currentLevel) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    // Fetch the live leveling configuration set by your Bot UI dashboard
    const levelingConfig = await getLevelingConfig(client, guildId);
    const roleRewards = levelingConfig.roleRewards || {}; // Structure expected: { "500": "ROLE_ID", "2000": "ROLE_ID" }

    let roleToAssignId = null;

    // Parse out any level numbers saved in the dashboard configuration
    const milestones = Object.keys(roleRewards).map(Number).sort((a, b) => a - b);
    
    for (const milestone of milestones) {
      if (currentLevel >= milestone) {
        roleToAssignId = roleRewards[milestone];
      }
    }

    if (roleToAssignId) {
      const targetRole = guild.roles.cache.get(roleToAssignId);
      if (targetRole && !member.roles.cache.has(roleToAssignId)) {
        await member.roles.add(targetRole);
        logger.info(`[ROLES] Successfully awarded milestone role "${targetRole.name}" to user ${member.user.tag} for level ${currentLevel}`);
      }
    }
  } catch (error) {
    logger.error(`[ROLES ERROR] Failed parsing live UI milestones for user ${userId} in guild ${guildId}:`, error);
  }
}

export async function getLeaderboard(client, guildId, limit = 10) {
  try {
    if (!guildId || typeof guildId !== 'string') {
      throw new TitanBotError(
        'Invalid guild ID',
        ErrorTypes.VALIDATION,
        'Guild ID is required.'
      );
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      limit = Math.min(Math.max(limit, 1), 100);
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Guild ${guildId} not found in cache`);
      return [];
    }
    
    const members = await guild.members.fetch().catch(error => {
      logger.error(`Failed to fetch members for guild ${guildId}:`, error);
      return new Map();
    });

    const leaderboard = [];
    
    for (const [userId, member] of members) {
      if (member.user.bot) continue;
      
      const data = await getUserLevelData(client, guildId, userId);
      if (data && (data.totalXp > 0 || data.level > 0)) {
        leaderboard.push({
          userId,
          username: member.user.username,
          discriminator: member.user.discriminator,
          ...data
        });
      }
    }
    
    leaderboard.sort((a, b) => b.totalXp - a.totalXp);
    
    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });
    
    return leaderboard.slice(0, limit);
    
  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to fetch leaderboard: ${error.message}`,
      ErrorTypes.DATABASE,
      'Could not fetch the leaderboard at this time.'
    );
  }
}

export function createLeaderboardEmbed(leaderboard, guild) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${guild.name} Leaderboard`)
    .setColor('#2ecc71')
    .setTimestamp();
    
  if (!leaderboard || leaderboard.length === 0) {
    embed.setDescription('No users on the leaderboard yet!');
    return embed;
  }
  
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  
  const top3Text = top3.map((user, index) => {
    const medal = ['🥇', '🥈', '🥉'][index];
    return `${medal} **#${user.rank}** ${user.username} - Level ${user.level} (${user.totalXp} Messages)`;
  }).join('\n');
  
  const restText = rest.map(user => {
    return `**#${user.rank}** ${user.username} - Level ${user.level} (${user.totalXp} Messages)`;
  }).join('\n');
  
  embed.setDescription(
    `**Top Members**\n${top3Text}${restText ? '\n\n' + restText : ''}`
  );
  
  return embed;
}

export async function getLevelingConfig(client, guildId) {
  try {
    const guildConfig = await getGuildConfig(client, guildId);
    return guildConfig.leveling || {
      enabled: true,
      xpPerMessage: { min: 1, max: 1 },
      xpCooldown: 0,
      levelUpMessage: '{user} has reached a message count of {level}!',
      levelUpChannel: null,
      ignoredChannels: [],
      ignoredRoles: [],
      blacklistedUsers: [],
      roleRewards: {},
      announceLevelUp: true,
      xpMultiplier: 1
    };
  } catch (error) {
    logger.error(`Error getting leveling config for guild ${guildId}:`, error);
    return {
      enabled: true,
      xpPerMessage: { min: 1, max: 1 },
      xpCooldown: 0,
      levelUpMessage: '{user} has reached a message count of {level}!',
      levelUpChannel: null,
      ignoredChannels: [],
      ignoredRoles: [],
      blacklistedUsers: [],
      roleRewards: {},
      announceLevelUp: true,
      xpMultiplier: 1
    };
  }
}

export async function getUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Guild ID and User ID are required',
        ErrorTypes.VALIDATION
      );
    }

    const key = `${guildId}:leveling:users:${userId}`;
    const data = await client.db.get(key);
    
    if (!data) {
      return {
        xp: 0,
        level: 0,
        totalXp: 0,
        lastMessage: 0,
        rank: 0
      };
    }
    
    return {
      xp: Math.max(0, data.xp || 0),
      level: Math.max(0, Math.min(data.level || 0, MAX_LEVEL)),
      totalXp: Math.max(0, data.totalXp || 0),
      lastMessage: data.lastMessage || 0,
      rank: data.rank || 0
    };
  } catch (error) {
    logger.error(`Error getting user level data for ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to fetch user data: ${error.message}`,
      ErrorTypes.DATABASE,
      'Could not fetch level data at this time.'
    );
  }
}

export async function saveUserLevelData(client, guildId, userId, data) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Guild ID and User ID are required',
        ErrorTypes.VALIDATION
      );
    }

    if (!data || typeof data !== 'object') {
      throw new TitanBotError(
        'Invalid user level data',
        ErrorTypes.VALIDATION
      );
    }

    const sanitizedData = {
      xp: Math.max(0, Number(data.xp) || 0),
      level: Math.max(0, Math.min(Number(data.level) || 0, MAX_LEVEL)),
      totalXp: Math.max(0, Number(data.totalXp) || 0),
      lastMessage: Number(data.lastMessage) || 0,
      rank: Number(data.rank) || 0
    };

    const key = `${guildId}:leveling:users:${userId}`;
    await client.db.set(key, sanitizedData);

    // Evaluates role rewards immediately using whatever data currently exists in your dashboard settings
    await checkAndAwardActivityRoles(client, guildId, userId, sanitizedData.level);
  } catch (error) {
    logger.error(`Error saving user level data for ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to save user data: ${error.message}`,
      ErrorTypes.DATABASE,
      'Could not save level data at this time.'
    );
  }
}

export async function saveLevelingConfig(client, guildId, config) {
  try {
    if (!guildId || !config) {
      throw new TitanBotError(
        'Guild ID and config are required',
        ErrorTypes.VALIDATION
      );
    }

    const guildConfig = await getGuildConfig(client, guildId);
    
    if (config.xpCooldown && (config.xpCooldown < 0 || config.xpCooldown > 3600)) {
      throw new TitanBotError(
        'XP cooldown must be between 0 and 3600 seconds',
        ErrorTypes.VALIDATION,
        'Cooldown must be between 0 and 3600 seconds.'
      );
    }

    // Fixes the dashboard interaction crash by handling both old and new data structures safely
    const range = config.xpPerMessage || config.xpRange;
    if (range) {
      const min = range.min !== undefined ? range.min : 1;
      const max = range.max !== undefined ? range.max : 1;
      
      if (min < 1 || max < 1 || min > max) {
        throw new TitanBotError(
          'Invalid XP range configuration',
          ErrorTypes.VALIDATION,
          'Minimum XP must
