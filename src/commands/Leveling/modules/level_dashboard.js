import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getLevelingConfig, saveLevelingConfig } from '../../../services/leveling.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild) {
    const channel = cfg.levelUpChannel ? `<#${cfg.levelUpChannel}>` : '`Not set`';
    const xpMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 15;
    const xpMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 25;
    const cooldown = cfg.xpCooldown ?? 60;
    const rawMsg = cfg.levelUpMessage || '{user} has reached a message count of {level}!';
    const msgPreview = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;

    const rewards = cfg.roleRewards ?? {};
    const rewardEntries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));
    const rewardsValue = rewardEntries.length > 0
        ? rewardEntries.map(([lvl, roleId]) => `Level **${lvl}** → <@&${roleId}>`).join('\n')
        : '`None configured`';

    const ignoredChannels = cfg.ignoredChannels ?? [];
    const ignoredRoles = cfg.ignoredRoles ?? [];
    const ignoredChValue = ignoredChannels.length > 0 ? ignoredChannels.map(id => `<#${id}>`).join(', ') : '`None`';
    const ignoredRoValue = ignoredRoles.length > 0 ? ignoredRoles.map(id => `<@&${id}>`).join(', ') : '`None`';

    return new EmbedBuilder()
        .setTitle('📊 Leveling System Dashboard')
        .setDescription(`Manage leveling settings for **${guild.name}**.\nSelect an option below to modify a setting.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '📢 Level-up Channel', value: channel, inline: true },
            { name: '⚙️ System Status', value: cfg.enabled ? '✅ **Enabled**' : '❌ **Disabled**', inline: true },
            { name: '📣 Announcements', value: cfg.announceLevelUp !== false ? '✅ **Enabled**' : '❌ **Disabled**', inline: true },
            { name: '🎲 XP per Message', value: `\`${xpMin} – ${xpMax}\``, inline: true },
            { name: '⏱️ XP Cooldown', value: `\`${cooldown}s\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '💬 Level-up Message', value: msgPreview, inline: false },
            { name: '🏆 Role Rewards', value: rewardsValue, inline: false },
            { name: '⛔ Ignored Channels', value: ignoredChValue, inline: true },
            { name: '⛔ Ignored Roles', value: ignoredRoValue, inline: true },
        )
        .setFooter({ text: 'Dashboard closes after 10 minutes of inactivity' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`level_cfg_${guildId}`)
        .setPlaceholder('Select a setting to configure...')
        .addOptions([
            {
                label: 'Change Level-up Channel',
                description: 'Set the channel where level-up notifications are sent',
                value: 'channel',
                emoji: '📢'
            },
            {
                label: 'Edit Level-up Message',
                description: 'Customise the message shown when a user levels up',
                value: 'message',
                emoji: '💬'
            },
            {
                label: 'Set XP Range',
                description: 'Set the minimum and maximum XP rewarded per message',
                value: 'xp_range',
                emoji: '🎲'
            },
            {
                label: 'Set XP Cooldown',
                description: 'Seconds between XP grants for the same user',
                value: 'xp_cooldown',
                emoji: '⏱️'
            },
            {
                label: 'Add Role Reward',
                description: 'Award a role when a user reaches a specific level',
                value: 'role_reward_add',
                emoji: '🏆'
            },
            {
                label: 'Remove Role Reward',
                description: 'Remove a role reward from a specific level',
                value: 'role_reward_remove',
                emoji: '🗑️'
            },
            {
                label: 'Ignored Channels',
                description: 'Toggle channels where XP will not be awarded',
                value: 'ignore_channels',
                emoji: '⛔'
            },
            {
                label: 'Ignored Roles',
                description: 'Toggle roles that will not receive XP',
                value: 'ignore_roles',
                emoji: '⛔'
            }
        ]);
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const announceOn = cfg.announceLevelUp !== false;
    const systemOn = cfg.enabled !== false;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`level_cfg_toggle_announce_${guildId}`)
            .setLabel('Announcements')
            .setStyle(announceOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('📣')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`level_cfg_toggle_system_${guildId}`)
            .setLabel('Leveling')
            .setStyle(systemOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('⚡')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId) {
    const selectMenu = buildSelectMenu(guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(cfg, rootInteraction.guild)],
        components: [
            buildButtonRow(cfg, guildId),
            new ActionRowBuilder().addComponents(selectMenu),
        ],
    }).catch(() => {});
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const cfg = await getLevelingConfig(client, guildId);

            const selectMenu = buildSelectMenu(guildId);
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: [buildButtonRow(cfg, guildId), selectRow],
            });

            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 600_000,
            });

            collector.on('collect', async componentInteraction => {
                try {
                    // Check dashboard select options configuration
                    if (componentInteraction.isStringSelect() && componentInteraction.customId === `level_cfg_${guildId}`) {
                        const selectedOption = componentInteraction.values[0];
                        switch (selectedOption) {
                            case 'channel':
                                await handleChannel(componentInteraction, interaction, cfg, guildId, client);
                                break;
                            case 'message':
                                await handleMessage(componentInteraction, interaction, cfg, guildId, client);
                                break;
                            case 'xp_range':
                                await handleXpRange(componentInteraction, interaction, cfg, guildId, client);
                                break;
                            case 'xp_cooldown':
                                await handleXpCooldown(componentInteraction, interaction, cfg, guildId, client);
                                break;
                            case 'role_reward_add':
                                await handleRoleRewardAdd(componentInteraction, interaction, cfg, guildId, client);
                                break;
                            case 'role_reward_remove':
                                await handleRoleRewardRemove(componentInteraction, interaction, cfg, guildId, client);
                                break;
                            case 'ignore_channels':
                                await handleIgnoreChannels(componentInteraction, interaction, cfg, guildId, client);
                                break;
                            case 'ignore_roles':
                                await handleIgnoreRoles(componentInteraction, interaction, cfg, guildId, client);
                                break;
                        }
                        return;
                    }

                    // Process dynamic level-up notification channels select menu updates
                    if (componentInteraction.isChannelSelect() && componentInteraction.customId === `level_cfg_channel_select_${guildId}`) {
                        await componentInteraction.deferUpdate().catch(() => null);
                        const channelId = componentInteraction.values[0];
                        const channel = componentInteraction.guild.channels.cache.get(channelId);

                        if (channel && !botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
                            await componentInteraction.followUp({
                                embeds: [errorEmbed('Missing Permissions', `I need **SendMessages** and **EmbedLinks** permissions in ${channel} to send announcements.`)],
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }

                        cfg.levelUpChannel = channelId;
                        await saveLevelingConfig(client, guildId, cfg);

                        await componentInteraction.followUp({
                            embeds: [successEmbed('✅ Channel Updated', `Level-up notifications will now be sent in ${channel ?? `<#${channelId}>`}.`)],
                            flags: MessageFlags.Ephemeral,
                        });

                        await refreshDashboard(interaction, cfg, guildId);
                        return;
                    }

                    // Process native channel lists configurations
                    if (componentInteraction.isChannelSelect() && componentInteraction.customId === `level_cfg_channels_select_${guildId}`) {
                        await componentInteraction.deferUpdate().catch(() => null);
                        
                        const selectedIds = componentInteraction.values;
                        const ignoreSet = new Set(cfg.ignoredChannels ?? []);

                        for (const id of selectedIds) {
                            if (ignoreSet.has(id)) {
                                ignoreSet.delete(id);
                            } else {
                                ignoreSet.add(id);
                            }
                        }

                        cfg.ignoredChannels = Array.from(ignoreSet);
                        await saveLevelingConfig(client, guildId, cfg);

                        const list = cfg.ignoredChannels.length > 0
                            ? cfg.ignoredChannels.map(id => `<#${id}>`).join(', ')
                            : '`None`';

                        await componentInteraction.followUp({
                            embeds: [successEmbed('✅ Ignored Channels Configuration Synchronized', `The updated list of channels where XP will not be awarded: ${list}`)],
                            flags: MessageFlags.Ephemeral,
                        });

                        await refreshDashboard(interaction, cfg, guildId);
                        return;
                    }

                    // Process native toggled ignored roles configurations
                    if (componentInteraction.isRoleSelect() && componentInteraction.customId === `level_cfg_roles_ignore_${guildId}`) {
                        await componentInteraction.deferUpdate().catch(() => null);
                        const selectedIds = componentInteraction.values;
                        const ignoreSet = new Set(cfg.ignoredRoles ?? []);

                        for (const id of selectedIds) {
                            if (ignoreSet.has(id)) {
                                ignoreSet.delete(id);
                            } else {
                                ignoreSet.add(id);
                            }
                        }

                        cfg.ignoredRoles = Array.from(ignoreSet);
                        await saveLevelingConfig(client, guildId, cfg);

                        const list = cfg.ignoredRoles.length > 0
                            ? cfg.ignoredRoles.map(id => `<@&${id}>`).join(', ')
                            : '`None`';

                        await componentInteraction.followUp({
                            embeds: [successEmbed('✅ Ignored Roles Updated', `These roles will not earn XP: ${list}`)],
                            flags: MessageFlags.Ephemeral,
                        });

                        await refreshDashboard(interaction, cfg, guildId);
                        return;
                    }

                    // Process secondary sequential milestone assignment selection inputs
                    if (componentInteraction.isRoleSelect() && componentInteraction.customId === `level_cfg_role_reward_select_${guildId}`) {
                        const roleId = componentInteraction.values[0];
                        
                        const modal = new ModalBuilder()
                            .setCustomId(`level_cfg_role_reward_modal_${guildId}`)
                            .setTitle('🏆 Specify Reward Level');

                        const levelInput = new TextInputBuilder()
                            .setCustomId('reward_level')
                            .setLabel('Level required (1-1,000,000)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('100')
                            .setMaxLength(7)
                            .setMinLength(1)
                            .setRequired(true);

                        modal.addComponents(new ActionRowBuilder().addComponents(levelInput));
                        await componentInteraction.showModal(modal);

                        const submitted = await componentInteraction.awaitModalSubmit({
                            filter: i => i.customId === `level_cfg_role_reward_modal_${guildId}` && i.user.id === interaction.user.id,
                            time: 120_000
                        }).catch(() => null);

                        if (!submitted) return;

                        const rawLevel = submitted.fields.getTextInputValue('reward_level').trim();
                        const level = parseInt(rawLevel, 10);

                        if (isNaN(level) || level < 1 || level > 1000000) {
                            await submitted.reply({
                                embeds: [errorEmbed('Invalid Level', 'Level must be a whole number between **1** and **1,000,000**.')],
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }

                        cfg.roleRewards = cfg.roleRewards ?? {};
                        cfg.roleRewards[level] = roleId;
                        await saveLevelingConfig(client, guildId, cfg);

                        await submitted.reply({
                            embeds: [successEmbed('✅ Role Reward Added', `<@&${roleId}> will now be awarded at level **${level}**.`)],
                            flags: MessageFlags.Ephemeral,
                        });

                        await refreshDashboard(interaction, cfg, guildId);
                        return;
                    }

                    // Process dashboard status control buttons
                    if (componentInteraction.isButton()) {
                        if (componentInteraction.customId !== `level_cfg_toggle_announce_${guildId}` && 
                            componentInteraction.customId !== `level_cfg_toggle_system_${guildId}`) return;

                        await componentInteraction.deferUpdate().catch(() => null);
                        const isAnnounce = componentInteraction.customId === `level_cfg_toggle_announce_${guildId}`;

                        if (isAnnounce) {
                            cfg.announceLevelUp = cfg.announceLevelUp === false;
                            await saveLevelingConfig(client, guildId, cfg);
                            await componentInteraction.followUp({
                                embeds: [successEmbed('✅ Announcements Updated', `Level-up announcements are now **${cfg.announceLevelUp ? 'enabled' : 'disabled'}**.`)],
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            const wasEnabled = cfg.enabled !== false;
                            cfg.enabled = !wasEnabled;
                            await saveLevelingConfig(client, guildId, cfg);
                            await componentInteraction.followUp({
                                embeds: [successEmbed('✅ System Updated', `The leveling system is now **${cfg.enabled ? 'enabled' : 'disabled'}**.`)],
                                flags: MessageFlags.Ephemeral,
                            });
                        }

                        await refreshDashboard(interaction, cfg, guildId);
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Leveling config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected leveling dashboard error:', error);
                    }

                    const errorMessage = error instanceof TitanBotError
                        ? error.userMessage || 'An error occurred while processing your selection.'
                        : 'An unexpected error occurred while updating the configuration.';

                    if (!componentInteraction.replied && !componentInteraction.deferred) {
                        await componentInteraction.deferUpdate().catch(() => {});
                    }

                    await componentInteraction.followUp({
                        embeds: [errorEmbed('Configuration Error', errorMessage)],
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle('⏰ Dashboard Timed Out')
                        .setDescription('This dashboard has been closed due to inactivity. Please run the command again to continue.')
                        .setColor(getColor('error'));
                    
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [timeoutEmbed],
                        components: [],
                    }).catch(() => {});
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in level_dashboard:', error);
            throw new TitanBotError(
                `Level dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the leveling dashboard.',
            );
        }
    },
};

// ─── Add Role Reward ─────────────────────────────────────────────────────────

async function handleRoleRewardAdd(selectInteraction, rootInteraction, cfg, guildId, client) {
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId(`level_cfg_role_reward_select_${guildId}`)
        .setPlaceholder('Select a role to award...')
        .setMinValues(1)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(roleSelect);

    await selectInteraction.reply({
        content: '🏆 **Select the milestone role reward from the list below:**',
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

// ─── Remove Role Reward ───────────────────────────────────────────────────────

async function handleRoleRewardRemove(selectInteraction, rootInteraction, cfg, guildId, client) {
    const rewards = cfg.roleRewards ?? {};
    const entries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));

    if (entries.length === 0) {
        await selectInteraction.deferUpdate();
        await selectInteraction.followUp({
            embeds: [errorEmbed('No Rewards', 'There are no role rewards configured to remove.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_role_reward_remove_${guildId}`)
        .setTitle('🗑️ Remove Role Reward');

    const infoInput = new TextInputBuilder()
        .setCustomId('current_rewards')
        .setLabel('Current rewards (read-only)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(entries.map(([lvl, roleId]) => `Level ${lvl}: Role ID ${roleId}`).join('\n'))
        .setRequired(false);

    const levelInput = new TextInputBuilder()
        .setCustomId('remove_level')
        .setLabel('Level to remove reward from')
        .setStyle(TextInputStyle.Short)
        .setValue(entries[0][0])
        .setMaxLength(7)
        .setMinLength(1)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(infoInput),
        new ActionRowBuilder().addComponents(levelInput),
    );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_role_reward_remove_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawLevel = submitted.fields.getTextInputValue('remove_level').trim();
    const level = parseInt(rawLevel, 10);

    if (isNaN(level) || !cfg.roleRewards?.[level]) {
        await submitted.reply({
            embeds: [errorEmbed('Not Found', `No role reward is configured for level **${rawLevel}**.`)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    delete cfg.roleRewards[level];
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Role Reward Removed', `The role reward for level **${level}** has been removed.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Change Level-up Channel ──────────────────────────────────────────────────

async function handleChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(`level_cfg_channel_select_${guildId}`)
        .setPlaceholder('Select a text channel...')
        .setMinValues(1)
        .setMaxValues(1)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    const row = new ActionRowBuilder().addComponents(channelSelect);

    await selectInteraction.reply({
        content: '📢 **Select the channel where level-up notifications will be sent:**',
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

// ─── Ignored Channels ────────────────────────────────────────────────────────

async function handleIgnoreChannels(selectInteraction, rootInteraction, cfg, guildId, client) {
    const channelMenuBuilder = new ChannelSelectMenuBuilder()
        .setCustomId(`level_cfg_channels_select_${guildId}`)
        .setPlaceholder('Toggle channels to ignore/enable XP rewards...')
        .setMinValues(1)
        .setMaxValues(25)
        .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.AnnouncementThread
        );

    const row = new ActionRowBuilder().addComponents(channelMenuBuilder);

    await selectInteraction.reply({
        content: '⚙️ **Select channels to toggle from the list below.**\nSelecting an ignored channel again removes it from the ignore list.',
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

// ─── Ignored Roles ────────────────────────────────────────────────────────────

async function handleIgnoreRoles(selectInteraction, rootInteraction, cfg, guildId, client) {
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId(`level_cfg_roles_ignore_${guildId}`)
        .setPlaceholder('Select roles to toggle...')
        .setMinValues(1)
        .setMaxValues(10);

    const row = new ActionRowBuilder().addComponents(roleSelect);

    await selectInteraction.reply({
        content: '⛔ **Select roles to toggle from the list below.** Members with these roles will not earn XP.',
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

// ─── Edit Level-up Message ────────────────────────────────────────────────────

async function handleMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('level_cfg_message')
        .setTitle('Edit Level-up Message')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message_input')
                    .setLabel('Message ({user} and {level} are available)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.levelUpMessage || '{user} has reached a message count of {level}!')
                    .setMaxLength(500)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('{user} has reached a message count of {level}!'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'level_cfg_message' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newMessage = submitted.fields.getTextInputValue('message_input').trim();

    cfg.levelUpMessage = newMessage;
    await saveLevelingConfig(client, guildId, cfg);

    const preview = newMessage.replace('{user}', '@User').replace('{level}', '5');

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Message Updated',
                `Level-up message saved.\n**Preview:** ${preview}`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Set XP Range ─────────────────────────────────────────────────────────────

async function handleXpRange(selectInteraction, rootInteraction, cfg, guildId, client) {
    const currentMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 15;
    const currentMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 25;

    const modal = new ModalBuilder()
        .setCustomId('level_cfg_xp_range')
        .setTitle('Set XP Range per Message')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('xp_min_input')
                    .setLabel('Minimum XP (1–500)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(currentMin))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('15'),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('xp_max_input')
                    .setLabel('Maximum XP (1–500)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(currentMax))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('25'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'level_cfg_xp_range' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawMin = submitted.fields.getTextInputValue('xp_min_input').trim();
    const rawMax = submitted.fields.getTextInputValue('xp_max_input').trim();
    const newMin = parseInt(rawMin, 10);
    const newMax = parseInt(rawMax, 10);

    if (isNaN(newMin) || isNaN(newMax) || newMin < 1 || newMax < 1 || newMin > 500 || newMax > 500) {
        await submitted.reply({
            embeds: [
                errorEmbed('Invalid Values', 'Both XP values must be whole numbers between **1** and **500**.'),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (newMin > newMax) {
        await submitted.reply({
            embeds: [
                errorEmbed('Invalid Range', 'Minimum XP cannot be greater than maximum XP.'),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    cfg.xpRange = { min: newMin, max: newMax };
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ XP Range Updated',
                `Users will now earn between **${newMin}** and **${newMax}** XP per message.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Set XP Cooldown (COMPLETED) ──────────────────────────────────────────────

async function handleXpCooldown(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('level_cfg_cooldown')
        .setTitle('Set XP Cooldown')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cooldown_input')
                    .setLabel('Cooldown in seconds (0–3600)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.xpCooldown ?? 60))
                    .setMaxLength(4)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('60'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'level_cfg_cooldown' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawCooldown = submitted.fields.getTextInputValue('cooldown_input').trim();
    const cooldown = parseInt(rawCooldown, 10);

    if (isNaN(cooldown) || cooldown < 0 || cooldown > 3600) {
        await submitted.reply({
            embeds: [errorEmbed('Invalid Cooldown', 'Cooldown must be a positive number between **0** and **3600** seconds.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    cfg.xpCooldown = cooldown;
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Cooldown Updated', `XP cooldown set to **${cooldown}** seconds.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}
