import * as fs from "node:fs";
import ffmpeg from "fluent-ffmpeg";
import pThrottle from "p-throttle";
import { transcribeAudio } from "./ai";
import { deleteFileSync } from "./files";
import { Strings } from "../tokens/constants";

async function processRecordings(guildId: string) {
  fs.mkdirSync(`${Strings.RECORDING_FILES_PATH}/${guildId}`, {
    recursive: true,
  });

  let files = fs
    .readdirSync(`${Strings.RECORDING_FILES_PATH}/${guildId}`)
    .filter((file) => file.endsWith(".ogg"));

  if (files.length === 0) {
    console.log("No files to upload");
    return;
  }

  if (files.length > 1) {
    await mergeAudioFiles(files, guildId);
    console.log("merged files");
  }

  files = fs
    .readdirSync(`${Strings.RECORDING_FILES_PATH}/${guildId}`)
    .filter((file) => file.endsWith(".ogg"));
  // const convertLimit = pLimit(10);
  // await Promise.all(
  // 	files.map((file) =>
  // 		convertLimit(async () => {
  // 			if (!fs.existsSync(`${Strings.RECORDING_FILES_PATH}/${guildId}/${file.slice(0, -4)}.mp3`)) {
  // 				console.log(`Converting ${file} to mp3`);
  // await convertOggToMp3(`${Strings.RECORDING_FILES_PATH}/${guildId}/${file}`);
  // 			}
  // 		}),
  // 	),
  // );

  const throttle = pThrottle({
    limit: 50, // limit to 50 requests per minute
    interval: 60000, // interval of 1 minute
    strict: true,
  });

  await Promise.all(
    files.map(async (file) =>
      throttle(async () => {
        try {
          console.log(`Transcribing ${file}`);

          const res = await transcribeAudio(
            `${Strings.RECORDING_FILES_PATH}/${guildId}/${file}`
          );

          const data = await res.json();

          const { text } = data;
          if (!(text === null || text === undefined || text.length === 0)) {
            fs.writeFileSync(
              `${Strings.RECORDING_FILES_PATH}/${guildId}/${file.slice(
                0,
                -4
              )}.txt`,
              text
            );
            console.log(`Successfully saved ${file.slice(0, -4)}.txt`);
          } else {
            console.log(
              `No text found for ${file.slice(0, -4)}.ogg: `,
              text,
              "\n",
              data
            );
            deleteFileSync(
              `${Strings.RECORDING_FILES_PATH}/${guildId}/${file.slice(
                0,
                -4
              )}.ogg`
            );
          }
        } catch (err) {
          console.log(err);
        }
        deleteFileSync(`${Strings.RECORDING_FILES_PATH}/${guildId}/${file}`);
      })()
    )
  );
}

/**
 * Merge audio files that are timestamped within 1 second of each other.
 *
 * It will first sort all the files by timestamp from ascending order.
 * Then it will merge all the files that are within 1 second of each
 * other except when the user of the file is different.
 * @param files
 */
async function mergeAudioFiles(files: string[], guildId: string) {
  fs.mkdirSync(`${Strings.RECORDING_FILES_PATH}/${guildId}/merged`, {
    recursive: true,
  });

  // first step: sort by timestamp
  files.sort((a, b) => {
    const aDate = Number(a.split("-")[0]!);
    const bDate = Number(b.split("-")[0]!);
    return aDate - bDate;
  });

  const files_to_merge: [string[]] = [[files[0]!]]; // [[files],[],[]]

  for (let i = 1; i < files.length; i++) {
    const file = files[i];
    const fileDate = new Date(Number(file!.split("-")[0]!));
    const currentFileDate = new Date(Number(files[i - 1]!.split("-")[0]!));

    const fileUser = file!.split("-")[1];
    const currentFileUser = files[i - 1]!.split("-")[1];

    if (
      fileUser === currentFileUser &&
      fileDate.getTime() - currentFileDate.getTime() < 1_000_000
    ) {
      files_to_merge[files_to_merge.length - 1]!.push(file!);
    } else {
      files_to_merge.push([file!]);
    }
  }
  console.log("files to merge: ", files_to_merge);
  const pLimit = require("p-limit");
  const limit = pLimit(5); // Limits the number of concurrent executions to 5
  await Promise.allSettled(
    files_to_merge.map(async (files) => {
      if (files.length > 1) {
        await limit(() => mergeAudioFilesHelper(files, guildId));
      }
    })
  ).then(() => {
    // move all files from merged to recordings
    const merged_files = fs
      .readdirSync(`${Strings.RECORDING_FILES_PATH}/${guildId}/merged`)
      .filter((file) => file.endsWith(".ogg"));

    merged_files.forEach((file) => {
      fs.renameSync(
        `${Strings.RECORDING_FILES_PATH}/${guildId}/merged/${file}`,
        `${Strings.RECORDING_FILES_PATH}/${guildId}/${file}`
      );
    });
  });
}

async function mergeAudioFilesHelper(files: string[], guildId: string) {
  const mergedFileName = `${files[0]!}`;

  const fluent_ffmpeg = ffmpeg(
    `${Strings.RECORDING_FILES_PATH}/${guildId}/${files[0]}`
  );
  for (let i = 1; i < files.length; i++) {
    fluent_ffmpeg.input(
      `${Strings.RECORDING_FILES_PATH}/${guildId}/${files[i]}`
    );
  }

  await new Promise((resolve, reject) => {
    fluent_ffmpeg
      .on("error", (err) => {
        console.log("error here");

        console.log(err);
        return reject(err);
      })
      .on("end", () => {
        files.forEach((file) => {
          deleteFileSync(`${Strings.RECORDING_FILES_PATH}/${guildId}/${file}`);
        });
        fs.renameSync(
          `${Strings.RECORDING_FILES_PATH}/${guildId}/merged/${mergedFileName}`,
          `${Strings.RECORDING_FILES_PATH}/${guildId}/${mergedFileName}`
        );
        return resolve("done");
      })
      .mergeToFile(
        `${Strings.RECORDING_FILES_PATH}/${guildId}/merged/${mergedFileName}`,
        "./tmp"
      );
  });
}

export { processRecordings };

// No need to convert as OpenAI Whisper supports ogg files
// function convertOggToMp3(oggFilename: string): Promise<string> {
// 	return new Promise((resolve, reject) => {
// 		const outputFile = oggFilename.replace('.ogg', '.mp3');
// 		ffmpeg({
// 			source: oggFilename,
// 		})
// 			.on('error', (err: any) => {
// 				reject(err);
// 			})
// 			.on('end', () => {
// 				resolve(outputFile);
// 			})
// 			.save(outputFile);
// 	});
// }
