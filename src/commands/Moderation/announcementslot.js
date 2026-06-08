import { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ComponentType
} from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const CHANNEL_MAP = {
    announcements: '123456789012345678', // REPLACE WITH YOUR REAL CHANNEL ID
    customs:       '123456789012345678', // REPLACE WITH YOUR REAL CHANNEL ID
    videos:        '123456789012345678', // REPLACE WITH YOUR REAL CHANNEL ID
    polls:         '123456789012345678'  // REPLACE WITH YOUR REAL CHANNEL ID
};

export default {
    data: new SlashCommandBuilder()
        .setName('announcementslot')
        .setDescription('Grants a user temporary permission to post in an announcement channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addUserOption(option => option.setName('user').setDescription('The user to grant the slot to').setRequired(true))
        .addStringOption(option =>
            option.setName('channel')
                .setDescription('The target announcement channel')
                .setRequired(true)
                .addChoices(
                    { name: 'announcements', value: 'announcements' },
                    { name: 'customs', value: 'customs' },
                    { name: 'videos', value: 'videos' },
                    { name: 'polls', value: 'polls' }
                ))
        .addIntegerOption(option =>
            option.setName('message_count')
                .setDescription('Number of allowed messages')
                .setRequired(true)
                .addChoices(
                    { name: '1 message', value: 1 },
                    { name: '2 messages', value: 2 },
                    { name: '3 messages', value: 3 },
                    { name: '4 messages', value: 4 },
                    { name: '5 messages', value: 5 }
                ))
        .addIntegerOption(option =>
            option.setName('time')
                .setDescription('How long the slot stays open')
                .setRequired(true)
                .addChoices(
                    { name: '2 minutes', value: 2 },
                    { name: '5 minutes', value: 5 },
                    { name: '10 minutes', value: 10 },
                    { name: '15 minutes', value: 15 }
                ))
        .addStringOption(option =>
            option.setName('permissions')
                .setDescription('Permission level to grant')
                .setRequired(true)
                .addChoices(
                    { name: 'message', value: 'message' },
                    { name: 'message+ping', value: 'message+ping' }
                )),

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const targetUser = interaction.options.getUser('user');
            const channelKey = interaction.options.getString('channel');
            const maxMessages = interaction.options.getInteger('message_count');
            const durationMinutes = interaction.options.getInteger('time');
            const permType = interaction.options.getString('permissions');

            const targetChannelId = CHANNEL_MAP[channelKey];
            const channel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);

            if (!channel) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Channel Not Found', `Could not find config channel for **${channelKey}**.`)]
                });
            }

            // Apply target channel overrides
            await channel.permissionOverwrites.edit(targetUser.id, {
                SendMessages: true,
                ViewChannel: true,
                MentionEveryone: permType === 'message+ping' ? true : null
            }, { reason: `Announcement slot granted by ${interaction.user.tag}` });

            const expiresAt = Date.now() + (durationMinutes * 60 * 1000);

            // Construct the clean status embed layout
            const embed = successEmbed(
                `👤 **User:** <@${targetUser.id}>\n` +
                `📺 **Channel:** <#${targetChannelId}>\n` +
                `💬 **Limit:** ${maxMessages} message${maxMessages !== 1 ? 's' : ''}\n` +
                `⏳ **Time Limit:** ${durationMinutes} minutes (Expires <t:${Math.floor(expiresAt / 1000)}:R>)\n` +
                `🔑 **Permissions:** \`${permType}\`\n\n` +
                `**Status:** 🟢 Active`,
                'Slot Opened Successfully 🔓'
            );

            // Create the Emergency Abort Button Component
            const abortButton = new ButtonBuilder()
                .setCustomId(`abort_slot:${targetUser.id}:${targetChannelId}`)
                .setLabel('🔒 Emergency Close')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(abortButton);

            const replyMessage = await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                components: [row]
            });

            const dbKey = `announcement-slot:${interaction.guildId}:${targetChannelId}:${targetUser.id}`;
            const slotData = {
                userId: targetUser.id,
                channelId: targetChannelId,
                guildId: interaction.guildId,
                commandChannelId: interaction.channelId,
                interactionMessageId: replyMessage.id,
                maxMessages,
                currentCount: 0,
                expiresAt,
                permType,
                staffId: interaction.user.id
            };
            
            await client.db.set(dbKey, slotData);

            // Dynamic Collector to catch Emergency Abort button presses live
            const collector = replyMessage.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: durationMinutes * 60 * 1000
            });

            collector.on('collect', async btnInteraction => {
                if (btnInteraction.customId !== `abort_slot:${targetUser.id}:${targetChannelId}`) return;

                // Restrict button safety usage strictly to the staff member who invoked it
                if (btnInteraction.user.id !== slotData.staffId) {
                    return await btnInteraction.reply({
                        content: '❌ Only the staff member who opened this slot can emergency close it.',
                        ephemeral: true
                    });
                }

                await btnInteraction.deferUpdate();
                
                // Pull fresh state to confirm it hasn't been closed by message limits already
                const freshData = await client.db.get(dbKey);
                if (!freshData) return;

                await channel.permissionOverwrites.delete(targetUser.id, 'Slot manually aborted by staff.').catch(() => null);
                await client.db.delete(dbKey);

                const closedEmbed = successEmbed(
                    `👤 **User:** <@${targetUser.id}>\n` +
                    `📺 **Channel:** <#${targetChannelId}>\n` +
                    `💬 **Limit:** ${maxMessages} message${maxMessages !== 1 ? 's' : ''}\n` +
                    `⏳ **Time Limit:** ${durationMinutes} minutes\n` +
                    `🔑 **Permissions:** \`${permType}\`\n\n` +
                    `**Status:** 🔴 Closed | Reason: Manually aborted by staff`,
                    'Slot Closed 🔒'
                ).setColor('#DD2E44');

                await btnInteraction.editReply({ embeds: [closedEmbed], components: [] });
                collector.stop();
            });

            // Fallback Background Security Safety Timer
            setTimeout(async () => {
                const currentData = await client.db.get(dbKey);
                if (currentData) {
                    await channel.permissionOverwrites.delete(targetUser.id, 'Announcement slot time expired.').catch(() => null);
                    await client.db.delete(dbKey);

                    const expiredEmbed = successEmbed(
                        `👤 **User:** <@${targetUser.id}>\n` +
                        `📺 **Channel:** <#${targetChannelId}>\n` +
                        `💬 **Limit:** ${maxMessages} message${maxMessages !== 1 ? 's' : ''}\n` +
                        `⏳ **Time Limit:** ${durationMinutes} minutes\n` +
                        `🔑 **Permissions:** \`${permType}\`\n\n` +
                        `**Status:** 🔴 Closed | Reason: Slot expired`,
                        'Slot Closed 🔒'
                    ).setColor('#DD2E44');

                    const cmdChannel = await client.channels.fetch(slotData.commandChannelId).catch(() => null);
                    if (cmdChannel) {
                        const originalMsg = await cmdChannel.messages.fetch(slotData.interactionMessageId).catch(() => null);
                        if (originalMsg) {
                            await originalMsg.edit({ embeds: [expiredEmbed], components: [] }).catch(() => null);
                        }
                    }
                }
            }, durationMinutes * 60 * 1000);

        } catch (error) {
            logger.error('Error executing announcementslot command', error);
        }
    }
};
