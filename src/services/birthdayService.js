import { getGuildConfig } from './guildConfig.js';
import { getGuildBirthdays, setBirthday as dbSetBirthday, deleteBirthday as dbDeleteBirthday, getMonthName } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';

// Hardcoded Birthday Role ID requested by the administrator
const BIRTHDAY_ROLE_ID = '1406324485979766814';

export function validateBirthday(month, day) {
  if (typeof month !== 'number' || typeof day !== 'number') {
    return { isValid: false, error: 'Month and day must be numbers' };
  }
  if (month < 1 || month > 12) {
    return { isValid: false, error: 'Month must be between 1 and 12' };
  }
  if (day < 1 || day > 31) {
    return { isValid: false, error: 'Day must be between 1 and 31' };
  }

  const currentYear = new Date().getFullYear();
  const date = new Date(currentYear, month - 1, day);
  
  if (isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return {
      isValid: false,
      error: 'Invalid date. Please check the month and day combination.'
    };
  }
  return { isValid: true };
}

export async function setBirthday(client, guildId, userId, month, day, timezone = 'UTC') {
  try {
    const validation = validateBirthday(month, day);
    if (!validation.isValid) {
      throw new TitanBotError(validation.error, ErrorTypes.VALIDATION, validation.error, { month, day, userId, guildId });
    }

    const success = await dbSetBirthday(client, guildId, userId, month, day, timezone);
    if (!success) {
      throw new TitanBotError('Failed to save birthday to database', ErrorTypes.DATABASE, 'Failed to set birthday.', { userId, guildId, month, day, timezone });
    }

    return { success: true, data: { month, day, timezone, monthName: getMonthName(month) } };
  } catch (error) {
    logger.error('Error in setBirthday service', { error: error.message, userId, guildId });
    throw error;
  }
}

export async function getUserBirthday(client, guildId, userId) {
  try {
    const birthdays = await getGuildBirthdays(client, guildId);
    const birthdayData = birthdays[userId];
    if (!birthdayData) return null;

    return {
      month: birthdayData.month,
      day: birthdayData.day,
      timezone: birthdayData.timezone || 'UTC',
      monthName: getMonthName(birthdayData.month)
    };
  } catch (error) {
    throw error;
  }
}

export async function getAllBirthdays(client, guildId) {
  try {
    const birthdays = await getGuildBirthdays(client, guildId);
    if (!birthdays || Object.keys(birthdays).length === 0) return [];

    return Object.entries(birthdays)
      .map(([userId, data]) => ({
        userId,
        month: data.month,
        day: data.day,
        timezone: data.timezone || 'UTC',
        monthName: getMonthName(data.month)
      }))
      .sort((a, b) => (a.month !== b.month ? a.month - b.month : a.day - b.day));
  } catch (error) {
    throw error;
  }
}

export async function deleteBirthday(client, guildId, userId) {
  try {
    const birthday = await getUserBirthday(client, guildId, userId);
    if (!birthday) return { success: false, notFound: true, message: 'No birthday found' };

    const success = await dbDeleteBirthday(client, guildId, userId);
    if (!success) throw new TitanBotError('Failed to delete birthday', ErrorTypes.DATABASE, 'Failed to remove birthday.', { userId, guildId });

    return { success: true, message: 'Birthday removed successfully' };
  } catch (error) {
    throw error;
  }
}

export async function getUpcomingBirthdays(client, guildId, limit = 5) {
  try {
    const birthdays = await getGuildBirthdays(client, guildId);
    if (!birthdays || Object.keys(birthdays).length === 0) return [];

    const today = new Date();
    const currentYear = today.getFullYear();
    const upcomingBirthdays = [];
    
    for (const [userId, userData] of Object.entries(birthdays)) {
      let nextBirthday = new Date(currentYear, userData.month - 1, userData.day);
      if (nextBirthday < today) {
        nextBirthday = new Date(currentYear + 1, userData.month - 1, userData.day);
      }
      const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
      upcomingBirthdays.push({
        userId,
        month: userData.month,
        day: userData.day,
        timezone: userData.timezone || 'UTC',
        monthName: getMonthName(userData.month),
        date: nextBirthday,
        daysUntil
      });
    }

    upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil);
    return upcomingBirthdays.slice(0, limit);
  } catch (error) {
    throw error;
  }
}

// AUTOMATED CRON SCHEDULER ENGINE (Run this inside your ready.js setInterval loop every 30 mins)
export async function checkBirthdays(client) {
  const now = new Date();
  logger.info(`🎂 Running timezone-aware birthday check loop.`);

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const trackingKey = `bday-role-tracking-${guildId}`;
      const trackingData = (await client.db.get(trackingKey)) || {};
      const updatedTrackingData = { ...trackingData };

      const birthdaysKey = `birthdays:${guildId}`;
      const birthdays = (await client.db.get(birthdaysKey)) || {};

      for (const [userId, userData] of Object.entries(birthdays)) {
        const userTimezone = userData.timezone || 'UTC';
        
        try {
          // Compute the current target month and day localized strictly to this specific user's zone setting
          const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: userTimezone,
              month: 'numeric',
              day: 'numeric'
          });
          const parts = formatter.formatToParts(now);
          const currentLocalMonth = parseInt(parts.find(p => p.type === 'month').value, 10);
          const currentLocalDay = parseInt(parts.find(p => p.type === 'day').value, 10);

          const isCurrentlyBirthday = (userData.month === currentLocalMonth && userData.day === currentLocalDay);

          // Phase A: Give role if local midnight hits and they don't have it tracked yet
          if (isCurrentlyBirthday && !trackingData[userId]) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
              await member.roles.add(BIRTHDAY_ROLE_ID, `Birthday started in local timezone: ${userTimezone}.`);
              updatedTrackingData[userId] = true;
              logger.info(`Assigned birthday role to ${member.user.tag} (${userTimezone})`);
            }
          }

          // Phase B: Strip role when local clock shifts off their calendar birthday date
          if (!isCurrentlyBirthday && trackingData[userId]) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
              if (member.roles.cache.has(BIRTHDAY_ROLE_ID)) {
                await member.roles.remove(BIRTHDAY_ROLE_ID, `Birthday completed for timezone: ${userTimezone}.`);
              }
              logger.info(`Removed expired birthday role from ${member.user.tag} (${userTimezone})`);
            }
            delete updatedTrackingData[userId];
          }
        } catch (zoneError) {
          logger.error(`Failed parsing dates for user ${userId} under timezone ${userTimezone}:`, zoneError);
        }
      }

      await client.db.set(trackingKey, updatedTrackingData);
    } catch (error) {
      logger.error(`Error executing scheduled birthday tasks for server guild ${guildId}:`, error);
    }
  }
}
