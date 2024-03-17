/**
 * This is the main entry point for the bot.
 */

import { getVoiceConnection } from '@discordjs/voice';
import { GatewayIntentBits } from 'discord-api-types/v10';
import { Interaction, Events, Client } from 'discord.js';
import { deploy } from './slashCommandsRegister';
import { interactionHandlers } from './slashCommandHandlers';
import { config } from 'dotenv';

config();

const token = process.env.TOKEN;

// Create a new client instance with permissions to listen to voice state updates and messages
const client = new Client({
	intents: [GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.Guilds],
});

// This runs when the bot is added to a server; it deploys the slash
// commands
client.on(Events.GuildCreate, async (guild) => {
	await deploy(guild);
	console.log('Deployed slash commands');
});

client.on(Events.ClientReady, () => console.log('Ready!'));

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
	if (!interaction.isCommand() || !interaction.guildId) return;

	const handler = interactionHandlers.get(interaction.commandName);

	try {
		if (handler) {
			await handler(interaction, client, getVoiceConnection(interaction.guildId));
		} else {
			await interaction.reply('Unknown command');
		}
	} catch (error) {
		console.warn(error);
	}
});

client.on(Events.Error, console.warn);

void client.login(token);
