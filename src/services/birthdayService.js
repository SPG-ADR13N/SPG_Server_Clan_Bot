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

export async function getTodaysBirthdays(client, guildId) {
  try {
    const birthdays = await getGuildBirthdays(client, guildId);
    const today = new Date();
    const currentMonth = today.getUTCMonth() + 1;
    const currentDay = today.getUTCDate();
    const todaysBirthdays = [];

    for (const [userId, userData] of Object.entries(birthdays)) {
      if (userData.month === currentMonth && userData.day === currentDay) {
        todaysBirthdays.push({
          userId,
          month: userData.month,
          day: userData.day,
          timezone: userData.timezone || 'UTC'
        });
      }
    }
    return todaysBirthdays;
  } catch (error) {
    throw error;
  }
}

// THE AUTOMATED TIME CLOCK LOOP (Runs daily at midnight UTC)
export async function checkBirthdays(client) {
  const today = new Date();
  const currentMonth = today.getUTCMonth() + 1;
  const currentDay = today.getUTCDate();

  logger.info(`🎂 Running daily birthday role manager check for UTC: ${currentMonth}/${currentDay}.`);

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      // 1. RECOVERY/EXPIRATION PHASE: Grab the tracking record from yesterday
      const trackingKey = `bday-role-tracking-${guildId}`;
      const trackingData = (await client.db.get(trackingKey)) || {};
      const updatedTrackingData = { ...trackingData };
      
      // Strip the role from anyone who had a birthday yesterday
      for (const userId of Object.keys(trackingData)) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member && member.roles.cache.has(BIRTHDAY_ROLE_ID)) {
            await member.roles.remove(BIRTHDAY_ROLE_ID, "Birthday role duration expired (24h completed)");
            logger.info(`Removed birthday role from expired user ${userId}`);
          }
          delete updatedTrackingData[userId];
        } catch (error) {
           logger.error(`Error removing expired birthday role from ${userId}:`, error);
        }
      }

      // 2. ASSIGNMENT PHASE: Find everyone who has a birthday right now
      const birthdaysKey = `birthdays:${guildId}`;
      const birthdays = (await client.db.get(birthdaysKey)) || {};

      for (const [userId, userData] of Object.entries(birthdays)) {
        if (userData.month === currentMonth && userData.day === currentDay) {
          const member = await guild.members.fetch(userId).catch(() => null);
          
          if (member) {
            try {
              // Give them the role
              await member.roles.add(BIRTHDAY_ROLE_ID, "Happy Birthday! Role assigned for 24 hours.");
              // Add them to tracking so they get stripped exactly 24 hours from now
              updatedTrackingData[userId] = true;
              logger.info(`Successfully added birthday role to ${member.user.tag}`);
            } catch (error) {
              logger.error(`Failed to assign birthday role to ${member.user.tag}:`, error);
            }
          }
        }
      }

      // Save the updated tracking ledger back to the database
      await client.db.set(trackingKey, updatedTrackingData);

    } catch (error) {
      logger.error(`Error managing birthday roles for guild ${guildId}:`, error);
    }
  }
}
