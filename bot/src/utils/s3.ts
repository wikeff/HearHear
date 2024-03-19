import * as fs from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import { deleteFileSync } from "./files.js";
import { Strings } from "../tokens/constants.js";

config();

const { S3_BUCKET_REGION } = process.env;
const { S3_BUCKET_NAME } = process.env;

const client = new S3Client({
  region: S3_BUCKET_REGION!,
});

/**
 * Upload a recording to S3. The path follows the format:
 * S3_BUCKET_NAME/{guildId}/{channelId}/{currentDate}/{fileName}
 * @param data the binary data of the recording
 * @param fileName the name of the file
 * @param guildId the id of the discord server
 * @param channelId the id of the discord channel where the recording was made
 * @param timestamp the timestamp of the recording. this should reflect
 * teh earliest time that the recording was made.
 * @param contentType the content type of the file. eg. audio/ogg
 * @returns
 */
async function uploadMeetingFileToS3(
  data: Buffer,
  fileName: string,
  guildId: string,
  channelId: string,
  timestamp: string,
  contentType = "audio/ogg"
) {
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: `${guildId}/${channelId}/${timestamp}/${fileName}`,
    Body: data,
    ContentType: contentType,
  };

  try {
    const results = await client.send(new PutObjectCommand(params));
    console.log(
      `Successfully created ${params.Key} and uploaded it to ${params.Bucket}/${params.Key}`
    );
    return results; // For unit tests.
  } catch (err) {
    console.log("Error", err);
    return err; // For unit tests.
  }
}

async function uploadRecordingsToS3(guildId: string, channelId: string) {
  const files = fs
    .readdirSync(`${Strings.RECORDING_FILES_PATH}/${guildId}`)
    .filter((file) => file.endsWith(".ogg"));

  if (files.length === 0) {
    console.log("No files to upload");
    return;
  }

  // sort files by date
  files.sort((a, b) => {
    const aDate = new Date(a.split("-")[0]!);
    const bDate = new Date(b.split("-")[0]!);
    return aDate.getTime() - bDate.getTime();
  });

  const earliestDate = files[0]!.split("-")[0]!;

  await Promise.all(
    files.map(async (file) => {
      fs.readFile(
        `${Strings.RECORDING_FILES_PATH}/${guildId}/${file}`,
        async (err, data) => {
          if (err) {
            console.log(err);
            return;
          }
          await uploadMeetingFileToS3(
            data,
            file,
            guildId,
            channelId,
            earliestDate
          )
            .then(() => {
              deleteFileSync(
                `${Strings.RECORDING_FILES_PATH}/${guildId}/${file}`
              );
            })
            .catch((err: any) => {
              console.log(err);
            });
        }
      );

      fs.readFile(
        `${Strings.RECORDING_FILES_PATH}/${guildId}/${file.slice(0, -4)}.txt`,
        async (err, data) => {
          if (err) {
            console.log(err);
            return;
          }
          await uploadMeetingFileToS3(
            data,
            `${file.slice(0, -4)}.txt`,
            guildId,
            channelId,
            earliestDate,
            "text/plain"
          )
            .then(() => {
              deleteFileSync(
                `${Strings.RECORDING_FILES_PATH}/${guildId}/${file.slice(
                  0,
                  -4
                )}.txt`
              );
            })
            .catch((err: any) => {
              console.log(err);
            });
        }
      );
    })
  );
}

export { uploadMeetingFileToS3, uploadRecordingsToS3 };
