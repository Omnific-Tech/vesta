// Hook metadata has a separate bounded/no-follow contract from configuration JSON.
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';

const MAXIMUM_METADATA_BYTES = 1048576;
const PRIVATE_FILE_MODE = 0o600;

export function readMetadata(path: string, maximum = MAXIMUM_METADATA_BYTES) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    const named = lstatSync(path);
    if (
      !opened.isFile() ||
      named.isSymbolicLink() ||
      opened.ino !== named.ino ||
      opened.dev !== named.dev ||
      opened.size > maximum ||
      (process.getuid && opened.uid !== process.getuid())
    )
      throw new Error('unsafe metadata file');
    const data = readFileSync(descriptor, 'utf8');
    if (Buffer.byteLength(data) > maximum) throw new Error('metadata bound exceeded');
    return data;
  } finally {
    closeSync(descriptor);
  }
}

export function writeMetadata(path: string, row: unknown) {
  const temporary = path + '.' + process.pid + '.tmp';
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    PRIVATE_FILE_MODE,
  );
  try {
    writeFileSync(descriptor, JSON.stringify(row));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  // Retain an exclusive temporary on write/rename failure, as the hook runtime did.
  renameSync(temporary, path);
}
