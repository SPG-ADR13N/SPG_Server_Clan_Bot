import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    LabelBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
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
    const xpMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 1;
    const xpMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 1;
    const cooldown = cfg.xpCooldown ?? 0;
    const rawMsg = cfg.levelUpMessage || '{user} has reached a message count of {level}!';
    const msgPreview = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;

    const rewards = cfg.roleRewards ?? {};
    const rewardEntries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));
    const rewardsValue = rewardEntries.length > 0
        ? rewardEntries.map(([lvl, roleId]) => `Level **${lvl}** → <@&${roleId}>`).join('\n')
        : '`None configured`';

    // ─── WHITELIST CHANNEL MAPPING ───────────────────────────────────────────
    const rawChannels = Array.isArray(cfg.allowedChannels) ? cfg.allowedChannels : [];
    const validChannelIds = rawChannels.filter(id => typeof id === 'string' && /^\d+$/.test(id));
    
    const allowedChValue = validChannelIds.length > 0 
        ? validChannelIds.map(id => `<#${id}>`).join(', ') 
        : '`All Channels`';
        
    const rawRoles = Array.isArray(cfg.ignoredRoles) ? cfg.ignoredRoles : [];
    const validRoleIds = rawRoles.filter(id => typeof id === 'string' && /^\d+$/.test(id));
    
    const ignoredRoValue = validRoleIds.length > 0 
        ? validRoleIds.map(id => `<@&${id}>`).join(', ') 
        : '`None`';
    // ─────────────────────────────────────────────────────────────────────────

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
            { name: '✅ Allowed XP Channels', value: allowedChValue.length > 1000 ? `${allowedChValue.substring(0, 950)}...` : allowedChValue, inline: true },
            { name: '⛔ Ignored Roles', value: ignoredRoValue.length > 1000 ? `${ignoredRoValue.substring(0, 950)}...` : ignoredRoValue, inline: true },
        )
        .setFooter({ text: 'Dashboard closes after 10 minutes of inactivity' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`level_cfg_${guildId}`)
        .setPlaceholder('Select a setting to configure...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Change Level-up Channel')
                .setDescription('Set the channel where level-up notifications are sent')
                .setValue('channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Edit Level-up Message')
                .setDescription('Customise the message shown when a user levels up')
                .setValue('message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Set XP Range')
                .setDescription('Set the minimum and maximum XP rewarded per message')
                .setValue('xp_range')
                .setEmoji('🎲'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Set XP Cooldown')
                .setDescription('Seconds between XP grants for the same user')
                .setValue('xp_cooldown')
                .setEmoji('⏱️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Add Role Reward')
                .setDescription('Award a role when a user reaches a specific level')
                .setValue('role_reward_add')
                .setEmoji('🏆'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Remove Role Reward')
                .setDescription('Remove a role reward from a specific level')
                .setValue('role_reward_remove')
                .setEmoji('🗑️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Allowed XP Channels')
                .setDescription('Toggle channels where XP will be awarded exclusively')
                .setValue('allowed_channels')
                .setEmoji('✅'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Ignored Roles')
                .setDescription('Toggle roles that will not receive XP')
                .setValue('ignore_roles')
                .setEmoji('⛔'),
        );
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

            if (!cfg.configured) {
                throw new TitanBotError(
                    'Leveling system not configured',
                    ErrorTypes.CONFIGURATION,
                    'The leveling system has not been set up yet. Run `/level setup` first to configure it.',
                );
            }

            const selectMenu = buildSelectMenu(guildId);
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: [buildButtonRow(cfg, guildId), selectRow],
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `level_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'channel':
                            await handleChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'message':
                            await handleMessage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'xp_range':
                            await handleXpRange(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'xp_cooldown':
                            await handleXpCooldown(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'role_reward_add':
                            await handleRoleRewardAdd(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'role_reward_remove':
                            await handleRoleRewardRemove(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'allowed_channels':
                            await handleAllowedChannels(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'ignore_roles':
                            await handleIgnoreRoles(selectInteraction, interaction, cfg, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Leveling config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected leveling dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'An error occurred while processing your selection.'
                            : 'An unexpected error occurred while updating the configuration.';

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await selectInteraction
                        .followUp({
                            embeds: [errorEmbed('Configuration Error', errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    (i.customId === `level_cfg_toggle_announce_${guildId}` ||
                        i.customId === `level_cfg_toggle_system_${guildId}`),
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    await btnInteraction.deferUpdate().catch(() => null);
                } catch (err) {
                    logger.debug('Button interaction already expired:', err.message);
                    return;
                }
                const isAnnounce = btnInteraction.customId === `level_cfg_toggle_announce_${guildId}`;

                if (isAnnounce) {
                    cfg.announceLevelUp = cfg.announceLevelUp === false;
                    await saveLevelingConfig(client, guildId, cfg).catch(() => {});
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ Announcements Updated',
                                `Level-up announcements are now **${cfg.announceLevelUp ? 'enabled' : 'disabled'}**.`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                } else {
                    const wasEnabled = cfg.enabled !== false;
                    cfg.enabled = !wasEnabled;
                    await saveLevelingConfig(client, guildId, cfg).catch(() => {});
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ System Updated',
                                `The leveling system is now **${cfg.enabled ? 'enabled' : 'disabled'}**.${!cfg.enabled ? '\nUsers will not earn XP until the system is re-enabled.' : ''}`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }

                await refreshDashboard(interaction, cfg, guildId);
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
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

            btnCollector.on('end', async (collected, reason) => {
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
            
            if (error.errors && Array.isArray(error.errors)) {
                error.errors.forEach((subErr, i) => {
                    logger.error(`[Dashboard Builder Error #${i + 1}]:`, subErr);
                });
            } else if (error.childOutputs && Array.isArray(error.childOutputs)) {
                error.childOutputs.forEach((subErr, i) => {
                    logger.error(`[Dashboard Structure Error #${i + 1}]:`, subErr);
                });
            }
            
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
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_role_reward_add_${guildId}`)
        .setTitle('🏆 Add Role Reward');

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('reward_role')
        .setPlaceholder('Select a role to award...')
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);

    const roleLabel = new LabelBuilder()
        .setLabel('Role to Award')
        .setDescription('This role will be given when the user reaches the level')
        .setRoleSelectMenuComponent(roleSelect);

    const levelInput = new TextInputBuilder()
        .setCustomId('reward_level')
        .setLabel('Level required (1-1,000,000)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('10000')
        .setMaxLength(7)
        .setMinLength(1)
        .setRequired(true);

    modal.addLabelComponents(roleLabel);
    modal.addComponents(new ActionRowBuilder().addComponents(levelInput));

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_role_reward_add_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawLevel = submitted.fields.getTextInputValue('reward_level').trim();
    const level = parseInt(rawLevel, 10);

    if (isNaN(level) || level < 1 || level > 1000000) {
        await submitted.reply({
            embeds: [errorEmbed('Invalid Level', 'Level must be a whole number between **1** and **1,000,000**.')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    const roleId = submitted.fields.getField('reward_role').values[0];

    cfg.roleRewards = cfg.roleRewards ?? {};
    cfg.roleRewards[level] = roleId;
    await saveLevelingConfig(client, guildId, cfg).catch(() => {});

    await submitted.reply({
        embeds: [successEmbed('✅ Role Reward Added', `<@&${roleId}> will now be awarded at level **${level}**.`)],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Remove Role Reward ───────────────────────────────────────────────────────

async function handleRoleRewardRemove(selectInteraction, rootInteraction, cfg, guildId, client) {
    const rewards = cfg.roleRewards ?? {};
    const entries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));

    if (entries.length === 0) {
        await selectInteraction.deferUpdate().catch(() => {});
        await selectInteraction.followUp({
            embeds: [errorEmbed('No Rewards', 'There are no role rewards configured to remove.')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_role_reward_remove_${guildId}`)
        .setTitle('🗑️ Remove Role Reward');

    const infoInput = new TextInputBuilder()
        .setCustomId('current_rewards')
        .setLabel('Current rewards (read-only)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(entries.map(([lvl, roleId]) => `Level ${lvl}: <@&${roleId}>`).join('\n'))
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
        }).catch(() => {});
        return;
    }

    delete cfg.roleRewards[level];
    await saveLevelingConfig(client, guildId, cfg).catch(() => {});

    await submitted.reply({
        embeds: [successEmbed('✅ Role Reward Removed', `The role reward for level **${level}** has been removed.`)],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Change Level-up Channel ─────────────────────────────────────────────────────────

async function handleChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_channel_modal_${guildId}`)
        .setTitle('📢 Change Level-up Channel');

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('levelup_channel')
        .setPlaceholder('Select a text channel...')
        .setMinValues(1)
        .setMaxValues(1)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true);

    const channelLabel = new LabelBuilder()
        .setLabel('Level-up Channel')
        .setDescription('Channel where level-up notifications will be sent')
        .setChannelSelectMenuComponent(channelSelect);

    modal.addLabelComponents(channelLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_channel_modal_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const channelId = submitted.fields.getField('levelup_channel').values[0];
    const channel = selectInteraction.guild.channels.cache.get(channelId);

    if (channel && !botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
        await submitted.reply({
            embeds: [errorEmbed('Missing Permissions', `I need **SendMessages** and **EmbedLinks** permissions in ${channel} to send level-up notifications.`)],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    cfg.levelUpChannel = channelId;
    await saveLevelingConfig(client, guildId, cfg).catch(() => {});

    await submitted.reply({
        embeds: [successEmbed('✅ Channel Updated', `Level-up notifications will now be sent in ${channel ?? `<#${channelId}>`}.`)],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Allowed Channels (Whitelist) ────────────────────────────────────────────

async function handleAllowedChannels(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_allowed_channels_${guildId}`)
        .setTitle('✅ Allowed XP Channels');

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('allowed_channel')
        .setPlaceholder('Select channels to toggle...')
        .setMinValues(1)
        .setMaxValues(10)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true);

    const channelLabel = new LabelBuilder()
        .setLabel('Toggle Allowed Channels')
        .setDescription('Selected channels will be toggled — only these channels will award XP')
        .setChannelSelectMenuComponent(channelSelect);

    modal.addLabelComponents(channelLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_allowed_channels_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const selectedIds = submitted.fields.getField('allowed_channel').values;
    const allowedSet = new Set(cfg.allowedChannels ?? []);

    for (const id of selectedIds) {
        if (allowedSet.has(id)) {
            allowedSet.delete(id);
        } else {
            allowedSet.add(id);
        }
    }

    cfg.allowedChannels = Array.from(allowedSet);
    // Explicit clean out of legacy blacklist variable to keep database lightweight
    if (cfg.ignoredChannels) delete cfg.ignoredChannels;

    await saveLevelingConfig(client, guildId, cfg).catch(() => {});

    const list = cfg.allowedChannels.length > 0
        ? cfg.allowedChannels.map(id => `<#${id}>`).join(', ')
        : '`All Channels`';

    await submitted.reply({
        embeds: [successEmbed('✅ Allowed Channels Updated', `XP will now exclusively be awarded in: ${list}`)],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Ignored Roles ────────────────────────────────────────────────────────────

async function handleIgnoreRoles(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_ignore_roles_${guildId}`)
        .setTitle('⛔ Ignored Roles');

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('ignore_role')
        .setPlaceholder('Select roles to toggle...')
        .setMinValues(1)
        .setMaxValues(10)
        .setRequired(true);

    const roleLabel = new LabelBuilder()
        .setLabel('Toggle Ignored Roles')
        .setDescription('Selected roles will be toggled — members with them will not earn XP')
        .setRoleSelectMenuComponent(roleSelect);

    modal.addLabelComponents(roleLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_ignore_roles_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const selectedIds = submitted.fields.getField('ignore_role').values;
    const ignoreSet = new Set(cfg.ignoredRoles ?? []);

    for (const id of selectedIds) {
        if (ignoreSet.has(id)) {
            ignoreSet.delete(id);
        } else {
            ignoreSet.add(id);
        }
    }

    cfg.ignoredRoles = Array.from(ignoreSet);
    await saveLevelingConfig(client, guildId, cfg).catch(() => {});

    const list = cfg.ignoredRoles.length > 0
        ? cfg.ignoredRoles.map(id => `<@&${id}>`).join(', ')
        : '`None`';

    await submitted.reply({
        embeds: [successEmbed('✅ Ignored Roles Updated', `These roles will not earn XP: ${list}`)],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    await refreshDashboard(rootInteraction, cfg, guildId);
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

    if (!newMessage.includes('{user}') && !newMessage.includes('{level}')) {
        logger.warn(
            `Level-up message set without {user} or {level} placeholders in guild ${guildId}`,
        );
    }

    cfg.levelUpMessage = newMessage;
    await saveLevelingConfig(client, guildId, cfg).catch(() => {});

    const preview = newMessage.replace('{user}', '@User
