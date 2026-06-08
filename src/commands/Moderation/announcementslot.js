import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Hardcoded map of your channel choices to their real Discord Channel IDs
const CHANNEL_MAP = {
    announcements: '1362470860933435473', // REPLACE WITH REAL CHANNEL ID
    customs:       '1362472109695303850', // REPLACE WITH REAL CHANNEL ID
    videos:        '1362496298594468040', // REPLACE WITH REAL CHANNEL ID
    polls:         '1362473134518702092'  // REPLACE WITH REAL CHANNEL ID
};

export default {
    data: new SlashCommandBuilder()
        .setName('announcementslot')
        .setDescription('Grants a user temporary permission to post in an announcement channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // Restricted to Admin/Staff
        .addUserOption(option => 
            option.setName('user').setDescription('The user to grant the slot to').setRequired(true))
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
                    embeds: [errorEmbed('Channel Not Found', `Could not find config channel for **${channelKey}**. Verify configuration IDs.`)]
                });
            }

            // Define permissions array based on selection
            const permissionsToAllow = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel];
            if (permType === 'message+ping') {
                permissionsToAllow.push(PermissionFlagsBits.MentionEveryone);
            }

            // Apply override to target channel for this specific user
            await channel.permissionOverwrites.edit(targetUser.id, {
                SendMessages: true,
                ViewChannel: true,
                MentionEveryone: permType === 'message+ping' ? true : null
            }, { reason: `Announcement slot granted by ${interaction.user.tag}` });

            // Calculate expiration epoch timestamp
            const expiresAt = Date.now() + (durationMinutes * 60 * 1000);

            // Save tracker data context into database to remain crash-safe
            const dbKey = `announcement-slot:${interaction.guildId}:${targetChannelId}:${targetUser.id}`;
            const slotData = {
                userId: targetUser.id,
                channelId: targetChannelId,
                guildId: interaction.guildId,
                maxMessages,
                currentCount: 0,
                expiresAt,
                permType
            };
            await client.db.set(dbKey, slotData);

            logger.info(`Announcement slot active: User ${targetUser.id} in ${channelKey} for ${maxMessages} msgs.`);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    `Temporary posting slot successfully opened!\n\n` +
                    `👤 **User:** <@${targetUser.id}>\n` +
                    `📺 **Channel:** <#${targetChannelId}>\n` +
                    `💬 **Limit:** ${maxMessages} message${maxMessages !== 1 ? 's' : ''}\n` +
                    `⏳ **Time Limit:** ${durationMinutes} minutes (Expires <t:${Math.floor(expiresAt / 1000)}:R>)\n` +
                    `🔑 **Permissions:** \`${permType}\``,
                    'Slot Opened Successfully 🔓'
                )]
            });

            // Set background backup expiration safety timer
            setTimeout(async () => {
                const currentData = await client.db.get(dbKey);
                if (currentData) {
                    // If ledger entry still exists, time expired before they spent all messages
                    await channel.permissionOverwrites.delete(targetUser.id, 'Announcement slot time expired.').catch(() => null);
                    await client.db.delete(dbKey);
                    logger.info(`Announcement slot automatically expired for user ${targetUser.id} in channel ${targetChannelId}`);
                }
            }, durationMinutes * 60 * 1000);

        } catch (error) {
            logger.error('Error executing announcementslot command', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Command Error', 'An unexpected execution failure occurred processing this request.')]
            });
        }
    }
};
