import { SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

import birthdaySet from './modules/birthday_set.js';
import birthdayInfo from './modules/birthday_info.js';
import birthdayList from './modules/birthday_list.js';
import birthdayRemove from './modules/birthday_remove.js';
import nextBirthdays from './modules/next_birthdays.js';
import birthdaySetchannel from './modules/birthday_setchannel.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';

// Common global timezones for the autocomplete drop-down list
const COMMON_TIMEZONES = [
    'UTC', 'GMT',
    'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Denver', 'America/Phoenix',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
];

export default {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Birthday system commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set a birthday (Admin or Self-service depending on config)')
                .addIntegerOption(option =>
                    option
                        .setName('month')
                        .setDescription('Birth month (1-12)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(12)
                )
                .addIntegerOption(option =>
                    option
                        .setName('day')
                        .setDescription('Birth day (1-31)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(31)
                )
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user whose birthday to set (Admin Only)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('timezone')
                        .setDescription('Type to search for your local timezone')
                        .setRequired(false)
                        .setAutocomplete(true) // Enables the search filter UI
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('View birthday information')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('User to check birthday for')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all birthdays in the server')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a birthday')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('The user whose birthday to remove (Admin Only)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('next')
                .setDescription('Show upcoming birthdays')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setchannel')
                .setDescription('Set or disable the channel for birthday announcements.')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('The text channel for announcements. Leave empty to disable.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        ),

    // This handles filtering the timezone list as you type inside Discord
    async autocomplete(interaction) {
        try {
            const focusedValue = interaction.options.getFocused().toLowerCase();
            const filtered = COMMON_TIMEZONES.filter(choice => 
                choice.toLowerCase().includes(focusedValue)
            ).slice(0, 25); // Discord supports up to 25 choices maximum

            await interaction.respond(
                filtered.map(choice => ({ name: choice, value: choice }))
            );
        } catch (error) {
            logger.error('Timezone autocomplete generation failed', error);
        }
    },

    async execute(interaction, config, client) {
        try {
            const subcommand = interaction.options.getSubcommand();
            
            switch (subcommand) {
                case 'set':
                    return await birthdaySet.execute(interaction, config, client);
                case 'info':
                    return await birthdayInfo.execute(interaction, config, client);
                case 'list':
                    return await birthdayList.execute(interaction, config, client);
                case 'remove':
                    return await birthdayRemove.execute(interaction, config, client);
                case 'next':
                    return await nextBirthdays.execute(interaction, config, client);
                case 'setchannel':
                    return await birthdaySetchannel.execute(interaction, config, client);
                default:
                    return InteractionHelper.safeReply(interaction, {
                        embeds: [errorEmbed('Error', 'Unknown subcommand')],
                        flags: MessageFlags.Ephemeral
                    });
            }
        } catch (error) {
            logger.error('Birthday command execution failed', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'birthday'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'birthday',
                source: 'birthday_command'
            });
        }
    }
};
