import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { setBirthday } from '../../../services/birthdayService.js';
import { logger } from '../../../utils/logger.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';

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

            const result = await setBirthday(client, interaction.guildId, targetUser.id, month, day, timezone);
            
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    `<@${targetUser.id}>'s birthday has been updated to **${result.data.monthName} ${result.data.day}** (${timezone})!`,
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
