import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

export default {
    name: 'closeslot',
    async execute(interaction, config, client) {
        try {
            if (!client.announcementSlots) {
                return await interaction.reply({
                    content: '❌ No active announcements slots are being tracked.',
                    ephemeral: true
                });
            }

            // Look up the active slot by searching for the message ID that contains this button
            let slotData = null;
            let activeMapKey = null;

            for (const [key, value] of client.announcementSlots.entries()) {
                if (value.interactionMessageId === interaction.message.id) {
                    slotData = value;
                    activeMapKey = key;
                    break;
                }
            }

            if (!slotData) {
                return await interaction.reply({
                    content: '❌ This slot configuration is no longer active or tracked.',
                    ephemeral: true
                });
            }

            // Restrict closing privileges to the staff member who spawned the slot
            if (interaction.user.id !== slotData.staffId) {
                return await interaction.reply({
                    content: '❌ Only the staff member who opened this slot can close it.',
                    ephemeral: true
                });
            }

            // Acknowledge immediately to fulfill the framework lifecycle
            await interaction.deferUpdate().catch(() => null);

            clearTimeout(slotData.timeoutId);
            client.announcementSlots.delete(activeMapKey);

            const channel = await interaction.guild.channels.fetch(slotData.channelId).catch(() => null);
            if (channel) {
                await channel.permissionOverwrites.delete(slotData.userId, 'Emergency closed by staff.').catch(() => null);
            }

            const closedEmbed = successEmbed(
                `👤 **User:** <@${slotData.userId}>\n` +
                `📺 **Channel:** <#${slotData.channelId}>\n` +
                `💬 **Limit:** ${slotData.maxMessages} message${slotData.maxMessages !== 1 ? 's' : ''}\n` +
                `⏳ **Time Limit:** ${slotData.durationMinutes} minutes\n` +
                `🔑 **Permissions:** \`${slotData.permType}\`\n\n` +
                `**Status:** 🔴 Closed | Reason: Manually aborted by staff`,
                'Slot Closed 🔒'
            );
            
            if (closedEmbed.setColor) closedEmbed.setColor('#DD2E44');
            else closedEmbed.color = 14495300;

            // Direct API refresh edit to clear out buttons and set embed to red
            await interaction.message.edit({ embeds: [closedEmbed], components: [] }).catch(() => null);

        } catch (error) {
            logger.error('Error executing framework-native close slot button:', error);
        }
    }
};
