import { successEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';

export default {
    name: 'closeslot',
    async execute(interaction, config, client) {
        try {
            // Unpack custom ID payload variables passed down from standard routing
            const [, guildId, targetChannelId, targetUserId] = interaction.customId.split(':');
            const mapKey = `${guildId}-${targetChannelId}-${targetUserId}`;

            if (!client.announcementSlots || !client.announcementSlots.has(mapKey)) {
                return await interaction.reply({
                    content: '❌ This slot configuration is no longer active or tracked.',
                    ephemeral: true
                });
            }

            const slotData = client.announcementSlots.get(mapKey);

            // Access validation check
            if (interaction.user.id !== slotData.staffId) {
                return await interaction.reply({
                    content: '❌ Only the staff member who opened this slot can close it.',
                    ephemeral: true
                });
            }

            // Instantly acknowledge the interaction to completely prevent "This interaction failed" errors
            await interaction.deferUpdate().catch(() => null);

            clearTimeout(slotData.timeoutId);
            client.announcementSlots.delete(mapKey);

            const channel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
            if (channel) {
                await channel.permissionOverwrites.delete(targetUserId, 'Emergency closed by staff.').catch(() => null);
            }

            const closedEmbed = successEmbed(
                `👤 **User:** <@${slotData.userId}>\n` +
                `📺 **Channel:** <#${slotData.channelId}>\n` +
                `💬 **Limit:** ${slotData.maxMessages} message${slotData.maxMessages !== 1 ? 's' : ''}\n` +
                `⏳ **Time Limit:** ${slotData.durationMinutes} minutes\n` +
                `🔑 **Permissions:** \`${slotData.permType}\`\n\n` +
                `**Status:** 🔴 Closed | Reason: Manually aborted by staff`,
                'Slot Closed 🔒'
            ).setColor('#DD2E44');

            // Force live update straight over API channels
            const cmdChannel = await client.channels.fetch(slotData.commandChannelId).catch(() => null);
            if (cmdChannel) {
                const targetMsg = await cmdChannel.messages.fetch(slotData.interactionMessageId).catch(() => null);
                if (targetMsg) {
                    await targetMsg.edit({ embeds: [closedEmbed], components: [] }).catch(() => null);
                }
            }

        } catch (error) {
            logger.error('Error executing native button handler:', error);
        }
    }
};
