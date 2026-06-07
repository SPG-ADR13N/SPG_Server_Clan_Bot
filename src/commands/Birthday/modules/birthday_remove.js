import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { deleteBirthday } from '../../../services/birthdayService.js';
import { logger } from '../../../utils/logger.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';

export default {
    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
            const allowMembersToRemove = config?.allowMembersToSetBirthdays ?? false;

            if (!isAdmin && !allowMembersToRemove) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Permission Denied', 'Only administrators are allowed to modify birthday settings.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Pick targeted user, fall back to author if none provided
            const targetUser = interaction.options.getUser("user") || interaction.user;

            if (targetUser.id !== interaction.user.id && !isAdmin) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Permission Denied', 'You do not have permission to delete this member\'s birthday.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            await deleteBirthday(client, interaction.guildId, targetUser.id);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    `Successfully deleted birthday tracking profiles associated with <@${targetUser.id}>.`,
                    "Birthday Removed ❌"
                )]
            });
        } catch (error) {
            logger.error("Birthday remove command execution failed", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'birthday_remove'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'birthday_remove',
                source: 'birthday_remove_module'
            });
        }
    }
};
