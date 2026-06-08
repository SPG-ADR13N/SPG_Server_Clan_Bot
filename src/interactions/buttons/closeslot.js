import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

export default {
    name: 'closeslot',
    async execute(interaction) { // Framework argument layout independent
        try {
            // Using native interaction.client to guarantee shared memory access
            const slotsMap = interaction.client.announcementSlots;

            if (!slotsMap || slotsMap.size === 0) {
                return await interaction.reply({
                    content: '❌ No active announcements slots are currently being tracked in memory.',
                    ephemeral: true
                });
            }

            // Look up the active slot by tracking the parent message containing this button
            let slotData = null;
            let activeMapKey = null;

            for (const [key, value] of slotsMap.entries()) {
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

            // Restrict closing privileges to the staff member who opened the slot
            if (interaction.user.id !== slotData.staffId) {
                return await interaction.reply({
                    content: '❌ Only the staff member who opened this slot can close it.',
                    ephemeral: true
                });
            }

            // Acknowledge interaction immediately
            await interaction.deferUpdate().catch(() => null);

            // Clean up timers and map allocations
            clearTimeout(slotData.timeoutId);
            slotsMap.delete(activeMapKey);

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

            // Direct UI update: turns status red and wipes out the emergency button line
            await interaction.message.edit({ embeds: [closedEmbed], components: [] }).catch(() => null);

        } catch (error) {
            logger.error('Error executing framework-native close slot button:', error);
        }
    }
};
