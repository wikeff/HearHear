/**
 * Map each slash command to a function that handles the command.
 */

import {
  // entersState,
  joinVoiceChannel,
  VoiceConnection,
  // VoiceConnectionStatus,
} from "@discordjs/voice";
import { Client, CommandInteraction, GuildMember } from "discord.js";
import { createListeningStream } from "./utils/audio";
import { processRecordings } from "./utils/audioProcessor";
import { uploadRecordingsToS3 } from "./utils/s3";

/**
 * Handles the '/start' command.
 *
 * The bot will join the voice channel of the user who issued the
 * command and start recording audio.
 *
 * If the user is not in a voice channel, the bot will reply with a
 * message asking the user to join a voice channel.
 *
 * @param interaction
 * @param client
 * @param connection
 * @returns
 */
async function start(
  interaction: CommandInteraction,
  client: Client,
  connection?: VoiceConnection
) {
  await interaction.deferReply();
  if (!connection) {
    // Check if the user provoking the command is a real human and  is in a voice channel
    if (
      interaction.member instanceof GuildMember &&
      interaction.member.voice.channel
    ) {
      const { channel } = interaction.member.voice;
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        selfDeaf: false,
        selfMute: true,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });
    } else {
      await interaction.editReply(
        "Join a voice channel and then try that again!"
      );
      return;
    }
  }

  // At this point, the bot is in a voice channel and is actively
  // listening to the voice channel for any audio input.
  try {
    // await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
    const { receiver } = connection;

    receiver.speaking.on("start", (userId) => {
      console.log("start", userId);
      if (
        interaction.member instanceof GuildMember &&
        interaction.member.voice.channel
      ) {
        const { channel } = interaction.member.voice;
        createListeningStream(
          receiver,
          userId,
          channel.guild.id,
          client.users.cache.get(userId)
        );
      }
    });
  } catch (error) {
    console.warn(error);
    await interaction.editReply(
      "Failed to join voice channel within 20 seconds, please try again later!"
    );
  }

  await interaction.editReply("Ready!");
}

async function end(
  interaction: CommandInteraction,
  _client: Client,
  connection?: VoiceConnection
) {
  if (connection) {
    await interaction.deferReply({ ephemeral: true });
    connection.receiver.subscriptions.forEach((subscription) => {
      subscription.emit("end");
    });
    connection.destroy();

    await interaction.editReply({
      content: "Stopped recording audio file",
    });
    await interaction.editReply({
      content: "Process recordings...this may take a while",
    });

    if (
      interaction.member instanceof GuildMember &&
      interaction.member.voice.channel &&
      interaction.guildId
    ) {
      const { guildId } = interaction;
      const channelId = interaction.member.voice.channel.id;
      processRecordings(guildId)
        .then(async () => {
          await uploadRecordingsToS3(guildId, channelId);
          await interaction.editReply({
            // TODO: change the link
            content: `Completed! You can now head to https://hearhear.vercel.app/dashboard/guilds/${guildId}/ to view your meetings!`,
          });
        })
        .catch(async (err) => {
          await interaction.editReply({
            content: `Failed to upload the files to S3! ${err}`,
          });
        });
    } else {
      await interaction.editReply({
        content:
          "Failed to retrieve information needed to upload the files to S3. Need guildId and channelId!",
      });
    }
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "Not recording in this server!",
    });
  }
}

export const interactionHandlers = new Map<
  string,
  (
    interaction: CommandInteraction,
    client: Client,
    connection?: VoiceConnection
  ) => Promise<void>
>();
interactionHandlers.set("start", start);
interactionHandlers.set("end", end);
