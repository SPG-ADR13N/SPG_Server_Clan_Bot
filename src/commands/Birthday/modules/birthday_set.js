import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { setBirthday } from '../../../services/birthdayService.js';
import { logger } from '../../../utils/logger.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';

// Hardcoded Birthday Role ID requested by the administrator
const BIRTHDAY_ROLE_ID = '1406324485979766814';

export default {
    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
            // Feature toggle variable fallback configuration (Defaults to false)
            const allowMembersToSet = config?.allowMembersToSetBirthdays ?? false;

            if (!isAdmin && !allowMembersToSet) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Permission Denied', 'Only administrators are allowed to modify birthday settings.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            const month = interaction.options.getInteger("month");
            const day = interaction.options.getInteger("day");
            const timezone = interaction.options.getString("timezone") || "UTC";
            
            // Pick targeted user, fall back to author if none provided
            const targetUser = interaction.options.getUser("user") || interaction.user;
            
            if (targetUser.id !== interaction.user.id && !isAdmin) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Permission Denied', 'You cannot change someone else\'s birthday data.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            // 1. Save data into the database
            const result = await setBirthday(client, interaction.guildId, targetUser.id, month, day, timezone);
            
            // 2. Instant Live Check: Is it their birthday right now in their selected timezone?
            let assignedInstantly = false;
            try {
                const now = new Date();
                
                // Safe, native international component extractor
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    month: 'numeric',
                    day: 'numeric'
                });
                
                const parts = formatter.formatToParts(now);
                const currentLocalMonth = parseInt(parts.find(p => p.type === 'month').value, 10);
                const currentLocalDay = parseInt(parts.find(p => p.type === 'day').value, 10);

                if (month === currentLocalMonth && day === currentLocalDay) {
                    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                    if (member) {
                        // Give them the role right now
                        await member.roles.add(BIRTHDAY_ROLE_ID, "Birthday set to today! Instant live assignment.");
                        
                        // Register them immediately into the tracking ledger so the loop sweeps it up at midnight local time
                        const trackingKey = `bday-role-tracking-${interaction.guildId}`;
                        const trackingData = (await client.db.get(trackingKey)) || {};
                        trackingData[targetUser.id] = true;
                        await client.db.set(trackingKey, trackingData);
                        
                        assignedInstantly = true;
                        logger.info(`Instantly assigned birthday role on registration for user ${targetUser.id}`);
                    }
                }
            } catch (timezoneError) {
                logger.error("Error evaluating instant birthday role assignment matching:", timezoneError);
            }

            // 3. Assemble and send the completion response message
            const notificationAppend = assignedInstantly 
                ? `\n\n🎉 **Since that is today in ${timezone}, the birthday role has been assigned instantly!**` 
                : '';

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    `<@${targetUser.id}>'s birthday has been updated to **${result.data.monthName} ${result.data.day}** (${timezone})!${notificationAppend}`,
                    "Birthday Registered! 🎂"
                )]
            });
        } catch (error) {
            logger.error("Birthday set command execution failed", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'birthday_set'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'birthday_set',
                source: 'birthday_set_module'
            });
        }
    }
};
