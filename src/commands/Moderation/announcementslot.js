import { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Pre-loaded with your exact production channel IDs
const CHANNEL_MAP = {
    announcements: '1362470860933435473',
    videos:        '1362496298594468040',
    polls:         '1362473134518702092',
    customs:       '1362472109695303850'
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

    async execute(interaction) {
        try {
            await InteractionHelper.safeDefer(interaction);

            // Access shared runtime memory map natively via the interaction's client property
            if (!interaction.client.announcementSlots) {
                interaction.client.announcementSlots = new Map();
            }

            const targetUser = interaction.options.getUser('user');
            const channelKey = interaction.options.getString('channel');
            const maxMessages = interaction.options.getInteger('message_count');
            const durationMinutes = interaction.options.getInteger('time');
            const permType = interaction.options.getString('permissions');

            const targetChannelId = CHANNEL_MAP[channelKey];
            const channel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);

            if (!channel) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Channel Not Found', `Could not find configuration matching **${channelKey}**.`)]
                });
            }

            await channel.permissionOverwrites.edit(targetUser.id, {
                SendMessages: true,
                ViewChannel: true,
                MentionEveryone: permType === 'message+ping' ? true : null
            }, { reason: `Announcement slot granted by ${interaction.user.tag}` });

            const expiresAt = Date.now() + (durationMinutes * 60 * 1000);

            const embed = successEmbed(
                `👤 **User:** <@${targetUser.id}>\n` +
                `📺 **Channel:** <#${targetChannelId}>\n` +
                `💬 **Limit:** ${maxMessages} message${maxMessages !== 1 ? 's' : ''}\n` +
                `⏳ **Time Limit:** ${durationMinutes} minutes (Expires <t:${Math.floor(expiresAt / 1000)}:R>)\n` +
                `🔑 **Permissions:** \`${permType}\`\n\n` +
                `**Status:** 🟢 Active`,
                'Slot Opened Successfully 🔓'
            );

            const abortButton = new ButtonBuilder()
                .setCustomId('closeslot')
                .setLabel('🔒 Emergency Close')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(abortButton);
            
            await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components: [row] });
            
            // Explicit lookup to capture exact system generated message id values
            const replyMessage = await interaction.fetchReply().catch(() => null);
            const savedMessageId = replyMessage ? replyMessage.id : null;

            const mapKey = `${interaction.guildId}-${targetChannelId}-${targetUser.id}`;
            
            // Standard Background Expiration Tracker
            const timeoutId = setTimeout(async () => {
                const globalSlots = interaction.client.announcementSlots;
                if (globalSlots && globalSlots.has(mapKey)) {
                    const activeSlot = globalSlots.get(mapKey);
                    globalSlots.delete(mapKey);

                    await channel.permissionOverwrites.delete(targetUser.id, 'Announcement slot time expired.').catch(() => null);

                    const expiredEmbed = successEmbed(
                        `👤 **User:** <@${targetUser.id}>\n` +
                        `📺 **Channel:** <#${targetChannelId}>\n` +
                        `💬 **Limit:** ${maxMessages} message${maxMessages !== 1 ? 's' : ''}\n` +
                        `⏳ **Time Limit:** ${durationMinutes} minutes\n` +
                        `🔑 **Permissions:** \`${permType}\`\n\n` +
                        `**Status:** 🔴 Closed | Reason: Slot expired`,
                        'Slot Closed 🔒'
                    );
                    
                    if (expiredEmbed.setColor) expiredEmbed.setColor('#DD2E44');
                    else expiredEmbed.color = 14495300;

                    if (activeSlot.interactionMessageId) {
                        const cmdChannel = await interaction.client.channels.fetch(activeSlot.commandChannelId).catch(() => null);
                        if (cmdChannel) {
                            const targetMsg = await cmdChannel.messages.fetch(activeSlot.interactionMessageId).catch(() => null);
                            if (targetMsg) {
                                await targetMsg.edit({ embeds: [expiredEmbed], components: [] }).catch(() => null);
                            }
                        }
                    }
                }
            }, durationMinutes * 60 * 1000);

            interaction.client.announcementSlots.set(mapKey, {
                userId: targetUser.id,
                channelId: targetChannelId,
                guildId: interaction.guildId,
                commandChannelId: interaction.channelId,
                interactionMessageId: savedMessageId,
                maxMessages,
                durationMinutes,
                currentCount: 0,
                expiresAt,
                permType,
                staffId: interaction.user.id,
                timeoutId
            });

        } catch (error) {
            logger.error('Error executing announcementslot command', error);
        }
    }
};
